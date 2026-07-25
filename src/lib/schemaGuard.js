/**
 * schemaGuard.js
 *
 * Prevents concurrent schema-init calls from causing PostgreSQL deadlocks.
 *
 * Problem: Multiple simultaneous API requests each call `ensureFooSchema()`.
 * All pass the `if (ensured) return;` check before any query resolves,
 * so they all fire the same DDL concurrently → AccessExclusiveLock deadlock.
 *
 * Solution: Store a per-key Promise on globalThis.
 *   - Already done?     → return immediately (flag)
 *   - Already running?  → return the same in-flight Promise (mutex)
 *   - New call?         → start the Promise, store it, run the fn
 *
 * Usage:
 *   import { makeSchemaEnsurer } from '@/lib/schemaGuard';
 *   import { query } from '@/lib/db';
 *
 *   export const ensureFooSchema = makeSchemaEnsurer('foo', () => query(`...`));
 */

const g = globalThis;

/**
 * @param {string}           key   Unique key for this schema (e.g. 'customers')
 * @param {() => Promise<any>} fn  Async function that runs the DDL
 * @returns {() => Promise<void>}  Thread-safe schema ensurer
 */
export function makeSchemaEnsurer(key, fn) {
  const doneKey  = `_schemaEnsured_${key}`;
  const promKey  = `_schemaPromise_${key}`;

  return async function ensureSchema() {
    // Already completed in this process (survives hot-reload via globalThis)
    if (g[doneKey]) return;

    // Already in-flight — share the same promise (prevents concurrent DDL)
    if (g[promKey]) return g[promKey];

    // First caller — start the work
    g[promKey] = fn()
      .then(() => {
        g[doneKey] = true;
      })
      .finally(() => {
        // Clear the promise slot so errors allow a clean retry
        g[promKey] = null;
      });

    return g[promKey];
  };
}
