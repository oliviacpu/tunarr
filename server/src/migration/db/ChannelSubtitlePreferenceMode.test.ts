import { DBAccess } from '../../db/DBAccess.ts';
import path from 'node:path';
import tmp from 'tmp-promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PreviousMigration = 'migration1792507432';
const Migration = 'migration1792592470';
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

describe('channel subtitle preference mode migration', () => {
  it('backfills any saved rows as custom, including all-none, and preserves the exact rows', async () => {
    expect(
      connection.sqlite.prepare('PRAGMA table_info(channel)').all(),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'subtitle_preference_mode' }),
      ]),
    );
    const insertChannel = connection.sqlite.prepare(
      `INSERT INTO channel (uuid, name, number, duration, start_time, guide_minimum_duration, icon, offline, transcode_config_id)
       VALUES (?, ?, ?, 60000, 12345, 0, '{}', '{"mode":"pic"}', 'config')`,
    );
    insertChannel.run('empty', 'No saved preferences', 1);
    insertChannel.run('active', 'Saved preferences', 2);
    insertChannel.run('all-none', 'Only disabled preferences', 3);
    connection.sqlite.exec(`
      INSERT INTO channel_subtitle_preferences
        (uuid, channel_id, language_code, priority, allow_external, allow_image_based, filter_type)
      VALUES
        ('active-first', 'active', 'eng', 7, 1, 0, 'forced'),
        ('active-second', 'active', 'spa', 12, 0, 1, 'any'),
        ('none-first', 'all-none', 'eng', 5, 0, 0, 'none');
    `);
    const before = connection.sqlite
      .prepare('SELECT * FROM channel_subtitle_preferences ORDER BY uuid')
      .all();

    const result = await connection.getDrizzleMigrator().migrateTo(Migration);
    expect(result.error).toBeUndefined();
    expect(
      connection.sqlite
        .prepare(
          'SELECT uuid, subtitle_preference_mode FROM channel ORDER BY number',
        )
        .all(),
    ).toEqual([
      { uuid: 'empty', subtitle_preference_mode: 'inherit' },
      { uuid: 'active', subtitle_preference_mode: 'custom' },
      { uuid: 'all-none', subtitle_preference_mode: 'custom' },
    ]);
    expect(
      connection.sqlite
        .prepare('SELECT * FROM channel_subtitle_preferences ORDER BY uuid')
        .all(),
    ).toEqual(before);
    expect(
      connection.sqlite.prepare('PRAGMA table_info(channel)').all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'subtitle_preference_mode',
          notnull: 1,
          dflt_value: "'inherit'",
        }),
      ]),
    );
    insertChannel.run('new', 'Created after migration', 4);
    expect(
      connection.sqlite
        .prepare(
          "SELECT subtitle_preference_mode FROM channel WHERE uuid = 'new'",
        )
        .get(),
    ).toEqual({ subtitle_preference_mode: 'inherit' });
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
