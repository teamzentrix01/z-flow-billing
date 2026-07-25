import { query } from '@/lib/db';

let ensured = false;

export async function ensureEmployeeDepartmentsSchema() {
  if (ensured) return;

  await query(`
    CREATE TABLE IF NOT EXISTS employee_departments (
      id SERIAL PRIMARY KEY,
      department_name VARCHAR(255) NOT NULL UNIQUE,
      user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      description TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  ensured = true;
}

export default null;