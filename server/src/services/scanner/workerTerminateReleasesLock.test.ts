import Sqlite from 'better-sqlite3';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import tmp from 'tmp-promise';
import { describe, expect, test } from 'vitest';

// A scan worker that doesn't stop is terminated (on cancel or at shutdown).
// Terminating a thread in the middle of a write transaction must roll it back
// and free the database's write lock, or the main thread could never write
// again. better-sqlite3 closes a thread's connections when the thread is torn
// down.
describe('terminating a worker mid-transaction', () => {
  test('rolls the transaction back and frees the write lock', async () => {
    const dir = await tmp.dir({ unsafeCleanup: true });
    const file = path.join(dir.path, 'test.db');
    // Never waits for a lock, so a held lock shows up at once as SQLITE_BUSY
    const db = new Sqlite(file, { timeout: 0 });
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (x INTEGER)');

    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const Sqlite = require(workerData.module);
      const db = new Sqlite(workerData.file);
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT INTO t (x) VALUES (1)').run();
      parentPort.postMessage('holding the write lock');
      setInterval(() => {}, 1000);
      `,
      {
        eval: true,
        workerData: { file, module: require.resolve('better-sqlite3') },
      },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        worker.once('message', () => resolve());
        worker.once('error', reject);
        worker.once('exit', (code) =>
          reject(new Error(`worker exited early with code ${code}`)),
        );
      });
      // While the worker holds it, nobody else can take the write lock
      expect(() => db.exec('BEGIN IMMEDIATE')).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY' }),
      );

      await worker.terminate();

      // Released: the lock is free and the uncommitted row is gone
      db.exec('BEGIN IMMEDIATE');
      db.exec('ROLLBACK');
      expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({
        n: 0,
      });
    } finally {
      db.close();
      await dir.cleanup();
    }
  });
});
