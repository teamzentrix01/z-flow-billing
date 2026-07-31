import crypto from 'node:crypto';
import { masterQuery } from '@/lib/db';

export async function ensureTrialRequestSchema() {
  await masterQuery(`
    CREATE TABLE IF NOT EXISTS platform_trial_requests (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(190) NOT NULL,
      owner_name VARCHAR(120) NOT NULL,
      phone VARCHAR(30),
      organization_name VARCHAR(190) NOT NULL,
      business_type VARCHAR(80),
      city VARCHAR(100),
      expected_users INTEGER NOT NULL DEFAULT 1,
      expected_stores INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(30) NOT NULL DEFAULT 'otp_pending',
      otp_hash TEXT,
      otp_expires_at TIMESTAMPTZ,
      otp_attempts INTEGER NOT NULL DEFAULT 0,
      verified_at TIMESTAMPTZ,
      tenant_id BIGINT REFERENCES platform_tenants(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS platform_trial_requests_email_idx
      ON platform_trial_requests (LOWER(email), created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_trial_requests_status_idx
      ON platform_trial_requests (status, created_at DESC);
  `);
}

export function hashOtp(email, otp) {
  return crypto
    .createHmac('sha256', process.env.TRIAL_OTP_SECRET || process.env.JWT_SECRET || 'zflow-dev-otp')
    .update(`${String(email).trim().toLowerCase()}:${otp}`)
    .digest('hex');
}

export function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export function generateTemporaryPassword() {
  return `Zf!${crypto.randomBytes(9).toString('base64url')}`;
}

export function validateTrialRequest(input) {
  const email = String(input.email || '').trim().toLowerCase();
  const ownerName = String(input.ownerName || '').trim();
  const organizationName = String(input.organizationName || '').trim();
  const phone = String(input.phone || '').replace(/\D/g, '');
  const businessType = String(input.businessType || '').trim();
  const city = String(input.city || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email is required');
  if (email.length > 190) throw new Error('Email is too long');
  if (ownerName.length < 2 || ownerName.length > 80) throw new Error('Owner name must be 2 to 80 characters');
  if (organizationName.length < 2 || organizationName.length > 120) throw new Error('Business name must be 2 to 120 characters');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Valid 10-digit Indian mobile number is required');
  if (!businessType || businessType.length > 80) throw new Error('Business type is required');
  if (city.length < 2 || city.length > 80) throw new Error('City is required');
  if (input.consent !== true) throw new Error('Contact consent is required');
  const expectedUsers = Number(input.expectedUsers);
  const expectedStores = Number(input.expectedStores);
  if (!Number.isInteger(expectedUsers) || expectedUsers < 1 || expectedUsers > 50) {
    throw new Error('Expected users must be between 1 and 50');
  }
  if (!Number.isInteger(expectedStores) || expectedStores < 1 || expectedStores > 50) {
    throw new Error('Expected stores must be between 1 and 50');
  }
  return {
    email,
    ownerName,
    organizationName,
    phone,
    businessType,
    city,
    expectedUsers,
    expectedStores,
  };
}
