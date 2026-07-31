import { successResponse, errorResponse } from '@/lib/api-response';
import { extractAuthUser } from '@/lib/api-protection';
import { query } from '@/lib/db';

export async function GET(request) {
  try {
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) {
      return successResponse({ user: null }, 'Not authenticated');
    }

    let assignedStoreNames = [];
    if (auth.user.assigned_stores.length) {
      const stores = await query(
        `SELECT name
         FROM stores
         WHERE id = ANY($1::int[])
         ORDER BY name`,
        [auth.user.assigned_stores],
      );
      assignedStoreNames = stores.rows.map((row) => row.name).filter(Boolean);
    }

    return successResponse(
      {
        user: {
          ...auth.user,
          assigned_store_names: assignedStoreNames,
        },
      },
      'Authenticated',
    );
  } catch (err) {
    console.error('[AUTH/ME] Error:', err.message);
    return errorResponse(err.message || 'Unable to fetch current user');
  }
}
