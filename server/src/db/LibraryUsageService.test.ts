import type { SaveableChannel } from '@tunarr/types';
import { TimeSlotScheduleSchema } from '@tunarr/types/api';
import tmp from 'tmp-promise';
import { mock } from 'ts-mockito';
import { v4 } from 'uuid';
import { describe, expect, test as baseTest, vi } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { globalOptions, setGlobalOptionsUnchecked } from '../globals.ts';
import { CacheImageService } from '../services/cacheImageService.ts';
import { FileSystemService } from '../services/FileSystemService.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { BasicChannelRepository } from './channel/BasicChannelRepository.ts';
import { ChannelReadOpsRepository } from './channel/ChannelReadOpsRepository.ts';
import { LineupRepository } from './channel/LineupRepository.ts';
import { ProgramConverter } from './converters/ProgramConverter.ts';
import { DBAccess } from './DBAccess.ts';
import { FillerDB } from './FillerListDB.ts';
import { LibraryUsageService } from './LibraryUsageService.ts';
import { FillerShow } from './schema/FillerShow.ts';

interface Fixture {
  library: {
    basic: BasicChannelRepository;
    lineups: LineupRepository;
    fillers: FillerDB;
    usage: LibraryUsageService;
    create: (overrides?: Partial<SaveableChannel>) => Promise<SaveableChannel>;
    filler: () => string;
  };
}

const test = baseTest.extend<Fixture>({
  library: async ({}, use) => {
    const directory = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(directory.path);
    await bootstrapTunarr(
      setGlobalOptionsUnchecked({
        database: directory.path,
        log_level: 'error',
        verbose: 0,
      }),
    );
    const access = DBAccess.instance;
    const db = access.db!;
    const drizzle = access.drizzle!;
    const readOps = new ChannelReadOpsRepository(drizzle);
    const lineups = new LineupRepository(
      db,
      drizzle,
      new FileSystemService(globalOptions()),
      mock(),
      mock(),
      mock(),
      new ProgramConverter(db),
      readOps,
    );
    const basic = new BasicChannelRepository(
      db,
      drizzle,
      mock(CacheImageService),
      readOps,
      lineups,
    );
    const transcode = await db
      .selectFrom('transcodeConfig')
      .select('uuid')
      .where('isDefault', '=', 1)
      .executeTakeFirstOrThrow();
    let number = 1;
    await use({
      basic,
      lineups,
      fillers: new FillerDB(db, drizzle),
      usage: new LibraryUsageService(drizzle, lineups),
      create: async (overrides = {}) => {
        const channel: SaveableChannel = {
          id: v4(),
          name: 'Channel',
          number: number++,
          startTime: Date.now(),
          duration: 0,
          offline: { mode: 'pic' },
          guideMinimumDuration: 30000,
          icon: { path: '', width: 100, duration: 0, position: 'bottom-right' },
          disableFillerOverlay: false,
          groupTitle: '',
          stealth: false,
          streamMode: 'hls',
          transcodeConfigId: transcode.uuid,
          subtitlesEnabled: false,
          ...overrides,
        };
        const created = await basic.saveChannel(channel);
        return { ...channel, id: created.channel.uuid };
      },
      filler: () => {
        const uuid = v4();
        drizzle.insert(FillerShow).values({ uuid, name: 'Filler' }).run();
        return uuid;
      },
    });
    vi.restoreAllMocks();
    await access.closeConnection(`${directory.path}/db.db`);
    await directory.cleanup();
  },
});

const attachment = (id: string) => ({ id, weight: 100, cooldownSeconds: 0 });
const channelUse = (channel: SaveableChannel, slots: number[] = []) => ({
  id: channel.id,
  name: channel.name,
  number: channel.number,
  slots,
});

function schedule(
  customShowId: string,
  smartCollectionId: string,
  fillerListId: string,
) {
  return TimeSlotScheduleSchema.parse({
    type: 'time',
    flexPreference: 'end',
    latenessMs: 0,
    maxDays: 1,
    padMs: 1,
    period: 'day',
    timeZoneOffset: 0,
    slots: [
      {
        id: v4(),
        type: 'custom-show',
        customShowId,
        order: 'next',
        startTime: 0,
        filler: [{ fillerListId, types: ['pre', 'post', 'mid', 'tail'] }],
      },
      {
        id: v4(),
        type: 'smart-collection',
        smartCollectionId,
        order: 'next',
        startTime: 1000,
      },
      {
        id: v4(),
        type: 'filler',
        fillerListId,
        order: 'uniform',
        durationWeighting: 'linear',
        decayFactor: 0.5,
        recoveryFactor: 0.5,
        startTime: 2000,
      },
    ],
  });
}

describe('library channel references', () => {
  test('counts a relational-only filler attachment and shares one cached scan', async ({
    library,
  }) => {
    const id = library.filler();
    const channel = await library.create({
      fillerCollections: [attachment(id)],
    });
    const load = vi.spyOn(library.lineups, 'loadLineup');
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [id]: [channelUse(channel)],
    });
    expect(await library.usage.getUsedBy('customShows')).toEqual({});
    expect(await library.usage.getUsedBy('smartCollections')).toEqual({});
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('unions attachments, content, offline music, flex filler and slots with unique sorted channels', async ({
    library,
  }) => {
    const filler = library.filler();
    const custom = v4();
    const smart = v4();
    const first = await library.create({
      number: 9,
      name: 'Nine',
      fillerCollections: [attachment(filler)],
      offline: { mode: 'pic', musicListId: filler },
    });
    const second = await library.create({
      number: 2,
      name: 'Two',
      offline: { mode: 'pic', musicListId: filler },
    });
    await library.lineups.saveLineup(first.id, {
      items: [
        {
          type: 'content',
          id: v4(),
          durationMs: 1000,
          customShowId: custom,
          fillerListId: filler,
        },
        {
          type: 'offline',
          durationMs: 1000,
          fillerConfig: { fillerListIds: [filler] },
        },
      ],
      schedule: schedule(custom, smart, filler),
    });
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(second), channelUse(first, [1, 3])],
    });
    expect(await library.usage.getUsedBy('customShows')).toEqual({
      [custom]: [channelUse(first, [1])],
    });
    expect(await library.usage.getUsedBy('smartCollections')).toEqual({
      [smart]: [channelUse(first, [2])],
    });
  });

  test('counts filler IDs carried only by content items or offline filler configuration', async ({
    library,
  }) => {
    const channel = await library.create();
    const contentFiller = v4();
    const flexFiller = v4();
    await library.lineups.saveLineup(channel.id, {
      items: [
        {
          type: 'content',
          id: v4(),
          durationMs: 1000,
          fillerListId: contentFiller,
        },
        {
          type: 'offline',
          durationMs: 1000,
          fillerConfig: { fillerListIds: [flexFiller] },
        },
      ],
    });
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [contentFiller]: [channelUse(channel)],
      [flexFiller]: [channelUse(channel)],
    });
  });

  test('refreshes a populated cache after every lineup save and schedule config update', async ({
    library,
  }) => {
    const channel = await library.create();
    const custom = v4();
    const smart = v4();
    expect(await library.usage.getUsedBy('customShows')).toEqual({});
    await library.lineups.saveLineup(channel.id, {
      items: [
        { type: 'content', id: v4(), durationMs: 1000, customShowId: custom },
      ],
    });
    expect(await library.usage.getUsedBy('customShows')).toEqual({
      [custom]: [channelUse(channel)],
    });
    await library.lineups.updateLineupConfig(
      channel.id,
      'schedule',
      schedule(custom, smart, v4()),
    );
    expect(await library.usage.getUsedBy('smartCollections')).toEqual({
      [smart]: [channelUse(channel, [2])],
    });
    await library.lineups.saveLineup(channel.id, { items: [], schedule: null });
    expect(await library.usage.getUsedBy('customShows')).toEqual({});
    expect(await library.usage.getUsedBy('smartCollections')).toEqual({});
  });

  test('refreshes cached filler references after attach, detach, rename and offline music changes', async ({
    library,
  }) => {
    const filler = library.filler();
    const channel = await library.create();
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({});
    await library.basic.updateChannel(channel.id, {
      ...channel,
      fillerCollections: [attachment(filler)],
    });
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(channel)],
    });
    await library.basic.updateChannel(channel.id, {
      ...channel,
      fillerCollections: [],
    });
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({});
    const renamed = {
      ...channel,
      name: 'Renamed',
      offline: { mode: 'pic' as const, musicListId: filler },
    };
    await library.basic.updateChannel(channel.id, renamed);
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(renamed)],
    });
    await library.basic.updateChannel(channel.id, channel);
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({});
  });

  test('refreshes cached references after channel creation, copying and deletion', async ({
    library,
  }) => {
    const filler = library.filler();
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({});
    const channel = await library.create({
      fillerCollections: [attachment(filler)],
    });
    expect((await library.usage.getUsedBy('fillerLists'))[filler]).toHaveLength(
      1,
    );
    const copy = await library.basic.copyChannel(channel.id);
    expect((await library.usage.getUsedBy('fillerLists'))[filler]).toHaveLength(
      2,
    );
    await library.basic.deleteChannel(copy.channel.uuid, true);
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(channel)],
    });
  });

  test('refreshes a populated cache after filler deletion removes relational and music attachments', async ({
    library,
  }) => {
    const filler = library.filler();
    const channel = await library.create({
      fillerCollections: [attachment(filler)],
      offline: { mode: 'pic', musicListId: filler },
    });
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(channel)],
    });
    library.fillers.deleteFiller(filler);
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({});
  });

  test('retries a scan invalidated by a save while it was in flight', async ({
    library,
  }) => {
    const channel = await library.create();
    const custom = v4();
    const load = library.lineups.loadLineup.bind(library.lineups);
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(library.lineups, 'loadLineup').mockImplementationOnce(
      async (id) => {
        const old = await load(id);
        started();
        await gate;
        return old;
      },
    );
    const pending = library.usage.getUsedBy('customShows');
    await startedPromise;
    await library.lineups.saveLineup(channel.id, {
      items: [
        { type: 'content', id: v4(), durationMs: 1000, customShowId: custom },
      ],
    });
    release();
    expect(await pending).toEqual({ [custom]: [channelUse(channel)] });
  });

  test('does not retain a failed scan as cached missing references', async ({
    library,
  }) => {
    const filler = library.filler();
    const channel = await library.create({
      fillerCollections: [attachment(filler)],
    });
    vi.spyOn(library.lineups, 'loadLineup').mockRejectedValueOnce(
      new Error('Unreadable lineup'),
    );
    await expect(library.usage.getUsedBy('fillerLists')).rejects.toThrow(
      'Unreadable lineup',
    );
    expect(await library.usage.getUsedBy('fillerLists')).toEqual({
      [filler]: [channelUse(channel)],
    });
  });
});
