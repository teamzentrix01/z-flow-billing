import { query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';

// ─── GET /api/catalog/product-groups ───────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search   = searchParams.get('search')   || '';
    const page     = parseInt(searchParams.get('page')     || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const offset   = (page - 1) * pageSize;

    const whereClause = search
      ? `WHERE t.name ILIKE $3`
      : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM product_groups t ${whereClause}`,
      search ? [`%${search}%`] : []
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT t.id, t.name, t.description, t.category_id, t.is_active, t.created_at,
              COALESCE(c.name, '—') AS category_name
       FROM product_groups t
       LEFT JOIN categories c ON t.category_id = c.id
       ${whereClause}
       ORDER BY t.id DESC
       LIMIT $1 OFFSET $2`,
      search
        ? [pageSize, offset, `%${search}%`]
        : [pageSize, offset]
    );

    return successResponse({
      records: result.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── POST /api/catalog/product-groups ──────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return validationError({ name: 'Name is required' });
    }

    const result = await query(
      `INSERT INTO product_groups (name, description, category_id, is_active)
       VALUES ($1, $2, $3, COALESCE($4, true))
       RETURNING *`,
      [body.name?.trim(), body.description || null, body.category_id || null, body.is_active ?? true]
    );

    return successResponse(result.rows[0], 'Product Group created successfully', 201);
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse('Product Group already exists', 409);
    }
    return errorResponse(err.message);
  }
}
