export const TRIAL_PERMISSION_GROUPS = [
  { id: 'dashboard', label: 'Dashboard', permissions: ['ACCESS_DASHBOARD'] },
  { id: 'pos', label: 'POS & billing', permissions: ['CREATE_POS_BILL', 'OPEN_CLOSE_SESSION', 'VIEW_BILLING'] },
  { id: 'catalog', label: 'Catalog', permissions: ['VIEW_CATALOG', 'MANAGE_CATALOG', 'VIEW_TAXES', 'VIEW_PROMOS'] },
  { id: 'inventory', label: 'Inventory', permissions: ['VIEW_INVENTORY', 'MANAGE_INVENTORY', 'VIEW_EXPIRY_ALERTS'] },
  { id: 'purchases', label: 'Purchases & vendors', permissions: ['VIEW_PURCHASE_ORDERS', 'MANAGE_PURCHASE_ORDERS', 'VIEW_VENDORS', 'MANAGE_VENDORS'] },
  { id: 'customers', label: 'Customers', permissions: ['VIEW_CUSTOMERS', 'MANAGE_CUSTOMERS'] },
  { id: 'orders', label: 'Sales orders', permissions: ['VIEW_ORDERS', 'MANAGE_ORDERS'] },
  { id: 'reports', label: 'Reports', permissions: ['VIEW_STORE_REPORTS', 'VIEW_STORE_SALES', 'VIEW_STORE_PRODUCT_INVENTORY'] },
  { id: 'stores', label: 'Store settings', permissions: ['VIEW_STORES'] },
  { id: 'employees', label: 'View employees', permissions: ['VIEW_USERS'] },
];

export const TRIAL_PERMISSION_KEYS = new Set(
  TRIAL_PERMISSION_GROUPS.flatMap((group) => group.permissions),
);

export const DEFAULT_TRIAL_PERMISSIONS = [
  'ACCESS_DASHBOARD',
  'CREATE_POS_BILL',
  'OPEN_CLOSE_SESSION',
  'VIEW_BILLING',
  'VIEW_CATALOG',
  'MANAGE_CATALOG',
  'VIEW_INVENTORY',
  'MANAGE_INVENTORY',
  'VIEW_CUSTOMERS',
  'MANAGE_CUSTOMERS',
  'VIEW_PURCHASE_ORDERS',
  'VIEW_VENDORS',
  'VIEW_STORE_REPORTS',
];

export function sanitizeTrialPermissions(value) {
  if (!Array.isArray(value)) return [...DEFAULT_TRIAL_PERMISSIONS];
  return [...new Set(value.map(String).filter((key) => TRIAL_PERMISSION_KEYS.has(key)))];
}
