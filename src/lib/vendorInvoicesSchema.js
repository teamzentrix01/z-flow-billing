import { query } from '@/lib/db';

let ensured = false;

export async function ensureVendorInvoicesSchema() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS vendor_invoices (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(50) UNIQUE,
      vendor_id INTEGER NOT NULL REFERENCES vendors(id),
      purchase_order_id INTEGER REFERENCES purchase_orders(id),
      stock_in_id INTEGER,
      invoice_number VARCHAR(100) NOT NULL,
      total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
      due_date DATE,
      invoice_date DATE DEFAULT NOW(),
      created_by VARCHAR(255),
      remarks TEXT,
      status VARCHAR(20) DEFAULT 'Pending',
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE vendor_invoices
      ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS vendor_id INTEGER,
      ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER,
      ADD COLUMN IF NOT EXISTS stock_in_id INTEGER,
      ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100),
      ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS due_date DATE,
      ADD COLUMN IF NOT EXISTS invoice_date DATE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    UPDATE vendor_invoices
    SET transaction_id = COALESCE(transaction_id, 'INV-' || LPAD(id::text, 4, '0'))
    WHERE transaction_id IS NULL;

    UPDATE vendor_invoices
    SET status = CASE
      WHEN COALESCE(amount_paid, 0) >= COALESCE(total_amount, 0) AND COALESCE(total_amount, 0) > 0 THEN 'Paid'
      WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partial'
      ELSE COALESCE(NULLIF(status, ''), 'Pending')
    END;

    CREATE TABLE IF NOT EXISTS vendor_invoice_settlements (
      id SERIAL PRIMARY KEY,
      vendor_invoice_id INTEGER NOT NULL REFERENCES vendor_invoices(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      payment_mode VARCHAR(50) NOT NULL DEFAULT 'Cash',
      reference_no VARCHAR(120),
      settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
      settled_by VARCHAR(255),
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_vendor_invoices_vendor_id ON vendor_invoices(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_invoices_stock_in_id ON vendor_invoices(stock_in_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_invoices_status ON vendor_invoices(status);
    CREATE INDEX IF NOT EXISTS idx_vendor_invoices_invoice_number ON vendor_invoices(invoice_number);
    CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_stock_in_unique_idx
      ON vendor_invoices(stock_in_id)
      WHERE stock_in_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_vendor_invoice_settlements_invoice_id ON vendor_invoice_settlements(vendor_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_invoice_settlements_date ON vendor_invoice_settlements(settlement_date);
  `);
  ensured = true;
}
