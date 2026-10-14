import type { DrizzleDBAccess } from './schema/index.ts';

/**
 * Makes `db.transaction(...)` start with BEGIN IMMEDIATE unless the caller
 * passes its own `behavior`.
 *
 * Tunarr opens more than one connection to its database (worker threads have
 * their own), and library scans write from a worker. In WAL mode, a DEFERRED
 * transaction that reads and then writes fails at once with
 * SQLITE_BUSY_SNAPSHOT if another connection committed after its read began;
 * the busy timeout doesn't help there. An IMMEDIATE transaction takes the
 * write lock up front, waiting up to the busy timeout, so it can't fail that
 * way. Nested transactions are savepoints and unaffected.
 */
export function withImmediateTransactions<DB extends DrizzleDBAccess>(
  db: DB,
): DB {
  const transaction = db.transaction.bind(db);
  const immediateByDefault: DrizzleDBAccess['transaction'] = (fn, config) =>
    transaction(fn, { behavior: 'immediate', ...config });
  db.transaction = immediateByDefault;
  return db;
}
