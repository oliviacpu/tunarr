import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp-promise';
import { test as baseTest, describe, expect } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import { DatabaseSchemaTooNewError } from '../migration/DatabaseSchemaTooNewError.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { DBAccess, connectionPragmas } from './DBAccess.ts';

type Fixture = {
  dbDir: string;
};

const test = baseTest.extend<Fixture>({
  dbDir: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    const opts = setGlobalOptionsUnchecked({
      database: dbResult.path,
      log_level: 'error',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    await use(dbResult.path);
    await DBAccess.instance.closeConnection(path.join(dbResult.path, 'db.db'));
    await dbResult.cleanup();
  },
});

function recordMigration(dbPath: string, name: string) {
  const conn = DBAccess.instance.getOrCreateConnection(dbPath);
  conn.sqlite
    .prepare('INSERT INTO migrations (name, timestamp) VALUES (?, ?)')
    .run(name, new Date().toISOString());
}

async function preMigrationSnapshots(dbDir: string) {
  const entries = await fs.readdir(dbDir);
  return entries.filter((entry) => entry.includes('-pre-migration-'));
}

describe('migrateExistingDatabase - downgrade guard', () => {
  test('refuses a database carrying migrations this build does not know', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');
    recordMigration(dbPath, '9999_from_the_future');

    await expect(
      DBAccess.instance.migrateExistingDatabase(dbPath),
    ).rejects.toThrow(DatabaseSchemaTooNewError);
  });

  test('names the offending migration so the message is actionable', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');
    recordMigration(dbPath, '9999_from_the_future');

    await expect(
      DBAccess.instance.migrateExistingDatabase(dbPath),
    ).rejects.toThrow(/9999_from_the_future/);
  });

  test('stays out of the way of an up to date database', async ({ dbDir }) => {
    const dbPath = path.join(dbDir, 'db.db');

    await expect(
      DBAccess.instance.migrateExistingDatabase(dbPath),
    ).resolves.toBeUndefined();
  });

  test('takes no snapshot when there is nothing to migrate', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');

    await DBAccess.instance.migrateExistingDatabase(dbPath);

    expect(await preMigrationSnapshots(dbDir)).toHaveLength(0);
  });
});

// The fork's audio tracks and captions migrations were released as 0053 and
// 0054 under these keys, before upstream added its own 0053 (an index on
// program_grouping). The upstream merge renumbered the files but kept the keys.
const ReleasedForkMigrations = ['migration1792160617', 'migration1792181517'];
const Upstream0053 = 'migration1791321608';
const Upstream0053Index =
  'program_grouping_media_source_library_external_key_index';

describe('migrateExistingDatabase - fork migrations renumbered', () => {
  test('a database from before upstream 0053 runs only 0053', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');
    const conn = DBAccess.instance.getOrCreateConnection(dbPath);

    // What such a database holds: the fork's columns and their migrations
    // under the released keys, but neither upstream's migration nor its index
    conn.sqlite
      .prepare('DELETE FROM migrations WHERE name IN (?, ?, ?)')
      .run(Upstream0053, ...ReleasedForkMigrations);
    conn.sqlite.exec(`DROP INDEX ${Upstream0053Index}`);
    for (const name of ReleasedForkMigrations) {
      recordMigration(dbPath, name);
    }

    await expect(
      DBAccess.instance.migrateExistingDatabase(dbPath),
    ).resolves.toBeUndefined();

    const sqlite = DBAccess.instance.getOrCreateConnection(dbPath).sqlite;
    const names = (
      sqlite.prepare('SELECT name FROM migrations').all() as { name: string }[]
    ).map(({ name }) => name);
    for (const name of [Upstream0053, ...ReleasedForkMigrations]) {
      expect(names.filter((n) => n === name)).toHaveLength(1);
    }
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(Upstream0053Index),
    ).toBeDefined();
    const columns = (
      sqlite.prepare('PRAGMA table_info(channel)').all() as { name: string }[]
    ).map(({ name }) => name);
    expect(columns).toEqual(
      expect.arrayContaining(['audio_tracks', 'captions']),
    );
  });
});

describe('database backup rotation', () => {
  test('keeps the newest three of each backup pool', async ({ dbDir }) => {
    const plant = async (name: string) =>
      fs.writeFile(path.join(dbDir, name), 'not a real database');

    // Interleaved so an implementation that rotated one combined pool would
    // drop pre-migration snapshots that this one must keep.
    for (const stamp of [1, 2, 3, 4, 5]) {
      await plant(`db-176000000000${stamp}.bak`);
      await plant(`db-pre-migration-176000000000${stamp}.bak`);
    }

    const opts = setGlobalOptionsUnchecked({
      database: dbDir,
      log_level: 'error',
      verbose: 0,
    });
    await bootstrapTunarr(opts);

    const remaining = await fs.readdir(dbDir);
    expect(remaining.filter((e) => e.match(/^db-\d+\.bak$/))).toHaveLength(3);
    expect(await preMigrationSnapshots(dbDir)).toHaveLength(3);
    // The newest of each pool survives.
    expect(remaining).toContain('db-1760000000005.bak');
    expect(remaining).toContain('db-pre-migration-1760000000005.bak');
  });
});

describe('migrateExistingDatabase - pre-migration snapshot', () => {
  test('snapshots the database before applying a pending migration', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');
    const conn = DBAccess.instance.getOrCreateConnection(dbPath);

    // Make the most recent migration look unapplied so there is real work to do.
    const newest = conn.sqlite
      .prepare(
        'SELECT name FROM migrations ORDER BY timestamp DESC, name DESC LIMIT 1',
      )
      .get() as { name: string };
    conn.sqlite
      .prepare('DELETE FROM migrations WHERE name = ?')
      .run(newest.name);

    try {
      await DBAccess.instance.migrateExistingDatabase(dbPath);
    } catch {
      // Re-running an already-applied migration may fail. The snapshot is taken
      // before any of that, which is the point being asserted.
    }

    expect(await preMigrationSnapshots(dbDir)).toHaveLength(1);
  });
});

describe('init - connection reuse', () => {
  test('a second init for the same database reuses the live connection', async ({
    dbDir,
  }) => {
    const dbPath = path.join(dbDir, 'db.db');
    const live = DBAccess.instance.getConnection(dbPath);
    expect(live).toBeDefined();

    const reinitialized = DBAccess.init(dbPath);

    // init() used to build a second Connection for the same file and replace
    // the map entry, abandoning the previous sqlite handle without closing it.
    expect(reinitialized).toBe(live);
    expect(DBAccess.instance.getConnection(dbPath)).toBe(live);
  });
});

describe('connection settings', () => {
  // The main thread keeps the database in its own memory: pages mapped from
  // the file live in the shared OS file cache, which other processes evict,
  // and reading them back then stalls the thread that serves the streams.
  test('the main thread caches pages itself and maps nothing', async ({
    dbDir,
  }) => {
    const conn = DBAccess.instance.getOrCreateConnection(
      path.join(dbDir, 'db.db'),
    );

    expect(conn.sqlite.pragma('mmap_size', { simple: true })).toBe(0);
    expect(conn.sqlite.pragma('cache_size', { simple: true })).toBe(-262144);
    expect(conn.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(conn.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('workers keep the mapped file and the smaller cache', () => {
    expect(connectionPragmas(false)).toEqual(
      expect.arrayContaining(['mmap_size = 268435456', 'cache_size = 10000']),
    );
    expect(connectionPragmas(true)).not.toContain('mmap_size = 268435456');
  });
});
