import { AsyncLocalStorage } from 'node:async_hooks';

const globalForTenantContext = globalThis;

if (!globalForTenantContext._zFlowTenantStorage) {
  globalForTenantContext._zFlowTenantStorage = new AsyncLocalStorage();
}

const tenantStorage = globalForTenantContext._zFlowTenantStorage;

export function getTenantContext() {
  return tenantStorage.getStore() || null;
}

export function enterTenantContext(context) {
  if (!context?.tenantId || !context?.databaseName) {
    throw new Error('A valid tenant context is required');
  }

  tenantStorage.enterWith({
    tenantId: Number(context.tenantId),
    databaseName: String(context.databaseName),
    trialEndsAt: context.trialEndsAt || null,
  });
}

export function clearTenantContext() {
  tenantStorage.enterWith(null);
}

