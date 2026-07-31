import { NextResponse } from 'next/server';
import { masterQuery } from '@/lib/db';
import {
  ensureTrialRequestSchema,
  generateOtp,
  hashOtp,
  validateTrialRequest,
} from '@/lib/trialRequests';
import { sendZFlowEmail } from '@/lib/zflowEmail';
import { ensurePlatformTrialSchema } from '@/lib/platformTrials';

function authorized(request) {
  const expected =
    process.env.ZFLOW_SITE_INTEGRATION_KEY ||
    (process.env.NODE_ENV !== 'production' ? 'zflow-local-site-integration' : '');
  return Boolean(expected && request.headers.get('x-zflow-integration-key') === expected);
}

export async function POST(request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    await ensurePlatformTrialSchema();
    await ensureTrialRequestSchema();
    const body = await request.json();
    if (body.action === 'request_otp') {
      const input = validateTrialRequest(body);
      const recent = await masterQuery(
        `SELECT COUNT(*)::int AS count FROM platform_trial_requests
         WHERE LOWER(email) = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [input.email],
      );
      if (Number(recent.rows[0]?.count || 0) >= 5) throw new Error('Please try again later');
      const otp = generateOtp();
      const result = await masterQuery(
        `INSERT INTO platform_trial_requests
          (email, owner_name, phone, organization_name, business_type, city,
           expected_users, expected_stores, otp_hash, otp_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() + INTERVAL '10 minutes')
         RETURNING id`,
        [
          input.email, input.ownerName, input.phone, input.organizationName,
          input.businessType, input.city, input.expectedUsers, input.expectedStores,
          hashOtp(input.email, otp),
        ],
      );
      try {
        await sendZFlowEmail({
          to: input.email,
          subject: 'Your Z Flow verification code',
          html: `<p>Hello ${input.ownerName},</p><p>Your Z Flow verification code is:</p><h1>${otp}</h1><p>This code expires in 10 minutes.</p>`,
        });
      } catch (error) {
        await masterQuery(`DELETE FROM platform_trial_requests WHERE id = $1`, [result.rows[0].id]);
        throw error;
      }
      return NextResponse.json({
        success: true,
        requestId: result.rows[0].id,
      });
    }
    if (body.action === 'verify_otp') {
      const id = Number(body.requestId);
      const otp = String(body.otp || '').trim();
      const result = await masterQuery(
        `UPDATE platform_trial_requests
         SET status = 'verified', verified_at = NOW(), otp_hash = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'otp_pending' AND otp_expires_at > NOW()
           AND otp_attempts < 5 AND otp_hash = $2
         RETURNING id`,
        [id, hashOtp(body.email, otp)],
      );
      if (!result.rowCount) {
        await masterQuery(
          `UPDATE platform_trial_requests SET otp_attempts = otp_attempts + 1 WHERE id = $1`,
          [id],
        );
        throw new Error('Invalid or expired OTP');
      }
      return NextResponse.json({ success: true, message: 'Trial request verified' });
    }
    throw new Error('Invalid action');
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message || 'Unable to process trial request' },
      { status: 400 },
    );
  }
}
