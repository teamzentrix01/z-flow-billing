import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureProcurementSchema } from '@/lib/procurementSchema';
import { ensureVendorsSchema } from '@/lib/vendorsSchema';
import { appendStoreScope, auditLog, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDemandIds(items = []) {
  return Array.from(new Set(
    items.flatMap((item) => Array.isArray(item.demandIds) ? item.demandIds : [])
      .map((id) => toNum(id, 0))
      .filter(Boolean)
  ));
}

export async function GET(request) {
  try {
    await ensureProcurementSchema();
    await ensureVendorsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS', 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId') || searchParams.get('store_id');
    const vendorId = toNum(searchParams.get('vendorId') || searchParams.get('vendor_id'), 0);
    const search = String(searchParams.get('search') || '').trim();
    const params = [];
    const where = ['ps.is_active = TRUE'];
    const scope = appendStoreScope(where, params, 'ps.store_id', auth.user, storeId);
    if (scope.error) return scope.error;
    if (vendorId) {
      params.push(vendorId);
      const vendorParam = params.length;
      where.push(`(
        (
          EXISTS (SELECT 1 FROM vendor_brands vb_scope WHERE vb_scope.vendor_id = $${vendorParam})
          AND EXISTS (
            SELECT 1
            FROM vendor_brands vb_match
            WHERE vb_match.vendor_id = $${vendorParam}
              AND vb_match.brand_id = p.brand_id
          )
        )
        OR (
          NOT EXISTS (SELECT 1 FROM vendor_brands vb_scope WHERE vb_scope.vendor_id = $${vendorParam})
          AND EXISTS (
            SELECT 1
            FROM stock_in_items hist_sii
            JOIN stock_in hist_si ON hist_si.id = hist_sii.stock_in_id
            WHERE hist_sii.product_id = p.id
              AND hist_si.vendor_id = $${vendorParam}
              AND LOWER(COALESCE(hist_si.status, '')) = 'confirmed'
          )
        )
      )`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        COALESCE(p.name, '') ILIKE $${params.length}
        OR COALESCE(p.sku, '') ILIKE $${params.length}
        OR COALESCE(p.barcode, '') ILIKE $${params.length}
        OR COALESCE(p.product_id, '') ILIKE $${params.length}
      )`);
    }

    const res = await query(
      `WITH stock AS (
         SELECT product_id, store_id, COALESCE(SUM(available_qty), 0) AS available_qty
         FROM inventory_batches
         WHERE status = 'active'
         GROUP BY product_id, store_id
       ), sales AS (
         SELECT sbi.product_id, sb.store_id,
                COALESCE(SUM(sbi.qty), 0) AS sold_30d,
                COALESCE(SUM(sbi.qty), 0) / 30.0 AS avg_daily_sales
         FROM sales_bill_items sbi
         JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
         WHERE sb.created_at >= NOW() - INTERVAL '30 days'
         GROUP BY sbi.product_id, sb.store_id
       ), demands AS (
         SELECT store_id, product_id,
                COALESCE(SUM(requested_qty), 0) AS demand_qty,
                ARRAY_AGG(id ORDER BY created_at DESC) AS demand_ids
         FROM customer_demands
         WHERE product_id IS NOT NULL
           AND LOWER(COALESCE(status, 'new')) IN ('new', 'reviewed')
         GROUP BY store_id, product_id
       )
       SELECT
         p.id AS product_id,
         p.product_id AS product_code,
         p.name AS product_name,
         p.sku,
         p.barcode,
         ps.store_id,
         s.name AS store_name,
         COALESCE(stock.available_qty, 0) AS current_stock,
         COALESCE(NULLIF(ps.low_stock_value, 0), 10) AS reorder_level,
         COALESCE(sales.sold_30d, 0) AS sold_30d,
         COALESCE(sales.avg_daily_sales, 0) AS avg_daily_sales,
         COALESCE(demands.demand_qty, 0) AS demand_qty,
         COALESCE(demands.demand_ids, ARRAY[]::bigint[]) AS demand_ids,
         GREATEST(
           CASE WHEN COALESCE(stock.available_qty, 0) <= COALESCE(NULLIF(ps.low_stock_value, 0), 10)
             THEN COALESCE(NULLIF(ps.low_stock_value, 0), 10) * 2 - COALESCE(stock.available_qty, 0)
             ELSE 0 END,
           CASE WHEN COALESCE(sales.avg_daily_sales, 0) > 0
             THEN CEIL(GREATEST((COALESCE(sales.avg_daily_sales, 0) * 7) - COALESCE(stock.available_qty, 0), 0))
             ELSE 0 END,
           COALESCE(demands.demand_qty, 0)
         ) AS suggested_qty,
         transfer_cost.cost_price AS transfer_cost_price,
         last_vendor.vendor_id,
         last_vendor.vendor_name
       FROM product_saleability ps
       JOIN products p ON p.id = ps.product_id
       JOIN stores s ON s.id = ps.store_id
       LEFT JOIN stock ON stock.product_id = ps.product_id AND stock.store_id = ps.store_id
       LEFT JOIN sales ON sales.product_id = ps.product_id AND sales.store_id = ps.store_id
       LEFT JOIN demands ON demands.product_id = ps.product_id AND demands.store_id = ps.store_id
       LEFT JOIN LATERAL (
         SELECT sti.cost_price
         FROM stock_transfer_items sti
         JOIN stock_transfer st ON st.id = sti.stock_transfer_id
         WHERE sti.product_id = p.id
           AND st.destination_id = ps.store_id
           AND LOWER(COALESCE(st.status, '')) = 'confirmed'
           AND COALESCE(sti.cost_price, 0) > 0
         ORDER BY COALESCE(st.confirmed_at, st.created_at) DESC, sti.id DESC
         LIMIT 1
       ) transfer_cost ON TRUE
       LEFT JOIN LATERAL (
         SELECT si.vendor_id, COALESCE(v.name, si.vendor_name) AS vendor_name
         FROM stock_in_items sii
         JOIN stock_in si ON si.id = sii.stock_in_id
         LEFT JOIN vendors v ON v.id = si.vendor_id
         WHERE sii.product_id = p.id AND si.vendor_id IS NOT NULL
         ORDER BY si.confirmed_at DESC NULLS LAST, si.created_at DESC
         LIMIT 1
       ) last_vendor ON TRUE
       WHERE ${where.join(' AND ')}
         AND (
           COALESCE(stock.available_qty, 0) <= COALESCE(NULLIF(ps.low_stock_value, 0), 10)
           OR COALESCE(sales.sold_30d, 0) > 0
           OR COALESCE(demands.demand_qty, 0) > 0
         )
       ORDER BY suggested_qty DESC, demand_qty DESC, sold_30d DESC, p.name ASC
       LIMIT 500`,
      params
    );

    return NextResponse.json(res.rows.map((row) => {
      const currentStock = Number(row.current_stock || 0);
      const reorderLevel = Number(row.reorder_level || 0);
      const sold30d = Number(row.sold_30d || 0);
      const demandQty = Number(row.demand_qty || 0);
      const reasons = [];
      if (currentStock <= reorderLevel) reasons.push('Low Stock');
      if (sold30d > 0) reasons.push('Fast Moving');
      if (demandQty > 0) reasons.push('Customer Demand');
      return {
        productId: row.product_id,
        productCode: row.product_code || '',
        productName: row.product_name || '',
        sku: row.sku || '',
        barcode: row.barcode || '',
        storeId: row.store_id,
        storeName: row.store_name || '',
        currentStock,
        reorderLevel,
        sold30d,
        avgDailySales: Number(row.avg_daily_sales || 0),
        demandQty,
        demandIds: row.demand_ids || [],
        reasons,
        suggestedQty: Math.max(Number(row.suggested_qty || 0), 0),
        costPrice: Number(row.transfer_cost_price || 0),
        costSource: row.transfer_cost_price ? 'stock_transfer' : 'none',
        vendorId: row.vendor_id,
        vendorName: row.vendor_name || '',
      };
    }));
  } catch (err) {
    console.error('[purchase reorder GET]', err.message);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request) {
  const client = await getClient();
  try {
    await ensureProcurementSchema();
    await ensureVendorsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json().catch(() => ({}));
    const storeId = toNum(body.storeId || body.store_id, 0);
    const vendorId = toNum(body.vendorId || body.vendor_id, 0);
    const inputItems = Array.isArray(body.items) ? body.items : [];
    if (!storeId) return NextResponse.json({ error: 'Store is required' }, { status: 400 });
    if (!vendorId) return NextResponse.json({ error: 'Vendor is required' }, { status: 400 });
    if (!inputItems.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    await client.query('BEGIN');
    const po = await client.query(
      `INSERT INTO purchase_orders (
         destination_id, vendor_id, invoice_date, expected_delivery_date,
         shipment_mode, invoice_number, cc_emails, status, meta, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8::jsonb,NOW())
       RETURNING id`,
      [
        storeId,
        vendorId,
        body.invoiceDate || body.invoice_date || null,
        body.expectedDeliveryDate || body.expected_delivery_date || null,
        body.shipmentMode || body.shipment_mode || null,
        body.invoiceNumber || body.invoice_number || null,
        body.ccEmails || body.cc_emails || null,
        JSON.stringify({ ...body, source: body.source || 'auto_reorder' }),
      ]
    );
    const poId = po.rows[0].id;
    const transactionId = `PO-${String(poId).padStart(4, '0')}`;
    await client.query('UPDATE purchase_orders SET transaction_id = $1 WHERE id = $2', [transactionId, poId]);

    let totalItems = 0;
    let totalCost = 0;
    for (const item of inputItems) {
      const productId = toNum(item.productId || item.product_id, 0);
      const qty = toNum(item.qty || item.suggestedQty || item.suggested_qty, 0);
      const inputCostPrice = toNum(item.costPrice || item.cost_price, 0);
      if (!productId || qty <= 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Each item must have a product and quantity greater than zero' }, { status: 400 });
      }
      if (inputCostPrice < 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Cost price cannot be negative' }, { status: 400 });
      }
      const product = await client.query('SELECT name FROM products WHERE id = $1', [productId]);
      if (!product.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `Product ${productId} was not found` }, { status: 404 });
      }
      const vendorAllowed = await client.query(
        `SELECT CASE
           WHEN EXISTS (SELECT 1 FROM vendor_brands WHERE vendor_id = $1)
             THEN EXISTS (
               SELECT 1
               FROM products p
               JOIN vendor_brands vb ON vb.brand_id = p.brand_id
               WHERE p.id = $2 AND vb.vendor_id = $1
             )
           ELSE EXISTS (
             SELECT 1
             FROM stock_in_items sii
             JOIN stock_in si ON si.id = sii.stock_in_id
             WHERE sii.product_id = $2
               AND si.vendor_id = $1
               AND LOWER(COALESCE(si.status, '')) = 'confirmed'
           )
         END AS allowed`,
        [vendorId, productId]
      );
      if (!vendorAllowed.rows[0]?.allowed) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `${product.rows[0].name} is not mapped to the selected vendor` }, { status: 400 });
      }
      const transferCost = await client.query(
        `SELECT sti.cost_price
         FROM stock_transfer_items sti
         JOIN stock_transfer st ON st.id = sti.stock_transfer_id
         WHERE sti.product_id = $1
           AND st.destination_id = $2
           AND LOWER(COALESCE(st.status, '')) = 'confirmed'
           AND COALESCE(sti.cost_price, 0) > 0
         ORDER BY COALESCE(st.confirmed_at, st.created_at) DESC, sti.id DESC
         LIMIT 1`,
        [productId, storeId]
      );
      const productName = item.productName || item.product_name || product.rows[0]?.name || null;
      const cost = toNum(transferCost.rows[0]?.cost_price, inputCostPrice);
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, qty, cost_price, tax_value)
         VALUES ($1,$2,$3,$4,$5,0)`,
        [poId, productId, productName, qty, cost]
      );
      totalItems += qty;
      totalCost += qty * cost;
    }

    const demandIds = normalizeDemandIds(inputItems);
    if (demandIds.length) {
      await client.query(
        `UPDATE customer_demands
         SET status = 'added_to_po', reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
         WHERE id = ANY($1::bigint[]) AND store_id = $2`,
        [demandIds, storeId, auth.user.id || null, JSON.stringify({ purchaseOrderId: poId, transactionId })]
      );
    }

    await client.query(
      `UPDATE purchase_orders
       SET total_items = $2, total_cost = $3, total_tax = 0
       WHERE id = $1`,
      [poId, totalItems, totalCost]
    );

    await client.query('COMMIT');
    await auditLog(auth.user.id, 'purchase_order.auto_reorder_create', 'purchase_order', poId, {
      transactionId,
      storeId,
      vendorId,
      totalItems,
      totalCost,
      demandIds,
    });
    return NextResponse.json({ id: poId, transactionId, totalItems, totalCost }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[purchase reorder POST]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to generate purchase order' }, { status: 500 });
  } finally {
    client.release();
  }
}
