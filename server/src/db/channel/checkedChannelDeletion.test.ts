import type Sqlite from 'better-sqlite3';
import { tag } from '@tunarr/types';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp-promise';
import { mock } from 'ts-mockito';
import { v4 } from 'uuid';
import { describe, expect, test as baseTest, vi } from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
import { MaterializeLineupCommand } from '../../commands/MaterializeLineupCommand.ts';
import { MaterializeProgramsCommand } from '../../commands/MaterializeProgramsCommand.ts';
import { globalOptions, setGlobalOptionsUnchecked } from '../../globals.ts';
import type { IWorkerPool } from '../../interfaces/IWorkerPool.ts';
import { CacheImageService } from '../../services/cacheImageService.ts';
import { FileSystemService } from '../../services/FileSystemService.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import { ChannelDB } from '../ChannelDB.ts';
import { ProgramConverter } from '../converters/ProgramConverter.ts';
import { DBAccess } from '../DBAccess.ts';
import { Channel } from '../schema/Channel.ts';
import { ChannelFillerShow } from '../schema/ChannelFillerShow.ts';
import { ChannelPrograms } from '../schema/ChannelPrograms.ts';
import { FillerShow } from '../schema/FillerShow.ts';
import type { DrizzleDBAccess } from '../schema/index.ts';
import { Program } from '../schema/Program.ts';
import { ChannelSubtitlePreferences } from '../schema/SubtitlePreferences.ts';
import { BasicChannelRepository } from './BasicChannelRepository.ts';
import { ChannelConfigRepository } from './ChannelConfigRepository.ts';
import { ChannelProgramRepository } from './ChannelProgramRepository.ts';
import { ChannelReadOpsRepository } from './ChannelReadOpsRepository.ts';
import { LineupRepository } from './LineupRepository.ts';

type Fixture = {
  channelDb: ChannelDB;
  lineup: LineupRepository;
  sqlite: Sqlite.Database;
  drizzle: DrizzleDBAccess;
  lineupPath: (id: string) => string;
  createChannel: (number: number) => Promise<string>;
  id: string;
};

const test = baseTest.extend<{ fixture: Fixture }>({
  fixture: async ({}, use) => {
    const dir = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dir.path);
    const opts = setGlobalOptionsUnchecked({
      database: dir.path,
      log_level: 'error',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    const connection = DBAccess.instance.getConnection();
    if (connection === undefined)
      throw new Error('Test database is not initialized');
    const { drizzle, kysely: db, sqlite } = connection;
    const config = await db
      .selectFrom('transcodeConfig')
      .select('uuid')
      .where('isDefault', '=', 1)
      .executeTakeFirstOrThrow();
    const readOps = new ChannelReadOpsRepository(drizzle);
    const lineup = new LineupRepository(
      db,
      drizzle,
      new FileSystemService(globalOptions()),
      () => mock<IWorkerPool>(),
      mock(MaterializeLineupCommand),
      mock(MaterializeProgramsCommand),
      new ProgramConverter(db),
      readOps,
    );
    const channelDb = new ChannelDB(
      new BasicChannelRepository(
        db,
        drizzle,
        mock(CacheImageService),
        readOps,
        lineup,
      ),
      new ChannelProgramRepository(db, drizzle),
      lineup,
      new ChannelConfigRepository(db),
      readOps,
    );
    const fillerId = v4();
    drizzle
      .insert(FillerShow)
      .values({ uuid: fillerId, name: 'Preserved filler' })
      .run();
    const programId = v4();
    drizzle
      .insert(Program)
      .values({
        uuid: programId,
        duration: 1000,
        type: 'movie',
        sourceType: 'plex',
        externalKey: programId,
        externalSourceId: tag('test'),
        title: 'Preserved program',
      })
      .run();
    const createChannel = async (number: number) => {
      const created = await channelDb.saveChannel({
        id: v4(),
        name: `Channel ${number}`,
        number,
        startTime: 123000,
        duration: 1000,
        offline: { mode: 'pic' },
        guideMinimumDuration: 30000,
        icon: { path: '', width: 100, duration: 0, position: 'bottom-right' },
        disableFillerOverlay: false,
        groupTitle: '',
        stealth: false,
        streamMode: 'hls',
        transcodeConfigId: config.uuid,
        subtitlesEnabled: true,
        fillerCollections: [{ id: fillerId, weight: 100, cooldownSeconds: 30 }],
        subtitlePreferences: [
          {
            langugeCode: 'eng',
            priority: 0,
            allowExternal: true,
            allowImageBased: false,
            filter: 'any',
          },
        ],
      });
      const id = created.channel.uuid;
      drizzle
        .insert(ChannelPrograms)
        .values({ channelUuid: id, programUuid: programId })
        .run();
      await lineup.saveLineup(id, {
        items: [{ type: 'content', id: programId, durationMs: 1000 }],
        onDemandConfig: { state: 'paused', cursor: 100 },
      });
      return id;
    };
    try {
      await use({
        channelDb,
        lineup,
        sqlite,
        drizzle,
        createChannel,
        lineupPath: (id) =>
          path.join(dir.path, 'channel-lineups', `${id}.json`),
        id: await createChannel(1),
      });
    } finally {
      vi.restoreAllMocks();
      await DBAccess.instance.closeConnection(path.join(dir.path, 'db.db'));
      await dir.cleanup();
    }
  },
});

function snapshot(fixture: Fixture) {
  const { drizzle, id } = fixture;
  return {
    channel: drizzle.select().from(Channel).where(eq(Channel.uuid, id)).get(),
    subtitles: drizzle
      .select()
      .from(ChannelSubtitlePreferences)
      .where(eq(ChannelSubtitlePreferences.channelId, id))
      .all(),
    fillers: drizzle
      .select()
      .from(ChannelFillerShow)
      .where(eq(ChannelFillerShow.channelUuid, id))
      .all(),
    programs: drizzle
      .select()
      .from(ChannelPrograms)
      .where(eq(ChannelPrograms.channelUuid, id))
      .all(),
  };
}

describe('checked channel deletion', () => {
  test('missing IDs leave lineup files alone', async ({ fixture: f }) => {
    const id = v4();
    await writeFile(f.lineupPath(id), 'orphaned lineup');
    await expect(f.channelDb.deleteChannelChecked(id)).resolves.toEqual({
      id,
      success: false,
      statusCode: 404,
      message: 'Channel not found',
      cleanup: { status: 'not_needed' },
    });
    expect(await readFile(f.lineupPath(id), 'utf8')).toBe('orphaned lineup');
  });

  test('marking failure leaves the channel, relations and lineup intact', async ({
    fixture: f,
  }) => {
    const before = snapshot(f);
    const bytes = await readFile(f.lineupPath(f.id));
    await mkdir(`${f.lineupPath(f.id)}.bak`);
    await expect(f.channelDb.deleteChannelChecked(f.id)).resolves.toEqual({
      id: f.id,
      success: false,
      statusCode: 500,
      message: 'Unable to delete channel',
      cleanup: { status: 'not_needed' },
    });
    expect(snapshot(f)).toEqual(before);
    expect(await readFile(f.lineupPath(f.id))).toEqual(bytes);
  });

  test('transaction failure restores the exact lineup and rolls back relation deletion', async ({
    fixture: f,
  }) => {
    const before = snapshot(f);
    const bytes = await readFile(f.lineupPath(f.id));
    f.sqlite.exec(
      "CREATE TRIGGER reject_delete BEFORE DELETE ON channel BEGIN SELECT RAISE(ABORT, 'private database error'); END",
    );
    await expect(f.channelDb.deleteChannelChecked(f.id)).resolves.toEqual({
      id: f.id,
      success: false,
      statusCode: 500,
      message: 'Unable to delete channel',
      cleanup: { status: 'succeeded' },
    });
    expect(snapshot(f)).toEqual(before);
    expect(await readFile(f.lineupPath(f.id))).toEqual(bytes);
    expect((await f.lineup.loadLineup(f.id)).onDemandConfig).toEqual({
      state: 'paused',
      cursor: 100,
    });
    await expect(readFile(`${f.lineupPath(f.id)}.bak`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('restoration failure is separate from the rolled-back deletion', async ({
    fixture: f,
  }) => {
    const before = snapshot(f);
    const bytes = await readFile(f.lineupPath(f.id));
    f.sqlite.function('block_restore', () => {
      mkdirSync(f.lineupPath(f.id));
      return 1;
    });
    f.sqlite.exec(
      "CREATE TRIGGER reject_delete BEFORE DELETE ON channel BEGIN SELECT block_restore(); SELECT RAISE(ABORT, 'private database error'); END",
    );
    await expect(f.channelDb.deleteChannelChecked(f.id)).resolves.toEqual({
      id: f.id,
      success: false,
      statusCode: 500,
      message: 'Unable to delete channel',
      cleanup: {
        status: 'failed',
        message: 'Unable to restore channel lineup',
      },
    });
    expect(snapshot(f)).toEqual(before);
    expect(await readFile(`${f.lineupPath(f.id)}.bak`)).toEqual(bytes);
  });

  test('a failed transaction does not restore a lineup this call did not mark', async ({
    fixture: f,
  }) => {
    await rename(f.lineupPath(f.id), `${f.lineupPath(f.id)}.bak`);
    const bytes = await readFile(`${f.lineupPath(f.id)}.bak`);
    f.sqlite.exec(
      "CREATE TRIGGER reject_delete BEFORE DELETE ON channel BEGIN SELECT RAISE(ABORT, 'private database error'); END",
    );
    expect(await f.channelDb.deleteChannelChecked(f.id)).toMatchObject({
      success: false,
      cleanup: { status: 'not_needed' },
    });
    await expect(readFile(f.lineupPath(f.id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(`${f.lineupPath(f.id)}.bak`)).toEqual(bytes);
  });

  test('committed deletion removes relations and replaces redirects without changing their duration', async ({
    fixture: f,
  }) => {
    const other = await f.createChannel(2);
    await f.lineup.saveLineup(other, {
      items: [
        { type: 'redirect', channel: f.id, durationMs: 5000 },
        { type: 'offline', durationMs: 1000 },
      ],
    });
    const bytes = await readFile(f.lineupPath(f.id));
    expect(await f.channelDb.deleteChannelChecked(f.id)).toEqual({
      id: f.id,
      success: true,
      cleanup: { status: 'succeeded' },
    });
    expect(snapshot(f)).toEqual({
      channel: undefined,
      subtitles: [],
      fillers: [],
      programs: [],
    });
    expect(await readFile(`${f.lineupPath(f.id)}.bak`)).toEqual(bytes);
    expect((await f.lineup.loadLineup(other, true)).items).toEqual([
      { type: 'offline', durationMs: 5000 },
      { type: 'offline', durationMs: 1000 },
    ]);
    expect((await f.channelDb.getChannel(other))?.duration).toBe(6000);
  });

  test('redirect write failure preserves committed success and reports failed cleanup', async ({
    fixture: f,
  }) => {
    const broken = await f.createChannel(2);
    const healthy = await f.createChannel(3);
    for (const id of [broken, healthy]) {
      await f.lineup.saveLineup(id, {
        items: [{ type: 'redirect', channel: f.id, durationMs: 5000 }],
      });
    }
    await rm(f.lineupPath(broken));
    await mkdir(f.lineupPath(broken));
    expect(await f.channelDb.deleteChannelChecked(f.id)).toEqual({
      id: f.id,
      success: true,
      cleanup: {
        status: 'failed',
        message: 'Unable to remove channel redirects',
      },
    });
    expect(snapshot(f)).toEqual({
      channel: undefined,
      subtitles: [],
      fillers: [],
      programs: [],
    });
    expect((await f.lineup.loadLineup(healthy, true)).items).toEqual([
      { type: 'offline', durationMs: 5000 },
    ]);
    await expect(readFile(f.lineupPath(f.id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('simultaneous calls only report one committed deletion', async ({
    fixture: f,
  }) => {
    const results = await Promise.all([
      f.channelDb.deleteChannelChecked(f.id),
      f.channelDb.deleteChannelChecked(f.id),
    ]);
    expect(results).toEqual([
      { id: f.id, success: true, cleanup: { status: 'succeeded' } },
      {
        id: f.id,
        success: false,
        statusCode: 404,
        message: 'Channel not found',
        cleanup: { status: 'not_needed' },
      },
    ]);
  });

  test('a concurrent row removal between marking and the transaction is not reported as this call succeeding', async ({
    fixture: f,
  }) => {
    const mark = f.lineup.markLineupFileForDeletionChecked.bind(f.lineup);
    vi.spyOn(f.lineup, 'markLineupFileForDeletionChecked').mockImplementation(
      async (id) => {
        const marked = await mark(id);
        f.drizzle.delete(Channel).where(eq(Channel.uuid, id)).run();
        return marked;
      },
    );
    expect(await f.channelDb.deleteChannelChecked(f.id)).toMatchObject({
      success: false,
      statusCode: 404,
    });
    await expect(readFile(f.lineupPath(f.id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('a trigger that ignores the delete cannot produce a false committed success', async ({
    fixture: f,
  }) => {
    const before = snapshot(f);
    f.sqlite.exec(
      'CREATE TRIGGER ignore_delete BEFORE DELETE ON channel BEGIN SELECT RAISE(IGNORE); END',
    );
    expect(await f.channelDb.deleteChannelChecked(f.id)).toMatchObject({
      success: false,
      statusCode: 500,
      cleanup: { status: 'succeeded' },
    });
    expect(snapshot(f)).toEqual(before);
  });
});
