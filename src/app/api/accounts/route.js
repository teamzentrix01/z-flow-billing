import { NextResponse } from "next/server";
import { getClient, query } from "@/lib/db";
import { ensureAccountsSchema } from "@/lib/accountsSchema";
import {
  appendStoreScope,
  auditLog,
  requireAuth,
  requirePermission,
  requireStore,
} from "@/lib/api-protection";

const ACCOUNT_PERMISSIONS = [
  "ACCESS_ACCOUNTS",
  "VIEW_ACCOUNTS",
  "MANAGE_ACCOUNTS",
  "APPROVE_FINANCE",
  "MANAGE_VENDOR_PAYMENTS",
  "VIEW_FINANCIAL_REPORTS",
  "MANAGE_PURCHASE_ORDERS",
  "MANAGE_VENDORS",
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 10) : null;
}

function requiredText(value) {
  return String(value || "").trim();
}

function invoiceStatus(total, paid) {
  if (paid >= total && total > 0) return "Paid";
  if (paid > 0) return "Partial";
  return "Pending";
}

function canManageAccounts(user) {
  if (user?.role === "super_admin") return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return (
    permissions.includes("*") ||
    permissions.includes("MANAGE_ACCOUNTS") ||
    permissions.includes("APPROVE_FINANCE")
  );
}

async function logAccountAction(user, action, resourceType, resourceId, details) {
  await auditLog(user?.id, `accounts.${action}`, resourceType, resourceId, details);
}

async function loadStores(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "s.id", authUser);
  if (scope.error) return [];
  const stores = await query(
    `SELECT DISTINCT ON (s.id) s.id, s.name, s.opening_time, s.closing_time, s.meta
     FROM stores s
     ${where.length ? `WHERE ${where.join(" AND ")} AND s.is_active = TRUE` : "WHERE s.is_active = TRUE"}
     ORDER BY s.id, s.name ASC`,
    params,
  );
  return stores.rows
  .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
  .map((row) => ({
    id: row.id,
    name: row.name,
    openingTime: row.opening_time || "",
    closingTime: row.closing_time || "",
    locationType: row.meta?.locationType || "",
  }));
}

async function loadStoreCashSummary(authUser) {
  const where = [`s.is_active = TRUE`];
  const params = [];
  const scope = appendStoreScope(where, params, "s.id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT
       s.id AS store_id,
       s.name AS store_name,
       s.opening_time,
       s.closing_time,
       COALESCE(scb.current_cash, 0) AS current_cash,
       COALESCE(SUM(CASE WHEN sct.direction = 'in' THEN sct.amount ELSE 0 END), 0) AS cash_in_today,
       COALESCE(SUM(CASE WHEN sct.direction = 'out' THEN sct.amount ELSE 0 END), 0) AS cash_out_today,
       MAX(sct.created_at) AS last_cash_activity
     FROM stores s
     LEFT JOIN store_cash_balances scb ON scb.store_id = s.id
     LEFT JOIN store_cash_transactions sct
       ON sct.store_id = s.id
      AND sct.transaction_date = CURRENT_DATE
     WHERE ${where.join(" AND ")}
     GROUP BY s.id, s.name, s.opening_time, s.closing_time, scb.current_cash
     ORDER BY s.name ASC`,
    params,
  );
  return res.rows;
}

async function loadBankAccounts(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "aba.store_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT aba.*, s.name AS store_name
     FROM account_bank_accounts aba
     LEFT JOIN stores s ON s.id = aba.store_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY aba.updated_at DESC, aba.id DESC`,
    params,
  );
  return res.rows;
}

async function loadCashDeposits(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "acd.store_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT acd.*, s.name AS store_name, aba.bank_name
     FROM account_cash_deposits acd
     LEFT JOIN stores s ON s.id = acd.store_id
     LEFT JOIN account_bank_accounts aba ON aba.id = acd.bank_account_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY acd.deposit_date DESC, acd.id DESC
     LIMIT 200`,
    params,
  );
  return res.rows;
}

async function loadStoreCashTransactions(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "sct.store_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT sct.*, s.name AS store_name, u.name AS user_name
     FROM store_cash_transactions sct
     LEFT JOIN stores s ON s.id = sct.store_id
     LEFT JOIN users u ON u.id = sct.created_by
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY sct.transaction_date DESC, sct.id DESC
     LIMIT 200`,
    params,
  );
  return res.rows;
}

async function loadAccountExpenses(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "ae.store_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT ae.*, s.name AS store_name
     FROM account_expenses ae
     LEFT JOIN stores s ON s.id = ae.store_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ae.expense_date DESC, ae.id DESC
     LIMIT 200`,
    params,
  );
  return res.rows;
}

async function loadImprest(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "ai.store_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT ai.*, s.name AS store_name
     FROM account_imprest ai
     LEFT JOIN stores s ON s.id = ai.store_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY s.name ASC`,
    params,
  );
  return res.rows;
}

async function runScopedScalar(authUser, columnName, sqlBuilder) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, columnName, authUser);
  if (scope.error) return 0;
  const res = await query(sqlBuilder(where, params), params).catch(() => ({ rows: [{ total: 0 }] }));
  return toNumber(res.rows[0]?.total);
}

async function loadDashboard(authUser) {
  const storeWhere = [];
  const storeParams = [];
  const scope = appendStoreScope(storeWhere, storeParams, "s.id", authUser);
  if (scope.error) {
    return {
      cashToday: 0,
      bankBalance: 0,
      vendorDue: 0,
      pendingApprovals: 0,
      pdcDue: 0,
      outstandingReceivables: 0,
      lowImprest: 0,
      cashNotDeposited: 0,
    };
  }
  const storeSql = storeWhere.length ? `WHERE ${storeWhere.join(" AND ")}` : "";

  const cashToday = await query(
    `SELECT COALESCE(SUM(sbp.amount), 0) AS total
     FROM sales_bills sb
     INNER JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
     INNER JOIN stores s ON s.id = sb.store_id
     ${storeSql ? `${storeSql} AND` : "WHERE"} sb.created_at >= CURRENT_DATE
       AND sb.status IN ('paid', 'completed')
       AND LOWER(COALESCE(sbp.method, '')) = 'cash'`,
    storeParams,
  ).catch(() => ({ rows: [{ total: 0 }] }));

  const bankBalance = await runScopedScalar(authUser, "aba.store_id", (where) => (
    `SELECT COALESCE(SUM(aba.current_balance), 0) AS total
     FROM account_bank_accounts aba
     WHERE aba.status = 'active'${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const vendorDue = await runScopedScalar(authUser, "COALESCE(po.destination_id, si.destination_id)", (where) => (
    `SELECT COALESCE(SUM(GREATEST(vi.total_amount - vi.amount_paid, 0)), 0) AS total
     FROM vendor_invoices vi
     LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
     LEFT JOIN stock_in si ON si.id = vi.stock_in_id
     WHERE LOWER(COALESCE(vi.status, 'pending')) <> 'paid'${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const proposalApprovals = await runScopedScalar(authUser, "COALESCE(po.destination_id, si.destination_id)", (where) => (
    `SELECT COUNT(*) AS total
     FROM account_payment_proposals app
     JOIN vendor_invoices vi ON vi.id = app.vendor_invoice_id
     LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
     LEFT JOIN stock_in si ON si.id = vi.stock_in_id
     WHERE app.status IN ('proposed', 'verified')${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const expenseApprovals = await runScopedScalar(authUser, "ae.store_id", (where) => (
    `SELECT COUNT(*) AS total
     FROM account_expenses ae
     WHERE ae.status IN ('submitted', 'area_verified')${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const pdcDue = await query(
    `SELECT COUNT(*) AS total
     FROM account_cheques
     WHERE status IN ('safe_custody', 'deposit_due')
       AND due_date <= CURRENT_DATE + INTERVAL '7 days'`,
  ).catch(() => ({ rows: [{ total: 0 }] }));

  const receivables = await runScopedScalar(authUser, "sb.store_id", (where) => (
    `SELECT COALESCE(SUM(GREATEST(COALESCE(sb.grand_total, 0) - COALESCE(sb.paid_amount, 0), 0)), 0) AS total
     FROM sales_bills sb
     WHERE sb.status IN ('pending', 'partial', 'credit')${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const lowImprest = await runScopedScalar(authUser, "ai.store_id", (where) => (
    `SELECT COUNT(*) AS total
     FROM account_imprest ai
     WHERE ai.current_balance <= ai.low_balance_threshold${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  const cashNotDeposited = await runScopedScalar(authUser, "scb.store_id", (where) => (
    `SELECT COUNT(*) AS total
     FROM store_cash_balances scb
     WHERE scb.current_cash > 0
       AND NOT EXISTS (
         SELECT 1 FROM account_cash_deposits acd
         WHERE acd.store_id = scb.store_id
           AND acd.deposit_date >= CURRENT_DATE - INTERVAL '1 day'
       )${where.length ? ` AND ${where.join(" AND ")}` : ""}`
  ));

  return {
    cashToday: toNumber(cashToday.rows[0]?.total),
    bankBalance,
    vendorDue,
    pendingApprovals: proposalApprovals + expenseApprovals,
    pdcDue: toNumber(pdcDue.rows[0]?.total),
    outstandingReceivables: receivables,
    lowImprest,
    cashNotDeposited,
  };
}

async function loadVendorPaymentData(authUser) {
  const where = [`LOWER(COALESCE(vi.status, 'pending')) <> 'paid'`];
  const params = [];
  const scope = appendStoreScope(where, params, "COALESCE(po.destination_id, si.destination_id)", authUser);
  if (scope.error) return [];
  const invoices = await query(
    `SELECT
       vi.id,
       vi.transaction_id,
       vi.invoice_number,
       vi.vendor_id,
       vi.purchase_order_id,
       vi.stock_in_id,
       vi.total_amount,
       vi.amount_paid,
       vi.due_date,
       vi.invoice_date,
       vi.status,
       v.name AS vendor_name,
       po.transaction_id AS po_number,
       si.transaction_id AS grn_number,
       si.status AS grn_status,
       ap.id AS proposal_id,
       ap.status AS proposal_status,
       ap.utr_number
     FROM vendor_invoices vi
     LEFT JOIN vendors v ON v.id = vi.vendor_id
     LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
     LEFT JOIN stock_in si ON si.id = vi.stock_in_id
     LEFT JOIN LATERAL (
       SELECT app.id, app.status, app.utr_number
       FROM account_payment_proposals app
       WHERE app.vendor_invoice_id = vi.id
       ORDER BY
         CASE WHEN app.status IN ('proposed', 'verified', 'approved') THEN 0 ELSE 1 END,
         app.id DESC
       LIMIT 1
     ) ap ON TRUE
     WHERE ${where.join(" AND ")}
     ORDER BY vi.due_date ASC NULLS LAST, vi.created_at DESC
     LIMIT 300`,
    params,
  );

  return invoices.rows.map((row) => {
    const total = toNumber(row.total_amount);
    const paid = toNumber(row.amount_paid);
    return {
      id: row.id,
      transactionId: row.transaction_id,
      invoiceNumber: row.invoice_number,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name || "Vendor",
      purchaseOrderId: row.purchase_order_id,
      poNumber: row.po_number || "",
      grnId: row.stock_in_id,
      grnNumber: row.grn_number || "",
      hasPurchaseOrder: Boolean(row.purchase_order_id),
      hasFinalGrn: Boolean(row.stock_in_id && row.grn_status === "confirmed"),
      totalAmount: total,
      amountPaid: paid,
      amountLeft: Math.max(total - paid, 0),
      dueDate: row.due_date,
      invoiceDate: row.invoice_date,
      status: row.status || "Pending",
      proposalId: row.proposal_id,
      proposalStatus: row.proposal_status || "",
      hasActiveProposal: ["proposed", "verified", "approved"].includes(String(row.proposal_status || "").toLowerCase()),
      utrNumber: row.utr_number || "",
      dueStatus: row.due_date && new Date(row.due_date) < new Date(new Date().toISOString().slice(0, 10)) ? "overdue" : "due",
    };
  });
}

async function loadPaymentProposals(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "COALESCE(po.destination_id, si.destination_id)", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT
       app.id,
       app.vendor_invoice_id,
       app.vendor_id,
       app.purchase_order_id,
       app.amount,
       app.due_date,
       app.status,
       app.approval_reason,
       app.utr_number,
       app.paid_date,
       app.created_at,
       v.name AS vendor_name,
       vi.invoice_number,
       vi.total_amount,
       vi.amount_paid,
       po.transaction_id AS po_number,
       si.transaction_id AS grn_number,
       si.status AS grn_status
     FROM account_payment_proposals app
     JOIN vendor_invoices vi ON vi.id = app.vendor_invoice_id
     LEFT JOIN vendors v ON v.id = app.vendor_id
     LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
     LEFT JOIN stock_in si ON si.id = vi.stock_in_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY app.updated_at DESC NULLS LAST, app.created_at DESC, app.id DESC
     LIMIT 300`,
    params,
  );
  return res.rows.map((row) => ({
    id: row.id,
    vendorInvoiceId: row.vendor_invoice_id,
    vendorId: row.vendor_id,
    purchaseOrderId: row.purchase_order_id,
    amount: toNumber(row.amount),
    dueDate: row.due_date,
    status: row.status || "proposed",
    approvalReason: row.approval_reason || "",
    utrNumber: row.utr_number || "",
    paidDate: row.paid_date,
    createdAt: row.created_at,
    vendorName: row.vendor_name || "Vendor",
    invoiceNumber: row.invoice_number || `Invoice ${row.vendor_invoice_id}`,
    totalAmount: toNumber(row.total_amount),
    amountPaid: toNumber(row.amount_paid),
    poNumber: row.po_number || "",
    grnNumber: row.grn_number || "",
    hasFinalGrn: Boolean(row.grn_number && row.grn_status === "confirmed"),
  }));
}

async function loadPurchaseOrders(authUser) {
  const where = [];
  const params = [];
  const scope = appendStoreScope(where, params, "po.destination_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT po.id, po.transaction_id, po.destination_id, po.vendor_id, po.status, po.total_cost,
            po.created_at, s.name AS destination_name, v.name AS vendor_name
     FROM purchase_orders po
     LEFT JOIN stores s ON s.id = po.destination_id
     LEFT JOIN vendors v ON v.id = po.vendor_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY po.created_at DESC
     LIMIT 300`,
    params,
  );
  return res.rows;
}

async function loadGrns(authUser) {
  const where = [`si.reference_type = 'purchase_order'`];
  const params = [];
  const scope = appendStoreScope(where, params, "si.destination_id", authUser);
  if (scope.error) return [];
  const res = await query(
    `SELECT si.id, si.transaction_id, si.reference_id, si.vendor_id, si.vendor_name, si.destination_id,
            si.status, si.total_cost, si.confirmed_at, si.created_at
     FROM stock_in si
     WHERE ${where.join(" AND ")}
     ORDER BY si.confirmed_at DESC NULLS LAST, si.created_at DESC
     LIMIT 300`,
    params,
  );
  return res.rows;
}

export async function GET(request) {
  try {
    await ensureAccountsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, ...ACCOUNT_PERMISSIONS);
    if (permissionCheck.error) return permissionCheck.error;

    const [
      dashboard,
      stores,
      vendors,
      purchaseOrders,
      grns,
      vendorInvoices,
      paymentProposals,
      bankAccounts,
      storeCashSummary,
      cashTransactions,
      cashDeposits,
      cheques,
      expenses,
      imprest,
      calendar,
      documents,
      tally,
      audit,
    ] = await Promise.all([
      loadDashboard(auth.user),
      loadStores(auth.user),
      query(
        `SELECT id, name, CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status
         FROM vendors
         ORDER BY name ASC
         LIMIT 500`,
      ).then((res) => res.rows),
      loadPurchaseOrders(auth.user),
      loadGrns(auth.user),
      loadVendorPaymentData(auth.user),
      loadPaymentProposals(auth.user),
      loadBankAccounts(auth.user),
      loadStoreCashSummary(auth.user),
      loadStoreCashTransactions(auth.user),
      loadCashDeposits(auth.user),
      query(`SELECT * FROM account_cheques ORDER BY due_date ASC NULLS LAST, id DESC LIMIT 200`).then((res) => res.rows),
      loadAccountExpenses(auth.user),
      loadImprest(auth.user),
      query(`SELECT * FROM account_calendar_reminders ORDER BY due_date ASC, id DESC LIMIT 200`).then((res) => res.rows),
      query(`SELECT * FROM account_documents ORDER BY created_at DESC LIMIT 200`).then((res) => res.rows),
      query(`SELECT * FROM account_tally_sync_queue ORDER BY created_at DESC LIMIT 200`).then((res) => res.rows),
      query(
        `SELECT al.id, al.action, al.resource_type, al.resource_id, al.details, al.created_at, u.name AS user_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action LIKE 'accounts.%'
         ORDER BY al.created_at DESC
         LIMIT 200`,
      ).then((res) => res.rows).catch(() => []),
    ]);

    return NextResponse.json({
      dashboard,
      stores,
      vendors,
      purchaseOrders,
      grns,
      vendorInvoices,
      paymentProposals,
      bankAccounts,
      storeCashSummary,
      cashTransactions,
      cashDeposits,
      cheques,
      expenses,
      imprest,
      calendar,
      documents,
      tally,
      audit,
    });
  } catch (err) {
    console.error("[accounts GET]", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to load accounts data" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  let client;
  try {
    await ensureAccountsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const action = String(body.action || "").trim();
    const actionPermissions = {
      cash_close: ["ACCESS_ACCOUNTS", "MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      document: ["ACCESS_ACCOUNTS", "MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      expense: ["ACCESS_ACCOUNTS", "MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      expense_status: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      bank_account: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      cash_deposit: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      cheque: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      cheque_status: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      calendar: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      imprest: ["MANAGE_ACCOUNTS", "APPROVE_FINANCE"],
      payment_proposal: ["MANAGE_ACCOUNTS", "MANAGE_VENDOR_PAYMENTS", "APPROVE_FINANCE"],
      approve_proposal: ["APPROVE_FINANCE", "MANAGE_ACCOUNTS"],
      mark_vendor_paid: ["MANAGE_VENDOR_PAYMENTS", "APPROVE_FINANCE", "MANAGE_ACCOUNTS"],
      tally_push: ["APPROVE_FINANCE", "MANAGE_ACCOUNTS"],
    };
    const permissionCheck = requirePermission(auth.user, ...(actionPermissions[action] || ["MANAGE_ACCOUNTS"]));
    if (permissionCheck.error) return permissionCheck.error;

    client = await getClient();
    await client.query("BEGIN");

    let result = {};

    if (action === "bank_account") {
      const storeId = Number(body.storeId || 0) || null;
      if (!storeId) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Store is required" }, { status: 400 });
      }
      const bankName = requiredText(body.bankName);
      const accountNumber = requiredText(body.accountNumber);
      if (!bankName || !accountNumber) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Bank name and account number are required" }, { status: 400 });
      }
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query("ROLLBACK");
        return storeCheck.error;
      }
      const insert = await client.query(
        `INSERT INTO account_bank_accounts (
          store_id, bank_name, account_number, ifsc, branch, current_balance, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        RETURNING id`,
        [
          storeId,
          bankName,
          accountNumber,
          body.ifsc || null,
          body.branch || null,
          toNumber(body.currentBalance),
          body.remarks || null,
          auth.user.id,
          JSON.stringify(body),
        ],
      );
      result = { id: insert.rows[0].id };
      await logAccountAction(auth.user, "bank_account.create", "account_bank_account", result.id, body);
    } else if (action === "cash_deposit") {
      const storeId = Number(body.storeId || 0);
      const bankAccountId = Number(body.bankAccountId || 0) || null;
      const amount = toNumber(body.amount);
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query("ROLLBACK");
        return storeCheck.error;
      }
      if (!storeId || !bankAccountId || amount <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Store, bank account and amount are required" }, { status: 400 });
      }
      if (bankAccountId) {
        const bankStore = await client.query(
          `SELECT store_id FROM account_bank_accounts WHERE id = $1`,
          [bankAccountId],
        );
        if (!bankStore.rows[0] || Number(bankStore.rows[0].store_id) !== storeId) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Bank account does not belong to the selected store" }, { status: 400 });
        }
      }
      const balance = await client.query(
        `SELECT current_cash FROM store_cash_balances WHERE store_id = $1 FOR UPDATE`,
        [storeId],
      );
      const currentCash = toNumber(balance.rows[0]?.current_cash);
      if (currentCash < amount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Deposit amount is higher than store cash balance" }, { status: 400 });
      }
      const nextCash = Number((currentCash - amount).toFixed(2));
      await client.query(
        `UPDATE store_cash_balances SET current_cash = $1, updated_at = NOW() WHERE store_id = $2`,
        [nextCash, storeId],
      );
      const deposit = await client.query(
        `INSERT INTO account_cash_deposits (
          store_id, bank_account_id, amount, deposit_date, reference_no, status, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,'deposited',$6,$7,$8::jsonb)
        RETURNING id`,
        [storeId, bankAccountId, amount, toDate(body.depositDate) || new Date().toISOString().slice(0, 10), body.referenceNo || null, body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      await client.query(
        `INSERT INTO store_cash_transactions (
          store_id, transaction_type, direction, amount, balance_after, transaction_date,
          reference_type, reference_id, remarks, created_by, meta
        ) VALUES ($1,'bank_deposit','out',$2,$3,$4,'account_cash_deposit',$5,$6,$7,$8::jsonb)`,
        [storeId, amount, nextCash, toDate(body.depositDate) || new Date().toISOString().slice(0, 10), String(deposit.rows[0].id), body.remarks || "Cash deposited to bank", auth.user.id, JSON.stringify(body)],
      );
      if (bankAccountId) {
        await client.query(
          `UPDATE account_bank_accounts
           SET current_balance = current_balance + $1, updated_at = NOW()
           WHERE id = $2`,
          [amount, bankAccountId],
        );
      }
      result = { id: deposit.rows[0].id };
      await logAccountAction(auth.user, "cash_deposit.create", "account_cash_deposit", result.id, body);
    } else if (action === "cash_close") {
      const storeId = Number(body.storeId || 0);
      const closingCash = toNumber(body.closingCash);
      if (!storeId || closingCash < 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Store and closing cash are required" }, { status: 400 });
      }
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query("ROLLBACK");
        return storeCheck.error;
      }
      const balance = await client.query(
        `SELECT current_cash FROM store_cash_balances WHERE store_id = $1 FOR UPDATE`,
        [storeId],
      );
      const currentCash = toNumber(balance.rows[0]?.current_cash);
      const diff = Number((closingCash - currentCash).toFixed(2));
      await client.query(
        `INSERT INTO store_cash_balances (store_id, current_cash, updated_at, meta)
         VALUES ($1, $2, NOW(), $3::jsonb)
         ON CONFLICT (store_id) DO UPDATE SET current_cash = EXCLUDED.current_cash, updated_at = NOW(), meta = store_cash_balances.meta || EXCLUDED.meta`,
        [storeId, closingCash, JSON.stringify({ lastAccountClosing: body })],
      );
      await client.query(
        `INSERT INTO store_cash_transactions (
          store_id, transaction_type, direction, amount, balance_after, transaction_date,
          reference_type, reference_id, remarks, created_by, meta
        ) VALUES ($1,'accounts_cash_close',$2,$3,$4,$5,'accounts_cash_close',$6,$7,$8,$9::jsonb)`,
        [
          storeId,
          diff >= 0 ? "in" : "out",
          Math.abs(diff),
          closingCash,
          toDate(body.closingDate) || new Date().toISOString().slice(0, 10),
          `close-${Date.now()}`,
          body.remarks || "Accounts cash closing",
          auth.user.id,
          JSON.stringify({ ...body, previousCash: currentCash, variance: diff }),
        ],
      );
      result = { storeId, closingCash };
      await logAccountAction(auth.user, "cash.close", "store_cash_balance", storeId, { closingCash, previousCash: currentCash, variance: diff });
    } else if (action === "payment_proposal") {
      const invoiceId = Number(body.invoiceId || 0);
      if (!invoiceId) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vendor invoice is required" }, { status: 400 });
      }
      const invoice = await client.query(
        `SELECT vi.*, si.status AS grn_status, COALESCE(po.destination_id, si.destination_id) AS store_id
         FROM vendor_invoices vi
         LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
         LEFT JOIN stock_in si ON si.id = vi.stock_in_id
         WHERE vi.id = $1
         FOR UPDATE OF vi`,
        [invoiceId],
      );
      const row = invoice.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vendor invoice not found" }, { status: 404 });
      }
      if (row.store_id) {
        const storeCheck = requireStore(auth.user, row.store_id);
        if (storeCheck.error) {
          await client.query("ROLLBACK");
          return storeCheck.error;
        }
      }
      if (!row.purchase_order_id) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vendor payment requires a linked Purchase Order" }, { status: 400 });
      }
      if (!row.stock_in_id || row.grn_status !== "confirmed") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vendor payment requires confirmed GRN / Stock In" }, { status: 400 });
      }
      const amountLeft = Math.max(toNumber(row.total_amount) - toNumber(row.amount_paid), 0);
      if (amountLeft <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invoice is already paid" }, { status: 400 });
      }
      const existingProposal = await client.query(
        `SELECT id, status
         FROM account_payment_proposals
         WHERE vendor_invoice_id = $1
           AND status IN ('proposed', 'verified', 'approved')
         ORDER BY id DESC
         LIMIT 1`,
        [invoiceId],
      );
      if (existingProposal.rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `Active proposal #${existingProposal.rows[0].id} already exists for this invoice` },
          { status: 400 },
        );
      }
      const proposal = await client.query(
        `INSERT INTO account_payment_proposals (
          vendor_invoice_id, vendor_id, purchase_order_id, amount, due_date, status, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,'proposed',$6,$7,$8::jsonb)
        RETURNING id`,
        [row.id, row.vendor_id, row.purchase_order_id, amountLeft, row.due_date, body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: proposal.rows[0].id };
      await logAccountAction(auth.user, "payment_proposal.create", "account_payment_proposal", result.id, { invoiceId, amount: amountLeft });
    } else if (action === "approve_proposal") {
      if (!canManageAccounts(auth.user)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Finance approval permission is required" }, { status: 403 });
      }
      const proposalId = Number(body.proposalId || 0);
      const reason = String(body.reason || "").trim();
      if (!reason) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Approval reason is required" }, { status: 400 });
      }
      const proposalStore = await client.query(
        `SELECT COALESCE(po.destination_id, si.destination_id) AS store_id
         FROM account_payment_proposals app
         JOIN vendor_invoices vi ON vi.id = app.vendor_invoice_id
         LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
         LEFT JOIN stock_in si ON si.id = vi.stock_in_id
         WHERE app.id = $1`,
        [proposalId],
      );
      if (proposalStore.rows[0]?.store_id) {
        const storeCheck = requireStore(auth.user, proposalStore.rows[0].store_id);
        if (storeCheck.error) {
          await client.query("ROLLBACK");
          return storeCheck.error;
        }
      }
      const approved = await client.query(
        `UPDATE account_payment_proposals
         SET status = 'approved', approval_reason = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND status IN ('proposed', 'verified')
         RETURNING id`,
        [reason, auth.user.id, proposalId],
      );
      if (!approved.rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Proposal not found or already processed" }, { status: 400 });
      }
      result = { id: proposalId };
      await logAccountAction(auth.user, "payment_proposal.approve", "account_payment_proposal", proposalId, { reason });
    } else if (action === "mark_vendor_paid") {
      const proposalId = Number(body.proposalId || 0);
      const utrNumber = String(body.utrNumber || "").trim();
      if (!utrNumber) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "UTR number is required" }, { status: 400 });
      }
      const proposalRes = await client.query(
        `SELECT ap.*, vi.total_amount, vi.amount_paid, vi.purchase_order_id, vi.stock_in_id,
                si.status AS grn_status, COALESCE(po.destination_id, si.destination_id) AS store_id
         FROM account_payment_proposals ap
         JOIN vendor_invoices vi ON vi.id = ap.vendor_invoice_id
         LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
         LEFT JOIN stock_in si ON si.id = vi.stock_in_id
         WHERE ap.id = $1
         FOR UPDATE`,
        [proposalId],
      );
      const proposal = proposalRes.rows[0];
      if (!proposal || proposal.status !== "approved") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Only approved proposals can be marked paid" }, { status: 400 });
      }
      if (proposal.store_id) {
        const storeCheck = requireStore(auth.user, proposal.store_id);
        if (storeCheck.error) {
          await client.query("ROLLBACK");
          return storeCheck.error;
        }
      }
      if (!proposal.purchase_order_id || !proposal.stock_in_id || proposal.grn_status !== "confirmed") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vendor payment requires linked PO and confirmed GRN / Stock In" }, { status: 400 });
      }
      const applied = Math.min(toNumber(proposal.amount), Math.max(toNumber(proposal.total_amount) - toNumber(proposal.amount_paid), 0));
      const nextPaid = toNumber(proposal.amount_paid) + applied;
      await client.query(
        `INSERT INTO vendor_invoice_settlements (
          vendor_invoice_id, amount, payment_mode, reference_no, settlement_date, settled_by, remarks
        ) VALUES ($1,$2,'Bank Portal',$3,$4,$5,$6)`,
        [proposal.vendor_invoice_id, applied, utrNumber, toDate(body.paidDate) || new Date().toISOString().slice(0, 10), auth.user.name || "Finance", body.remarks || null],
      );
      await client.query(
        `UPDATE vendor_invoices SET amount_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [nextPaid, invoiceStatus(toNumber(proposal.total_amount), nextPaid), proposal.vendor_invoice_id],
      );
      await client.query(
        `UPDATE account_payment_proposals
         SET status = 'paid', utr_number = $1, paid_date = $2, closed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [utrNumber, toDate(body.paidDate) || new Date().toISOString().slice(0, 10), proposalId],
      );
      await client.query(
        `INSERT INTO account_tally_sync_queue (
          source_type, source_id, voucher_number, amount, status, created_by, meta
        ) VALUES ('vendor_payment', $1, $2, $3, 'ready', $4, $5::jsonb)`,
        [String(proposalId), `PAY-${proposalId}`, applied, auth.user.id, JSON.stringify({ utrNumber, vendorInvoiceId: proposal.vendor_invoice_id })],
      );
      result = { id: proposalId, amount: applied };
      await logAccountAction(auth.user, "vendor_payment.utr_recorded", "account_payment_proposal", proposalId, { utrNumber, amount: applied });
    } else if (action === "cheque") {
      const dueDate = toDate(body.dueDate);
      const partyName = requiredText(body.partyName);
      const chequeNumber = requiredText(body.chequeNumber);
      const chequeAmount = toNumber(body.amount);
      if (!partyName || !chequeNumber || chequeAmount <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Party, cheque number and amount are required" }, { status: 400 });
      }
      const insert = await client.query(
        `INSERT INTO account_cheques (
          cheque_type, party_name, cheque_number, amount, due_date, status, bank_name, document_note, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        RETURNING id`,
        [body.chequeType || "PDC", partyName, chequeNumber, chequeAmount, dueDate, body.status || "safe_custody", body.bankName || null, body.documentNote || null, body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: insert.rows[0].id };
      if (dueDate) {
        await client.query(
          `INSERT INTO account_calendar_reminders (
            title, category, due_date, owner, remarks, created_by, meta
          ) VALUES ($1,'pdc_deposit',$2,$3,$4,$5,$6::jsonb)`,
          [
            `${body.chequeType || "PDC"} deposit - ${partyName}`,
            dueDate,
            "Finance",
            `Cheque ${chequeNumber}`,
            auth.user.id,
            JSON.stringify({ chequeId: result.id }),
          ],
        );
      }
      await logAccountAction(auth.user, "cheque.create", "account_cheque", result.id, body);
    } else if (action === "cheque_status") {
      const chequeId = Number(body.chequeId || 0);
      const requestedStatus = String(body.status || "").trim();
      const status = requestedStatus === "bounced" ? "legal_follow_up" : requestedStatus;
      if (!chequeId || !["deposit_due", "deposited", "cleared", "legal_follow_up"].includes(status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Valid cheque and status are required" }, { status: 400 });
      }
      const updated = await client.query(
        `UPDATE account_cheques
         SET status = $1,
             remarks = COALESCE($2, remarks),
             updated_at = NOW(),
             meta = meta || $3::jsonb
         WHERE id = $4
         RETURNING id`,
        [status, body.remarks || null, JSON.stringify({ lastStatusUpdate: { requestedStatus, status, remarks: body.remarks || "" } }), chequeId],
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
      }
      result = { id: chequeId };
      await logAccountAction(auth.user, "cheque.status", "account_cheque", chequeId, { requestedStatus, status, remarks: body.remarks || "" });
    } else if (action === "expense") {
      const storeId = Number(body.storeId || 0) || null;
      const expenseHead = requiredText(body.expenseHead);
      const expenseAmount = toNumber(body.amount);
      if (!storeId || !expenseHead || expenseAmount <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Store, spend head and amount are required" }, { status: 400 });
      }
      if (storeId) {
        const storeCheck = requireStore(auth.user, storeId);
        if (storeCheck.error) {
          await client.query("ROLLBACK");
          return storeCheck.error;
        }
      }
      const insert = await client.query(
        `INSERT INTO account_expenses (
          store_id, expense_head, amount, expense_date, status, bill_note, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,'submitted',$5,$6,$7,$8::jsonb)
        RETURNING id`,
        [storeId, expenseHead, expenseAmount, toDate(body.expenseDate) || new Date().toISOString().slice(0, 10), body.billNote || null, body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: insert.rows[0].id };
      await logAccountAction(auth.user, "expense.create", "account_expense", result.id, body);
    } else if (action === "expense_status") {
      const expenseId = Number(body.expenseId || 0);
      const status = String(body.status || "").trim();
      const remarks = String(body.remarks || "").trim();
      if (!["area_verified", "approved", "rejected"].includes(status)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invalid expense status" }, { status: 400 });
      }
      if (["area_verified", "approved"].includes(status) && !remarks) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Verification / approval reason is required" }, { status: 400 });
      }
      const updatedExpense = await client.query(
        `UPDATE account_expenses
         SET status = $1,
             verified_by = CASE WHEN $1 = 'area_verified' THEN $2 ELSE verified_by END,
             verified_at = CASE WHEN $1 = 'area_verified' THEN NOW() ELSE verified_at END,
             approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END,
             approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
             remarks = COALESCE($3, remarks),
             updated_at = NOW()
         WHERE id = $4
         RETURNING store_id`,
        [status, auth.user.id, remarks || null, expenseId],
      );
      if (!updatedExpense.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Expense record not found" }, { status: 404 });
      }
      if (updatedExpense.rows[0]?.store_id) {
        const storeCheck = requireStore(auth.user, updatedExpense.rows[0].store_id);
        if (storeCheck.error) {
          await client.query("ROLLBACK");
          return storeCheck.error;
        }
      }
      result = { id: expenseId };
      await logAccountAction(auth.user, "expense.status", "account_expense", expenseId, { status, remarks });
    } else if (action === "imprest") {
      const storeId = Number(body.storeId || 0);
      if (!storeId) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Store is required" }, { status: 400 });
      }
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query("ROLLBACK");
        return storeCheck.error;
      }
      const pendingRecords = await client.query(
        `SELECT COUNT(*) AS total
         FROM account_expenses
         WHERE store_id = $1
           AND status IN ('submitted', 'area_verified')`,
        [storeId],
      );
      if (toNumber(pendingRecords.rows[0]?.total) > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Clear and approve earlier imprest spend records before giving next imprest money" },
          { status: 400 },
        );
      }
      const upsert = await client.query(
        `INSERT INTO account_imprest (
          store_id, limit_amount, current_balance, low_balance_threshold, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT (store_id) DO UPDATE SET
          limit_amount = EXCLUDED.limit_amount,
          current_balance = EXCLUDED.current_balance,
          low_balance_threshold = EXCLUDED.low_balance_threshold,
          remarks = EXCLUDED.remarks,
          updated_at = NOW(),
          meta = account_imprest.meta || EXCLUDED.meta
        RETURNING id`,
        [storeId, toNumber(body.limitAmount), toNumber(body.currentBalance), toNumber(body.lowBalanceThreshold), body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: upsert.rows[0].id };
      await logAccountAction(auth.user, "imprest.upsert", "account_imprest", result.id, body);
    } else if (action === "calendar") {
      const title = requiredText(body.title);
      const dueDate = toDate(body.dueDate);
      if (!title || !dueDate) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Task and due date are required" }, { status: 400 });
      }
      const insert = await client.query(
        `INSERT INTO account_calendar_reminders (
          title, category, due_date, owner, remarks, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        RETURNING id`,
        [title, body.category || "finance", dueDate, body.owner || null, body.remarks || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: insert.rows[0].id };
      await logAccountAction(auth.user, "calendar.create", "account_calendar_reminder", result.id, body);
    } else if (action === "document") {
      const moduleName = requiredText(body.module);
      const linkedType = requiredText(body.linkedType);
      const linkedId = requiredText(body.linkedId);
      const documentName = requiredText(body.documentName);
      if (!moduleName || !linkedType || !linkedId || !documentName) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Document module, linked type, linked ID and name are required" }, { status: 400 });
      }
      const insert = await client.query(
        `INSERT INTO account_documents (
          module, linked_type, linked_id, document_name, document_note, status, created_by, meta
        ) VALUES ($1,$2,$3,$4,$5,'linked',$6,$7::jsonb)
        RETURNING id`,
        [moduleName, linkedType, linkedId, documentName, body.documentNote || null, auth.user.id, JSON.stringify(body)],
      );
      result = { id: insert.rows[0].id };
      await logAccountAction(auth.user, "document.link", "account_document", result.id, body);
    } else if (action === "tally_push") {
      const itemId = Number(body.itemId || 0);
      const pushed = await client.query(
        `UPDATE account_tally_sync_queue
         SET status = 'pushed', pushed_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [itemId],
      );
      if (!pushed.rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Tally queue item not found" }, { status: 404 });
      }
      result = { id: itemId };
      await logAccountAction(auth.user, "tally.push", "account_tally_sync_queue", itemId, {});
    } else {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Unsupported accounts action" }, { status: 400 });
    }

    await client.query("COMMIT");
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("[accounts POST]", err.message);
    return NextResponse.json({ error: err.message || "Accounts action failed" }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
