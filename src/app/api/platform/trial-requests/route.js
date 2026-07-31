import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { masterQuery } from '@/lib/db';
import { createTrialTenant, ensurePlatformTrialSchema } from '@/lib/platformTrials';
import { ensureTrialRequestSchema, generateTemporaryPassword } from '@/lib/trialRequests';
import { sendZFlowEmail } from '@/lib/zflowEmail';

async function requirePlatformAdmin(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth;
  if (auth.user.tenant_id) return { error: NextResponse.json({ message: 'Forbidden' }, { status: 403 }) };
  const role = requireRole(auth.user, 'super_admin');
  return role.error ? { error: role.error } : auth;
}

export async function GET(request) {
  const auth = await requirePlatformAdmin(request);
  if (auth.error) return auth.error;
  await ensurePlatformTrialSchema();
  await ensureTrialRequestSchema();
  const result = await masterQuery(
    `SELECT id, email, owner_name, phone, organization_name, business_type, city,
            expected_users, expected_stores, status, verified_at, tenant_id, created_at
     FROM platform_trial_requests
     WHERE status IN ('verified', 'approved', 'rejected')
     ORDER BY created_at DESC`,
  );
  return NextResponse.json({ success: true, data: result.rows });
}

export async function PATCH(request) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (auth.error) return auth.error;
    await ensurePlatformTrialSchema();
    await ensureTrialRequestSchema();
    const body = await request.json();
    const leadResult = await masterQuery(
      `SELECT * FROM platform_trial_requests WHERE id = $1 AND status = 'verified' FOR UPDATE`,
      [Number(body.id)],
    );
    const lead = leadResult.rows[0];
    if (!lead) throw new Error('Verified request not found');
    if (body.action === 'reject') {
      await masterQuery(
        `UPDATE platform_trial_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
        [lead.id],
      );
      return NextResponse.json({ success: true });
    }
    if (body.action !== 'approve') throw new Error('Invalid action');

    const password = generateTemporaryPassword();
    const loginId = String(body.loginId || '')
      .trim()
      .toLowerCase();
    const tenant = await createTrialTenant({
      organizationName: lead.organization_name,
      loginId,
      email: lead.email,
      password,
      name: lead.owner_name,
      phone: lead.phone,
      trialDays: body.trialDays,
      maxUsers: body.maxUsers || lead.expected_users,
      maxStores: body.maxStores || lead.expected_stores,
      permissions: body.permissions,
      createdBy: auth.user.id,
    });
    await masterQuery(
      `UPDATE platform_trial_requests
       SET status = 'approved', tenant_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [lead.id, tenant.id],
    );
    const appUrl = process.env.ZFLOW_APP_URL || 'http://localhost:3001/login';
    await sendZFlowEmail({
      to: lead.email,
      subject: 'Your Z Flow free trial is ready',
      html: `<p>Hello ${lead.owner_name},</p><p>Your isolated Z Flow workspace is ready.</p><p><b>User ID:</b> ${loginId}<br/><b>Temporary password:</b> ${password}</p><p><a href="${appUrl}">Open Z Flow</a></p><p>Please change your password after signing in.</p>`,
    });
    return NextResponse.json({ success: true, data: { tenantId: tenant.id, loginId } });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to process request' },
      { status: 400 },
    );
  }
}
