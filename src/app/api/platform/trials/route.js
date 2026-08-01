import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-protection';
import {
  createTrialTenant,
  deleteTrialTenant,
  ensurePlatformTrialSchema,
  updateTrialTenant,
} from '@/lib/platformTrials';
import { masterQuery } from '@/lib/db';

function publicTenant(row) {
  return {
    id: row.id,
    organizationName: row.organization_name,
    slug: row.slug,
    status: row.status,
    trialStartsAt: row.trial_starts_at,
    trialEndsAt: row.trial_ends_at,
    maxUsers: row.max_users,
    maxStores: row.max_stores,
    loginId: row.login_id || null,
    ownerName: row.owner_name || null,
    ownerEmail: row.owner_email || null,
    createdAt: row.created_at,
  };
}

async function requirePlatformSuperAdmin(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth;
  if (auth.user.tenant_id) {
    return {
      error: NextResponse.json(
        { success: false, message: 'Platform access is not available to trial users' },
        { status: 403 },
      ),
    };
  }
  const roleCheck = requireRole(auth.user, 'super_admin');
  return roleCheck.error ? { error: roleCheck.error } : auth;
}

export async function GET(request) {
  try {
    const auth = await requirePlatformSuperAdmin(request);
    if (auth.error) return auth.error;
    await ensurePlatformTrialSchema();
    const result = await masterQuery(
      `SELECT
         tenant.*,
         trial_user.login_id,
         trial_user.name AS owner_name,
         trial_user.email AS owner_email
       FROM platform_tenants tenant
       LEFT JOIN platform_trial_users trial_user
         ON trial_user.tenant_id = tenant.id AND trial_user.is_active = TRUE
       ORDER BY tenant.created_at DESC`,
    );
    return NextResponse.json({ success: true, data: result.rows.map(publicTenant) });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to list trials' },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const auth = await requirePlatformSuperAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const tenant = await createTrialTenant({
      organizationName: body.organizationName,
      slug: body.slug,
      loginId: body.loginId,
      email: body.email,
      password: body.password,
      name: body.name,
      phone: body.phone,
      trialDays: body.trialDays,
      maxUsers: body.maxUsers,
      maxStores: body.maxStores,
      createdBy: auth.user.id,
      permissions: body.permissions,
    });
    return NextResponse.json(
      {
        success: true,
        data: {
          id: tenant.id,
          organizationName: tenant.organization_name,
          status: tenant.status,
          trialEndsAt: tenant.trial_ends_at,
          loginId: tenant.owner.loginId,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const status = /required|password|invalid/i.test(error.message) ? 400 : 500;
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to create trial' },
      { status },
    );
  }
}

export async function PATCH(request) {
  try {
    const auth = await requirePlatformSuperAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const tenant = await updateTrialTenant(body.id, body);
    if (!tenant) {
      return NextResponse.json({ success: false, message: 'Trial not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: publicTenant(tenant) });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to update trial' },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    const auth = await requirePlatformSuperAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const tenant = await deleteTrialTenant(body.id);
    if (!tenant) {
      return NextResponse.json({ success: false, message: 'Trial not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Trial workspace deleted' });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to delete trial' },
      { status: 400 },
    );
  }
}
