import bcrypt from 'bcryptjs';
import { dropTenantDatabase, masterQuery, provisionTenantDatabase, tenantQuery } from '@/lib/db';
import { enterTenantContext } from '@/lib/tenant-context';
import { sanitizeTrialPermissions } from '@/lib/trialPermissions';

const TRIAL_STATUSES = new Set(['provisioning', 'active', 'expired', 'suspended', 'paid']);

export async function ensurePlatformTrialSchema() {
  await masterQuery(`
    CREATE TABLE IF NOT EXISTS platform_tenants (
      id BIGSERIAL PRIMARY KEY,
      organization_name VARCHAR(190) NOT NULL,
      slug VARCHAR(80) NOT NULL UNIQUE,
      database_name VARCHAR(120) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'provisioning',
      trial_starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trial_ends_at TIMESTAMPTZ NOT NULL,
      max_users INTEGER NOT NULL DEFAULT 3 CHECK (max_users > 0),
      max_stores INTEGER NOT NULL DEFAULT 1 CHECK (max_stores > 0),
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS platform_trial_users (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
      tenant_user_id BIGINT NOT NULL,
      login_id VARCHAR(190) NOT NULL,
      email VARCHAR(190),
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(30),
      password_hash TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, tenant_user_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS platform_trial_users_login_id_unique
      ON platform_trial_users (LOWER(login_id));
    CREATE UNIQUE INDEX IF NOT EXISTS platform_trial_users_email_unique
      ON platform_trial_users (LOWER(email))
      WHERE email IS NOT NULL AND email <> '';
    CREATE INDEX IF NOT EXISTS platform_tenants_status_expiry
      ON platform_tenants (status, trial_ends_at);
    ALTER TABLE platform_trial_users
      ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
}

export function normalizeTrialSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function assertDatabaseName(value) {
  if (!/^zflow_trial_[a-z0-9_]+$/.test(value)) {
    throw new Error('Invalid tenant database name');
  }
  return value;
}

export async function findTrialLogin(identifier) {
  await ensurePlatformTrialSchema();
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;

  const result = await masterQuery(
    `SELECT
       trial_user.id AS platform_user_id,
       trial_user.tenant_user_id,
       trial_user.login_id,
       trial_user.email,
       trial_user.name,
       trial_user.phone,
       trial_user.password_hash,
       trial_user.permissions,
       trial_user.is_active,
       tenant.id AS tenant_id,
       tenant.organization_name,
       tenant.database_name,
       tenant.status,
       tenant.trial_starts_at,
       tenant.trial_ends_at,
       tenant.max_users,
       tenant.max_stores
     FROM platform_trial_users trial_user
     JOIN platform_tenants tenant ON tenant.id = trial_user.tenant_id
     WHERE LOWER(trial_user.login_id) = $1
        OR LOWER(COALESCE(trial_user.email, '')) = $1
     LIMIT 1`,
    [normalized],
  );
  return result.rows[0] || null;
}

export function getTrialAccessError(trial) {
  if (!trial?.is_active) return 'Trial user is inactive';
  if (trial.status === 'suspended') return 'This trial has been suspended';
  if (!['active', 'paid'].includes(trial.status)) return 'This trial is not active';
  if (trial.status !== 'paid' && new Date(trial.trial_ends_at).getTime() <= Date.now()) {
    return 'Your free trial has expired';
  }
  return null;
}

export async function activateTenantById(tenantId) {
  await ensurePlatformTrialSchema();
  const result = await masterQuery(
    `SELECT id, database_name, status, trial_ends_at
     FROM platform_tenants
     WHERE id = $1
     LIMIT 1`,
    [Number(tenantId)],
  );
  const tenant = result.rows[0];
  const accessError = getTrialAccessError({ ...tenant, is_active: true });
  if (!tenant || accessError) {
    throw new Error(accessError || 'Tenant not found');
  }
  enterTenantContext({
    tenantId: tenant.id,
    databaseName: assertDatabaseName(tenant.database_name),
    trialEndsAt: tenant.trial_ends_at,
  });
  return tenant;
}

export async function createTrialTenant({
  organizationName,
  slug,
  loginId,
  email,
  password,
  name,
  phone,
  trialDays = 14,
  maxUsers = 3,
  maxStores = 1,
  createdBy,
  permissions,
}) {
  await ensurePlatformTrialSchema();

  const normalizedSlug = normalizeTrialSlug(slug || organizationName);
  if (!normalizedSlug) throw new Error('A valid organization name or slug is required');
  if (!String(loginId || '').trim()) throw new Error('User ID is required');
  if (String(password || '').length < 8) throw new Error('Password must contain at least 8 characters');

  const safeDays = Math.min(Math.max(Number(trialDays) || 14, 1), 90);
  const safePermissions = sanitizeTrialPermissions(permissions);
  const provisioningStamp = Date.now().toString(36);
  const tenantSlug = `${normalizedSlug}-${provisioningStamp}`.slice(0, 80);
  const databaseName = assertDatabaseName(
    `zflow_trial_${normalizedSlug.replace(/-/g, '_')}_${provisioningStamp}`,
  );

  const tenantResult = await masterQuery(
    `INSERT INTO platform_tenants
       (organization_name, slug, database_name, status, trial_ends_at, max_users, max_stores, created_by)
     VALUES ($1, $2, $3, 'provisioning', NOW() + ($4 * INTERVAL '1 day'), $5, $6, $7)
     RETURNING *`,
    [
      String(organizationName).trim(),
      tenantSlug,
      databaseName,
      safeDays,
      Math.max(Number(maxUsers) || 3, 1),
      Math.max(Number(maxStores) || 1, 1),
      Number(createdBy) || null,
    ],
  );
  const tenant = tenantResult.rows[0];

  try {
    await provisionTenantDatabase(databaseName);

    const passwordHash = await bcrypt.hash(String(password), 12);
    const tenantUser = await tenantQuery(
      databaseName,
      `INSERT INTO users (name, email, phone, password_hash, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', TRUE, NOW(), NOW())
       RETURNING id, name, email, phone, role`,
      [
        String(name || organizationName).trim(),
        String(email || `${normalizedSlug}@trial.zflow.local`).trim().toLowerCase(),
        String(phone || `trial-${tenant.id}`).trim(),
        passwordHash,
      ],
    );

    const owner = tenantUser.rows[0];
    const defaultStore = await tenantQuery(
      databaseName,
      `INSERT INTO stores (name, created_at)
       VALUES ($1, NOW())
       RETURNING id`,
      [`${String(organizationName).trim()} - Main Store`],
    );
    await tenantQuery(
      databaseName,
      `INSERT INTO user_stores (user_id, store_id, is_active, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())`,
      [owner.id, defaultStore.rows[0].id],
    );

    await masterQuery(
      `INSERT INTO platform_trial_users
         (tenant_id, tenant_user_id, login_id, email, name, phone, password_hash, permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        tenant.id,
        owner.id,
        String(loginId).trim().toLowerCase(),
        email ? String(email).trim().toLowerCase() : null,
        owner.name,
        owner.phone,
        passwordHash,
        JSON.stringify(safePermissions),
      ],
    );
    await masterQuery(
      `UPDATE platform_tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [tenant.id],
    );
    return { ...tenant, status: 'active', owner: { ...owner, loginId: String(loginId).trim() } };
  } catch (error) {
    await masterQuery(
      `UPDATE platform_tenants
       SET status = 'suspended', metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [tenant.id, JSON.stringify({ provisioningError: error.message })],
    ).catch(() => {});
    throw error;
  }
}

export async function updateTrialTenant(id, changes = {}) {
  await ensurePlatformTrialSchema();
  const status = changes.status ? String(changes.status) : null;
  if (status && !TRIAL_STATUSES.has(status)) throw new Error('Invalid trial status');
  const extensionDays = Math.min(Math.max(Number(changes.extendDays) || 0, 0), 365);

  const result = await masterQuery(
    `UPDATE platform_tenants
     SET status = COALESCE($2, status),
         trial_ends_at = CASE
           WHEN $3::int > 0 THEN GREATEST(trial_ends_at, NOW()) + ($3 * INTERVAL '1 day')
           ELSE trial_ends_at
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [Number(id), status, extensionDays],
  );
  return result.rows[0] || null;
}

export async function deleteTrialTenant(id) {
  await ensurePlatformTrialSchema();
  const result = await masterQuery(
    'SELECT id, database_name, organization_name FROM platform_tenants WHERE id = $1',
    [Number(id)],
  );
  const tenant = result.rows[0];
  if (!tenant) return null;

  await dropTenantDatabase(tenant.database_name);
  await masterQuery('DELETE FROM platform_tenants WHERE id = $1', [tenant.id]);
  return tenant;
}
