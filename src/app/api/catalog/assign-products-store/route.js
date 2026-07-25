import { query } from "@/lib/db";
import {
  successResponse,
  errorResponse,
  validationError,
  notFoundError,
} from "@/lib/api-response";
import { ensureCatalogExtrasSchema } from "@/lib/catalogExtrasSchema";
import {
  requireAuth,
  requirePermission,
  requireStore,
} from "@/lib/api-protection";

function rowToBool(value) {
  return value === true || value === "true";
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function GET(request) {
  try {
    await ensureCatalogExtrasSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(
      auth.user,
      "VIEW_CATALOG",
      "MANAGE_CATALOG",
    );
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const storeId =
      Number(
        searchParams.get("storeId") || searchParams.get("store_id") || 0,
      ) || null;
    const search = String(searchParams.get("search") || "").trim();
    if (!storeId)
      return validationError([
        { field: "storeId", message: "Store is required" },
      ]);
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const params = [storeId];
    const where = ["p.is_active IS DISTINCT FROM false"];
    const countParams = [];
    const countWhere = ["p.is_active IS DISTINCT FROM false"];
    if (search) {
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length} OR p.product_id ILIKE $${params.length})`,
      );
      countWhere.push(
        `(p.name ILIKE $${countParams.length} OR p.sku ILIKE $${countParams.length} OR p.barcode ILIKE $${countParams.length} OR p.product_id ILIKE $${countParams.length})`,
      );
    }

    const totalRes = await query(
      `SELECT COUNT(*)::int AS total
       FROM products p
       WHERE ${countWhere.join(" AND ")}`,
      countParams,
    );

    const res = await query(
      `SELECT p.id, p.product_id, p.name, p.barcode, p.sku, p.mrp, p.selling_price,
              COALESCE(latest_transfer.cost_price, p.cost_price, 0) AS franchise_cost,
              COALESCE(ps.low_stock_value, 0) AS low_stock_level,
              COALESCE(ps.low_stock_value, 0) AS safe_stock_level,
              COALESCE(ps.is_active, false) AS is_assigned,
              COALESCE(ps.selling_price, p.selling_price, 0) AS store_selling_price,
              COALESCE(ps.mrp, p.mrp, 0) AS store_mrp
       FROM products p
       LEFT JOIN product_saleability ps ON ps.product_id = p.id AND ps.store_id = $1
       LEFT JOIN LATERAL (
         SELECT sti.cost_price
         FROM stock_transfer_items sti
         INNER JOIN stock_transfer st ON st.id = sti.stock_transfer_id
         WHERE st.destination_id = $1
           AND st.status = 'confirmed'
           AND sti.product_id = p.id
           AND COALESCE(sti.cost_price, 0) > 0
         ORDER BY COALESCE(st.confirmed_at, st.created_at) DESC, sti.id DESC
         LIMIT 1
       ) latest_transfer ON TRUE
       WHERE ${where.join(" AND ")}
       ORDER BY p.name ASC`,
      params,
    );

    return successResponse(
      {
        records: res.rows,
        total: Number(totalRes.rows[0]?.total || res.rows.length),
      },
      "Products fetched",
    );
  } catch (err) {
    console.error("[assign-products-store GET]", err);
    return errorResponse("Failed to fetch products");
  }
}

export async function POST(request) {
  try {
    await ensureCatalogExtrasSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, "MANAGE_CATALOG");
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json().catch(() => ({}));
    const storeId = Number(body.storeId || body.store_id || 0) || null;
    if (!storeId) {
      return validationError([
        { field: "storeId", message: "Store is required" },
      ]);
    }
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const productId = Number(body.productId || body.product_id || 0) || null;
    const productIds = Array.isArray(body.productIds)
      ? body.productIds.map(Number).filter(Boolean)
      : null;

    if (!productId && (!productIds || productIds.length === 0)) {
      return validationError([
        { field: "productId", message: "Product(s) and store are required" },
      ]);
    }

    const assign = body.assign !== false && body.is_active !== false;

    if (productIds && productIds.length > 0) {
      if (assign) {
        await query(
          `INSERT INTO product_saleability (
             product_id, store_id, is_active, selling_price, mrp, low_stock_value, minimum_base_quantity, created_at, updated_at
           )
           SELECT p.id, $2, true, p.selling_price, p.mrp, 0, 0, NOW(), NOW()
           FROM products p
           JOIN stores s ON s.id = $2
           WHERE p.id = ANY($1::bigint[])
           ON CONFLICT (product_id, store_id) DO UPDATE
             SET is_active = true,
                 updated_at = NOW()`,
          [productIds, storeId],
        );
      } else {
        await query(
          `UPDATE product_saleability
           SET is_active = false, updated_at = NOW()
           WHERE store_id = $2 AND product_id = ANY($1::bigint[])`,
          [productIds, storeId],
        );
      }

      return successResponse(
        { productIds, storeId, isAssigned: assign },
        assign ? "Products assigned in bulk" : "Products unassigned in bulk",
      );
    }

    const hasSellingPrice = Object.prototype.hasOwnProperty.call(
      body,
      "selling_price",
    );
    const hasMrp = Object.prototype.hasOwnProperty.call(body, "mrp");
    const hasLowStockValue = Object.prototype.hasOwnProperty.call(
      body,
      "low_stock_value",
    );
    const hasMinimumBaseQuantity =
      Object.prototype.hasOwnProperty.call(body, "minimum_base_quantity") ||
      Object.prototype.hasOwnProperty.call(body, "mbq");
    if (assign) {
      const result = await query(
        `INSERT INTO product_saleability (
           product_id, store_id, is_active, selling_price, mrp, low_stock_value, minimum_base_quantity, created_at, updated_at
         )
         SELECT p.id, $2, true, COALESCE($3, p.selling_price, 0), COALESCE($4, p.mrp, 0), COALESCE($7, 0), COALESCE($8, 0), NOW(), NOW()
         FROM products p
         JOIN stores s ON s.id = $2
         WHERE p.id = $1
         ON CONFLICT (product_id, store_id) DO UPDATE
           SET is_active = true,
               selling_price = CASE WHEN $5 THEN EXCLUDED.selling_price ELSE product_saleability.selling_price END,
               mrp = CASE WHEN $6 THEN EXCLUDED.mrp ELSE product_saleability.mrp END,
               low_stock_value = CASE WHEN $9 THEN EXCLUDED.low_stock_value ELSE product_saleability.low_stock_value END,
               minimum_base_quantity = CASE WHEN $10 THEN EXCLUDED.minimum_base_quantity ELSE product_saleability.minimum_base_quantity END,
               updated_at = NOW()
         RETURNING product_id, store_id, is_active`,
        [
          productId,
          storeId,
          toFiniteNumber(body.selling_price, null),
          toFiniteNumber(body.mrp, null),
          hasSellingPrice,
          hasMrp,
          toFiniteNumber(body.low_stock_value, null),
          toFiniteNumber(body.minimum_base_quantity ?? body.mbq, null),
          hasLowStockValue,
          hasMinimumBaseQuantity,
        ],
      );
      if (!result.rows.length)
        return notFoundError("Product or store was not found");
    } else {
      const result = await query(
        `UPDATE product_saleability
         SET is_active = false, updated_at = NOW()
         WHERE product_id = $1 AND store_id = $2
         RETURNING product_id, store_id, is_active`,
        [productId, storeId],
      );
      if (!result.rows.length)
        return notFoundError("Product assignment was not found");
    }

    return successResponse(
      { productId, storeId, isAssigned: rowToBool(assign) },
      assign ? "Product assigned" : "Product unassigned",
    );
  } catch (err) {
    console.error("[assign-products-store POST]", err);
    return errorResponse("Failed to update assignment", 500, err);
  }
}
