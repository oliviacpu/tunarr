import { bootstrapTunarr } from '../../bootstrap.ts';
import { DBAccess, MigrationLockTableName } from '../../db/DBAccess.ts';
import { schema } from '../../db/schema/index.ts';
import { setGlobalOptionsUnchecked } from '../../globals.ts';
import { BackfillMediaSourceIdFixer } from '../../tasks/fixers/BackfillMediaSourceIdFixer.ts';
import { EnsureTranscodeConfigIds } from '../../tasks/fixers/EnsureTranscodeConfigIds.ts';
import path from 'node:path';
import tmp from 'tmp-promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultTranscodeConfigLegacy } from './legacyTranscodeConfigDefaults.ts';

const PreviousMigration = 'migration1792425288';
const Migration = 'migration1792507432';
type Connection = ReturnType<DBAccess['getOrCreateConnection']>;

let connection: Connection;
let dbPath: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  const directory = await tmp.dir({ unsafeCleanup: true });
  dbPath = path.join(directory.path, 'db.db');
  cleanup = directory.cleanup;
  connection = DBAccess.instance.getOrCreateConnection(dbPath);
  await connection.syncMigrationTablesIfNecessary();
  const result = await connection
    .getDrizzleMigrator()
    .migrateTo(PreviousMigration);
  expect(result.error).toBeUndefined();
});

afterEach(async () => {
  await DBAccess.instance.closeConnection(dbPath);
  await cleanup();
});

function source(uuid: string, name: string, type = 'plex') {
  connection.sqlite
    .prepare(
      'INSERT INTO media_source (uuid, name, type, uri, access_token, "index") VALUES (?, ?, ?, ?, ?, 0)',
    )
    .run(uuid, name, type, 'http://media.invalid', 'fixture-token');
}

function owners() {
  connection.sqlite.exec(`
    INSERT INTO program_grouping (uuid, title, type) VALUES ('group', 'A Show', 'show');
    INSERT INTO program (uuid, title, type, duration, source_type, external_key, external_source_id, tv_show_uuid)
    VALUES ('program', 'An Episode', 'episode', 60000, 'plex', 'episode-key', 'Legacy Plex', 'group');
    INSERT INTO channel (uuid, name, number, duration, start_time, guide_minimum_duration, icon, offline, transcode_config_id)
    VALUES ('channel', 'Clip fallback', 1, 60000, 0, 0, '{}', '{"mode":"clip"}', 'config');
    INSERT INTO channel_fallback (channel_uuid, program_uuid) VALUES ('channel', 'program');
  `);
}

function externalId(
  table: 'program_external_id' | 'program_grouping_external_id',
  uuid: string,
  sourceType: string,
  legacySource: string | null,
  mediaSource: string | null = null,
) {
  const ownerColumn =
    table === 'program_external_id' ? 'program_uuid' : 'group_uuid';
  const owner = table === 'program_external_id' ? 'program' : 'group';
  connection.sqlite
    .prepare(
      `INSERT INTO ${table} (uuid, source_type, external_key, external_source_id, media_source_id, ${ownerColumn}) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(uuid, sourceType, `${uuid}-key`, legacySource, mediaSource, owner);
}

function columns(table: string) {
  return (
    connection.sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[]
  ).map((column) => column.name);
}

describe('retire legacy external source IDs', () => {
  it('backfills source names/UUIDs, retains independent IDs and existing IDs, and leaves clip fallback intact', async () => {
    source('plex-source', 'Legacy Plex');
    source('jellyfin-source', 'Jellyfin', 'jellyfin');
    source('emby-source', 'Emby', 'emby');
    owners();
    externalId('program_external_id', 'plex-id', 'plex', 'Legacy Plex');
    externalId(
      'program_external_id',
      'jellyfin-id',
      'jellyfin',
      'jellyfin-source',
    );
    externalId(
      'program_external_id',
      'existing-id',
      'emby',
      'no-longer-named-that',
      'emby-source',
    );
    externalId('program_external_id', 'tmdb-id', 'tmdb', null);
    externalId(
      'program_grouping_external_id',
      'group-plex-id',
      'plex',
      'Legacy Plex',
    );
    externalId('program_grouping_external_id', 'group-tvdb-id', 'tvdb', null);

    const result = await connection.getDrizzleMigrator().migrateTo(Migration);
    expect(result.error).toBeUndefined();
    expect(columns('program_external_id')).not.toContain('external_source_id');
    expect(columns('program_grouping_external_id')).not.toContain(
      'external_source_id',
    );
    expect(
      connection.sqlite
        .prepare(
          'SELECT uuid, media_source_id FROM program_external_id ORDER BY uuid',
        )
        .all(),
    ).toEqual([
      { uuid: 'existing-id', media_source_id: 'emby-source' },
      { uuid: 'jellyfin-id', media_source_id: 'jellyfin-source' },
      { uuid: 'plex-id', media_source_id: 'plex-source' },
      { uuid: 'tmdb-id', media_source_id: null },
    ]);
    expect(
      connection.sqlite
        .prepare(
          'SELECT uuid, media_source_id FROM program_grouping_external_id ORDER BY uuid',
        )
        .all(),
    ).toEqual([
      { uuid: 'group-plex-id', media_source_id: 'plex-source' },
      { uuid: 'group-tvdb-id', media_source_id: null },
    ]);
    expect(
      connection.sqlite.prepare('SELECT * FROM channel_fallback').all(),
    ).toEqual([{ channel_uuid: 'channel', program_uuid: 'program' }]);
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);

    // The remaining fixer depends only on retained program columns and relationships.
    await new BackfillMediaSourceIdFixer(connection.kysely).run();
    expect(
      connection.sqlite.prepare('SELECT media_source_id FROM program').get(),
    ).toEqual({ media_source_id: 'plex-source' });
    expect(
      connection.sqlite
        .prepare('SELECT media_source_id, source_type FROM program_grouping')
        .get(),
    ).toEqual({ media_source_id: 'plex-source', source_type: 'plex' });
  });

  for (const table of [
    'program_external_id',
    'program_grouping_external_id',
  ] as const) {
    for (const failure of ['unresolved', 'ambiguous'] as const) {
      it(`preserves ${table} and rolls back an ${failure} source-dependent upgrade`, async () => {
        source('plex-source', 'Legacy Plex');
        if (failure === 'ambiguous') source('other-source', 'Legacy Plex');
        owners();
        externalId(
          table,
          'legacy-id',
          'plex',
          failure === 'ambiguous' ? 'Legacy Plex' : 'Missing Plex',
        );
        externalId(table, 'independent-id', 'tmdb', null);
        const before = connection.sqlite
          .prepare(`SELECT * FROM ${table} ORDER BY uuid`)
          .all();
        const result = await connection
          .getDrizzleMigrator()
          .migrateTo(Migration);
        expect(result.error).toBeInstanceOf(Error);
        expect(String(result.error)).toContain(table);
        expect(String(result.error)).toContain(`1 ${failure}`);
        expect(columns(table)).toContain('external_source_id');
        expect(
          connection.sqlite
            .prepare(`SELECT * FROM ${table} ORDER BY uuid`)
            .all(),
        ).toEqual(before);
        expect(
          connection.sqlite
            .prepare('SELECT name FROM migrations WHERE name = ?')
            .get(Migration),
        ).toBeUndefined();
        expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(
          1,
        );
      });
    }
  }

  it('rolls back earlier backfills if resolving an ID would violate uniqueness', async () => {
    source('plex-source', 'Legacy Plex');
    owners();
    externalId('program_external_id', 'program-id', 'plex', 'Legacy Plex');
    externalId(
      'program_grouping_external_id',
      'existing-id',
      'plex',
      'Old Name',
      'plex-source',
    );
    externalId(
      'program_grouping_external_id',
      'legacy-id',
      'plex',
      'Legacy Plex',
    );
    const result = await connection.getDrizzleMigrator().migrateTo(Migration);
    expect(result.error).toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('UNIQUE constraint failed'),
      }),
    });
    expect(
      connection.sqlite
        .prepare('SELECT media_source_id FROM program_external_id')
        .get(),
    ).toEqual({ media_source_id: null });
    for (const table of ['program_external_id', 'program_grouping_external_id'])
      expect(columns(table)).toContain('external_source_id');
    expect(
      connection.sqlite
        .prepare('SELECT name FROM migrations WHERE name = ?')
        .get(Migration),
    ).toBeUndefined();
  });

  it('stops bootstrap after an unresolved migration and preserves legacy identifiers', async () => {
    source('plex-source', 'Legacy Plex');
    owners();
    externalId('program_external_id', 'unresolved-id', 'plex', 'Missing Plex');
    const before = connection.sqlite
      .prepare('SELECT * FROM program_external_id')
      .all();
    const opts = setGlobalOptionsUnchecked({
      database: path.dirname(dbPath),
      verbose: 0,
      log_level: 'error',
    });
    await expect(bootstrapTunarr(opts, dbPath)).rejects.toThrow(
      new RegExp(Migration),
    );
    connection = DBAccess.instance.getOrCreateConnection(dbPath);
    expect(columns('program_external_id')).toContain('external_source_id');
    expect(
      connection.sqlite.prepare('SELECT * FROM program_external_id').all(),
    ).toEqual(before);
    expect(
      connection.sqlite
        .prepare('SELECT name FROM migrations WHERE name = ?')
        .get(Migration),
    ).toBeUndefined();
  });

  it('registers the three existing tables in the Drizzle query schema', () => {
    expect(schema.cachedImage).toBeDefined();
    expect(schema.channelSubtitlePreferences).toBeDefined();
    expect(schema.customShowSubtitlePreferences).toBeDefined();
  });

  it('preserves the exact frozen default config values when the runtime fixer creates one', async () => {
    connection.sqlite.exec('DELETE FROM transcode_config');
    await new EnsureTranscodeConfigIds(
      connection.kysely,
      connection.drizzle,
    ).run();
    const actual = await connection.kysely
      .selectFrom('transcodeConfig')
      .selectAll()
      .executeTakeFirstOrThrow();
    const frozen = defaultTranscodeConfigLegacy(true);
    const { uuid: _uuid, resolution, ...values } = frozen;
    expect(actual).toMatchObject(values);
    expect(actual.uuid).toEqual(expect.any(String));
    expect(
      connection.sqlite
        .prepare('SELECT resolution FROM transcode_config WHERE uuid = ?')
        .get(actual.uuid),
    ).toEqual({ resolution });
  });
});

it('upgrades a MikroORM-only history through the actual bootstrap path and preserves that history', async () => {
  const legacyDirectory = await tmp.dir({ unsafeCleanup: true });
  const legacyPath = path.join(legacyDirectory.path, 'db.db');
  try {
    const legacy = DBAccess.instance.getOrCreateConnection(legacyPath);
    await legacy.syncMigrationTablesIfNecessary();
    const result = await legacy
      .getDrizzleMigrator()
      .migrateTo('_Legacy_Migration16');
    expect(result.error).toBeUndefined();
    legacy.sqlite
      .exec(`DROP TABLE migrations; DROP TABLE "${MigrationLockTableName}";
      CREATE TABLE mikro_orm_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, executed_at INTEGER NOT NULL);
      INSERT INTO mikro_orm_migrations VALUES (1, 'cascade_channel_filler_show_deletes', 1);`);
    const opts = setGlobalOptionsUnchecked({
      database: legacyDirectory.path,
      verbose: 0,
      log_level: 'error',
    });
    await bootstrapTunarr(opts, legacyPath);
    const upgraded = DBAccess.instance.getOrCreateConnection(legacyPath).sqlite;
    expect(
      upgraded
        .prepare('SELECT name FROM migrations WHERE name = ?')
        .get(Migration),
    ).toBeDefined();
    expect(
      upgraded.prepare('SELECT * FROM mikro_orm_migrations').all(),
    ).toEqual([
      { id: 1, name: 'cascade_channel_filler_show_deletes', executed_at: 1 },
    ]);
    expect(upgraded.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await DBAccess.instance.closeConnection(legacyPath);
    await legacyDirectory.cleanup();
  }
});
