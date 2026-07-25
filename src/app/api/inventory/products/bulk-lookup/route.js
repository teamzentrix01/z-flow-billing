import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function cleanValues(values, compact = false) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim().replace(/^'+/, '').toLowerCase())
        .map((value) => (compact ? value.replace(/[^a-z0-9]+/g, '') : value))
        .filter(Boolean),
    ),
  ).slice(0, 1000);
}

async function reconcileMissingStockInBatches(storeId, barcodes, skus, names) {
  await query(
    `WITH matching_products AS (
       SELECT p.id
       FROM products p
       WHERE LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.barcode, ''), '^''+', ''))) = ANY($2::text[])
          OR LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.sku, ''), '^''+', ''))) = ANY($3::text[])
          OR LOWER(REGEXP_REPLACE(COALESCE(p.name, ''), '[^a-zA-Z0-9]+', '', 'g')) = ANY($4::text[])
     ), missing_items AS (
       SELECT sii.id AS stock_in_item_id, sii.stock_in_id, sii.product_id,
              si.destination_id AS store_id,
              COALESCE(NULLIF(TRIM(sii.batch_no), ''), 'RECOVERED-' || si.id || '-' || sii.id) AS batch_no,
              sii.mfg_date, sii.expiry_date, sii.qty, COALESCE(sii.cost_price, 0) AS cost_price,
              COALESCE(sii.mrp, 0) AS mrp, COALESCE(sii.selling_price, 0) AS selling_price
       FROM stock_in_items sii
       INNER JOIN stock_in si ON si.id = sii.stock_in_id
       INNER JOIN matching_products mp ON mp.id = sii.product_id
       WHERE si.status = 'confirmed'
         AND si.destination_id = $1
         AND sii.qty > 0
         AND NOT EXISTS (
           SELECT 1
           FROM inventory_batches ib
           WHERE ib.source_type = 'stock_in'
             AND ib.source_id = sii.id::text
         )
         AND NOT EXISTS (
           SELECT 1
           FROM inventory_batches legacy
           WHERE legacy.product_id = sii.product_id
             AND legacy.store_id = si.destination_id
             AND legacy.source_type = 'legacy_migration'
             AND legacy.created_at >= COALESCE(si.confirmed_at, si.created_at)
         )
     ), inserted AS (
       INSERT INTO inventory_batches (
         product_id, store_id, batch_no, mfg_date, expiry_date,
         received_qty, available_qty, cost_price, source_type, source_id, meta,
         created_at, updated_at
       )
       SELECT product_id, store_id, batch_no, mfg_date, expiry_date,
              qty, qty, cost_price, 'stock_in', stock_in_item_id::text,
              jsonb_strip_nulls(jsonb_build_object(
                'source', 'confirmed_stock_in_reconciliation',
                'stockInId', stock_in_id,
                'costPrice', cost_price,
                'mrp', NULLIF(mrp, 0),
                'sellingPrice', NULLIF(selling_price, 0)
              )),
              NOW(), NOW()
       FROM missing_items
       RETURNING id, product_id, store_id, available_qty, source_id,
                 meta->>'stockInId' AS stock_in_id
     )
     INSERT INTO inventory_batch_movements (
       batch_id, product_id, store_id, direction, qty,
       reference_type, reference_id, source_item_id, meta
     )
     SELECT id, product_id, store_id, 'in', available_qty,
            'stock_in_reconciliation', stock_in_id, source_id::bigint,
            jsonb_build_object('reconciled', true)
     FROM inserted`,
    [storeId, barcodes, skus, names],
  );
}

export async function POST(request) {
  try {
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const storeId = Number(body.store_id || body.storeId || 0);
    if (!storeId) {
      return NextResponse.json({ error: 'Source location is required' }, { status: 400 });
    }
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const barcodes = cleanValues(body.barcodes);
    const skus = cleanValues(body.skus);
    const names = cleanValues(body.product_names || body.productNames, true);
    if (!barcodes.length && !skus.length && !names.length) {
      return NextResponse.json({ records: [] });
    }

    await reconcileMissingStockInBatches(storeId, barcodes, skus, names);

    const result = await query(
      `WITH matching_products AS (
         SELECT p.*
         FROM products p
         WHERE LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.barcode, ''), '^''+', ''))) = ANY($2::text[])
            OR LOWER(TRIM(REGEXP_REPLACE(COALESCE(p.sku, ''), '^''+', ''))) = ANY($3::text[])
            OR LOWER(REGEXP_REPLACE(COALESCE(p.name, ''), '[^a-zA-Z0-9]+', '', 'g')) = ANY($4::text[])
       ), stock AS (
         SELECT ib.product_id,
                SUM(ib.available_qty) AS available_qty,
                SUM(ib.available_qty * COALESCE(NULLIF(ib.cost_price, 0), mp.cost_price, 0)) AS stock_cost
         FROM inventory_batches ib
         INNER JOIN matching_products mp ON mp.id = ib.product_id
         WHERE ib.store_id = $1
           AND ib.status = 'active'
           AND ib.available_qty > 0
           AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
         GROUP BY ib.product_id
       )
       SELECT mp.id, mp.product_id::text AS product_id, mp.name,
              COALESCE(mp.sku, '') AS sku, COALESCE(mp.barcode, '') AS barcode,
              COALESCE(mp.mrp, 0) AS mrp,
              COALESCE(mp.selling_price, 0) AS selling_price,
              CASE WHEN stock.available_qty > 0
                THEN stock.stock_cost / stock.available_qty
                ELSE COALESCE(mp.cost_price, 0)
              END AS cost_price,
              COALESCE(stock.available_qty, 0) AS "availableStock",
              COALESCE(t.rate, 0) AS "taxRate"
       FROM matching_products mp
       INNER JOIN stock ON stock.product_id = mp.id
       LEFT JOIN taxes t ON t.id = mp.tax_id
       ORDER BY mp.name ASC`,
      [storeId, barcodes, skus, names],
    );

    return NextResponse.json({
      records: result.rows.map((row) => ({
        ...row,
        availableStock: Number(row.availableStock || 0),
        cost_price: Number(row.cost_price || 0),
        taxRate: Number(row.taxRate || 0),
      })),
    });
  } catch (error) {
    console.error('[inventory products bulk lookup]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to look up source inventory' },
      { status: 500 },
    );
  }
}
