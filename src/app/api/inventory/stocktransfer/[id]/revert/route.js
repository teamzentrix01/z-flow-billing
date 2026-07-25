import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import {
  allocateBatchStock,
  ensureInventoryBatchSchema,
  receiveBatchStock,
} from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request, { params }) {
  const { id } = await params;
  let client;

  try {
    await ensureStockTransferSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    client = await getClient();
    await client.query('BEGIN');

    const transferRes = await client.query(
      `SELECT id, status, source_id, destination_id, transaction_id, reverted_at
       FROM stock_transfer
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const transfer = transferRes.rows[0];
    if (!transfer) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 });
    }
    if (transfer.status !== 'confirmed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Only confirmed stock transfers can be reverted' }, { status: 400 });
    }
    if (transfer.reverted_at) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This stock transfer is already reverted' }, { status: 409 });
    }

    for (const storeId of [transfer.source_id, transfer.destination_id].filter(Boolean)) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }
    }

    const itemsRes = await client.query(
      `SELECT id, product_id, product_name, sku, qty, cost_price, mrp, selling_price, destination_mrp, meta
       FROM stock_transfer_items
       WHERE stock_transfer_id = $1
       ORDER BY id ASC`,
      [id],
    );
    if (!itemsRes.rows.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'No items found for this transfer' }, { status: 400 });
    }

    let totalQty = 0;
    let revertedQty = 0;
    const shortages = [];
    for (const item of itemsRes.rows) {
      const qty = toNumber(item.qty);
      if (qty <= 0) continue;
      totalQty += qty;

      const availableRes = await client.query(
        `SELECT id, available_qty
         FROM inventory_batches
         WHERE product_id = $1
           AND store_id = $2
           AND status = 'active'
           AND available_qty > 0
           AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
         FOR UPDATE`,
        [item.product_id, transfer.destination_id],
      );
      const availableQty = availableRes.rows.reduce(
        (sum, batch) => sum + toNumber(batch.available_qty),
        0,
      );
      const qtyToRevert = Math.round(Math.min(qty, availableQty) * 1000) / 1000;
      const shortQty = Math.round((qty - qtyToRevert) * 1000) / 1000;

      if (shortQty > 0) {
        shortages.push({
          productId: Number(item.product_id),
          productName: item.product_name || `Product ${item.product_id}`,
          sku: item.sku || null,
          requestedQty: qty,
          revertedQty: qtyToRevert,
          shortQty,
        });
      }
      if (qtyToRevert <= 0) continue;

      const allocations = await allocateBatchStock(client, {
        productId: item.product_id,
        storeId: transfer.destination_id,
        qty: qtyToRevert,
        referenceType: 'stock_transfer_revert',
        referenceId: id,
        sourceItemId: item.id,
        meta: {
          direction: 'destination_reversal',
          originalTransferId: transfer.id,
          transactionId: transfer.transaction_id || null,
        },
      });

      for (const allocation of allocations) {
        revertedQty += toNumber(allocation.qty);
        await receiveBatchStock(client, {
          stockInId: id,
          stockInItemId: item.id,
          productId: item.product_id,
          storeId: transfer.source_id,
          qty: allocation.qty,
          costPrice: allocation.costPrice || item.cost_price || 0,
          batchNo: allocation.batchNo,
          mfgDate: allocation.mfgDate,
          expiryDate: allocation.expiryDate,
          sourceType: 'stock_transfer_revert',
          movementReferenceType: 'stock_transfer_revert',
          meta: {
            source: 'stock_transfer_revert',
            originalTransferId: transfer.id,
            originalTransferItemId: item.id,
            sourceBatchId: allocation.batchId,
            productName: item.product_name || '',
            costPrice: allocation.costPrice || item.cost_price || 0,
            mrp: allocation.mrp || item.mrp || item.destination_mrp || 0,
            sellingPrice: allocation.sellingPrice || item.selling_price || 0,
          },
        });
      }
    }

    await client.query(
      `UPDATE stock_transfer
       SET status = 'reverted',
           reverted_at = NOW(),
           reverted_by = $1,
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
       WHERE id = $3`,
      [
        auth.user.id || null,
        JSON.stringify({
          reverted: true,
          partialRevert: shortages.length > 0,
          requestedQty: totalQty,
          revertedQty,
          shortages,
          revertedAt: new Date().toISOString(),
          revertedBy: auth.user.id || null,
        }),
        id,
      ],
    );

    await client.query('COMMIT');
    const message = shortages.length
      ? `Stock transfer partially reverted. ${revertedQty} of ${totalQty} unit(s) returned. ${shortages
          .map(
            (item) =>
              `${item.productName}${item.sku ? ` (SKU: ${item.sku})` : ''} is short by ${item.shortQty}`,
          )
          .join('; ')}.`
      : 'Stock transfer reverted successfully.';

    return NextResponse.json({
      success: true,
      id: Number(id),
      totalQty,
      revertedQty,
      partial: shortages.length > 0,
      shortages,
      message,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[stocktransfer revert]', err.stack || err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to revert stock transfer' },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
