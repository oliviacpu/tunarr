import Sqlite from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import tmp from 'tmp-promise';
import { test as baseTest, describe, expect } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { DBAccess } from './DBAccess.ts';
import { ProgramStateRepository } from './program/ProgramStateRepository.ts';

// Tunarr's own connection (as the main thread opens it) and a second raw
// connection to the same file, standing in for a scan worker's. The second one
// never waits for locks, so a held lock shows up as an immediate SQLITE_BUSY.
type Fixture = {
  conn: ReturnType<DBAccess['getOrCreateConnection']>;
  other: Sqlite.Database;
};

const test = baseTest.extend<Fixture>({
  conn: async ({}, use) => {
    const dir = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dir.path);
    const opts = setGlobalOptionsUnchecked({
      database: dir.path,
      log_level: 'error',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    const dbPath = path.join(dir.path, 'db.db');
    const conn = DBAccess.instance.getOrCreateConnection(dbPath);
    conn.sqlite.exec('CREATE TABLE IF NOT EXISTS contention (x INTEGER)');
    await use(conn);
    await DBAccess.instance.closeConnection(dbPath);
    await dir.cleanup();
  },
  other: async ({ conn }, use) => {
    const other = new Sqlite(conn.name, { timeout: 0 });
    await use(other);
    other.close();
  },
});

const insert = (db: Sqlite.Database) =>
  db.prepare('INSERT INTO contention (x) VALUES (1)').run();

describe('write transactions with a second connection', () => {
  test('a deferred read-then-write fails once another connection commits', ({
    other,
    conn,
  }) => {
    // The failure the IMMEDIATE default prevents, shown with raw connections
    const deferred = new Sqlite(conn.name, { timeout: 5_000 });
    try {
      deferred.exec('BEGIN');
      deferred.prepare('SELECT count(*) FROM contention').get();
      insert(other);
      expect(() => insert(deferred)).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY_SNAPSHOT' }),
      );
      deferred.exec('ROLLBACK');
    } finally {
      deferred.close();
    }
  });

  test("Tunarr's transactions take the write lock before their first write", ({
    conn,
    other,
  }) => {
    conn.drizzle.transaction((tx) => {
      tx.all(sql`SELECT count(*) FROM contention`);
      // Nobody else can commit between this transaction's read and its write
      expect(() => insert(other)).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY' }),
      );
      tx.run(sql`INSERT INTO contention (x) VALUES (2)`);
    });
    // Released at commit
    expect(() => insert(other)).not.toThrow();
  });

  test('a transaction that asks for another behavior keeps it', ({
    conn,
    other,
  }) => {
    conn.drizzle.transaction(
      () => {
        // Deferred: no lock until the first write
        expect(() => insert(other)).not.toThrow();
      },
      { behavior: 'deferred' },
    );
  });

  test('the TRUNCATE checkpoint does not wait out the busy timeout', async ({
    conn,
    other,
  }) => {
    // A reader holding a snapshot keeps TRUNCATE from finishing
    insert(other);
    other.exec('BEGIN');
    other.prepare('SELECT count(*) FROM contention').get();
    try {
      const repo = new ProgramStateRepository(conn.drizzle);
      const start = performance.now();
      await repo.checkpointAndOptimize();
      expect(performance.now() - start).toBeLessThan(1_000);
      // The connection's own busy timeout is back afterwards
      expect(conn.sqlite.pragma('busy_timeout', { simple: true })).toBe(5_000);
    } finally {
      other.exec('ROLLBACK');
    }
  });
});
