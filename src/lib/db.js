import { Pool } from 'pg';
import { getTenantContext } from '@/lib/tenant-context';

// Singleton pool — reuse across hot reloads in dev
const globalForPg = globalThis;

if (!globalForPg._pgPool) {
  const poolMax = Number(process.env.PG_POOL_MAX || 20);
  const idleTimeoutMs = Number(process.env.PG_IDLE_TIMEOUT_MS || 30000);
  const connectTimeoutMs = Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000);
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true' || /sslmode=require/i.test(databaseUrl);
  const ssl = useSsl ? { rejectUnauthorized: false } : false;

  const baseConfig = databaseUrl
    ? { connectionString: databaseUrl }
    : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'buyzaar_sync',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

  globalForPg._pgPool = new Pool({
    ...baseConfig,
    ssl,
    max: Number.isFinite(poolMax) ? poolMax : 20,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : 30000,
    connectionTimeoutMillis: Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : 10000,
  });

  globalForPg._pgPool.on('error', (err) => {
    console.error('PostgreSQL Pool Error:', err);
  });
}

const pool = globalForPg._pgPool;
const masterPool = pool;

if (!globalForPg._zFlowTenantPools) {
  globalForPg._zFlowTenantPools = new Map();
}
const tenantPools = globalForPg._zFlowTenantPools;

function assertDatabaseName(databaseName) {
  const value = String(databaseName || '');
  if (!/^zflow_trial_[a-z0-9_]+$/.test(value)) {
    throw new Error('Invalid tenant database name');
  }
  return value;
}

function tenantPoolConfig(databaseName) {
  const safeDatabaseName = assertDatabaseName(databaseName);
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    url.pathname = `/${safeDatabaseName}`;
    return {
      connectionString: url.toString(),
      ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' || /sslmode=require/i.test(databaseUrl)
        ? { rejectUnauthorized: false }
        : false,
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: safeDatabaseName,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  };
}

export function getTenantPool(databaseName) {
  const safeDatabaseName = assertDatabaseName(databaseName);
  if (!tenantPools.has(safeDatabaseName)) {
    const tenantPool = new Pool({
      ...tenantPoolConfig(safeDatabaseName),
      max: Number(process.env.TENANT_PG_POOL_MAX || 5),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
    });
    tenantPool.on('error', (err) => {
      console.error(`[TENANT DB ${safeDatabaseName}]`, err.message);
    });
    tenantPools.set(safeDatabaseName, tenantPool);
  }
  return tenantPools.get(safeDatabaseName);
}

function activePool() {
  const context = getTenantContext();
  return context?.databaseName ? getTenantPool(context.databaseName) : masterPool;
}
const shouldLogQueries = process.env.NODE_ENV !== 'production' || process.env.DEBUG_SQL === 'true';

/**
 * Run a query with automatic retry on deadlock / serialization failure.
 * DDL statements that use IF NOT EXISTS are idempotent, so retrying is safe.
 *
 * @param {string} text   - SQL query
 * @param {any[]}  params - Query parameters ($1, $2 …)
 * @param {object} opts   - { maxRetries?: number }
 */
export async function query(text, params = [], { maxRetries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();
    try {
      const res = await activePool().query(text, params);
      const duration = Date.now() - start;
      if (shouldLogQueries) {
        console.log(`[DB] ${duration}ms — ${text.substring(0, 80)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      // Retry on deadlock (40P01) or serialization failure (40001) — both are transient
      const isRetryable = err.code === '40P01' || err.code === '40001';
      if (isRetryable && attempt < maxRetries) {
        const delayMs = 80 * Math.pow(2, attempt); // 80ms → 160ms → 320ms
        console.warn(`[DB] Retryable error (${err.code}) on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delayMs}ms…`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      console.error('[DB ERROR]', err.message, '\nQuery:', text);
      throw err;
    }
  }
  // Should never reach here, but satisfy linter
  throw lastErr;
}

/**
 * Get a client for transactions
 */
export async function getClient() {
  return await activePool().connect();
}

export async function masterQuery(text, params = []) {
  return masterPool.query(text, params);
}

export async function tenantQuery(databaseName, text, params = []) {
  return getTenantPool(databaseName).query(text, params);
}

export async function provisionTenantDatabase(databaseName) {
  const safeDatabaseName = assertDatabaseName(databaseName);
  const templateName = String(process.env.TRIAL_TEMPLATE_DB || 'z_flow_trial_template');
  if (!/^[a-zA-Z0-9_]+$/.test(templateName)) throw new Error('Invalid trial template database name');

  const maintenanceConfig = tenantPoolConfig(safeDatabaseName);
  if (maintenanceConfig.connectionString) {
    const url = new URL(maintenanceConfig.connectionString);
    url.pathname = `/${process.env.PG_MAINTENANCE_DB || 'postgres'}`;
    maintenanceConfig.connectionString = url.toString();
  } else {
    maintenanceConfig.database = process.env.PG_MAINTENANCE_DB || 'postgres';
  }

  const maintenancePool = new Pool({ ...maintenanceConfig, max: 1 });
  try {
    const existing = await maintenancePool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [safeDatabaseName],
    );
    if (existing.rowCount === 0) {
      await maintenancePool.query(
        `CREATE DATABASE "${safeDatabaseName}" TEMPLATE "${templateName}"`,
      );
    }
  } finally {
    await maintenancePool.end();
  }
}

export default masterPool;
