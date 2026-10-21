import { faker } from '@faker-js/faker';
import { SaveableChannel } from '@tunarr/types';
import {
  CaptionAppearanceOverridesSchema,
  CaptionAppearanceSchema,
  ChannelCaptionsSchema,
  ChannelSchema,
  UpdateChannelRequestSchema,
  SaveableChannelSchema,
  StrictChannelAudioTracksSchema,
} from '@tunarr/types/schemas';
import tmp from 'tmp-promise';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { mock } from 'ts-mockito';
import { v4 } from 'uuid';
import { test as baseTest, describe, expect } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { globalOptions, setGlobalOptionsUnchecked } from '../globals.ts';
import { CacheImageService } from '../services/cacheImageService.ts';
import { FileSystemService } from '../services/FileSystemService.ts';
import { LoggerFactory } from '../util/logging/LoggerFactory.ts';
import { ChannelDB } from './ChannelDB.ts';
import { ProgramConverter } from './converters/ProgramConverter.ts';
import {
  dbChannelToApiChannel,
  ormChannelToApiChannel,
} from './converters/channelConverters.ts';
import { DBAccess } from './DBAccess.ts';
import { ContentItem } from './derived_types/Lineup.ts';
import type { IChannelDB } from './interfaces/IChannelDB.ts';
import { ChannelPrograms } from './schema/ChannelPrograms.ts';
import { FillerShow } from './schema/FillerShow.ts';
import { Program } from './schema/Program.ts';
import { IProgramDB } from './interfaces/IProgramDB.ts';
import { BasicChannelRepository } from './channel/BasicChannelRepository.ts';
import { ChannelProgramRepository } from './channel/ChannelProgramRepository.ts';
import { LineupRepository } from './channel/LineupRepository.ts';
import { ChannelConfigRepository } from './channel/ChannelConfigRepository.ts';
import { ChannelReadOpsRepository } from './channel/ChannelReadOpsRepository.ts';
import { MaterializeLineupCommand } from '../commands/MaterializeLineupCommand.ts';

type Fixture = {
  db: string;
  channelDb: IChannelDB;
  drizzle: any;
  defaultTranscodeConfigId: string;
};

const test = baseTest.extend<Fixture>({
  db: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    const opts = setGlobalOptionsUnchecked({
      database: dbResult.path,
      log_level: 'debug',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    await use(dbResult.path);
    // Close the database connection before cleanup
    const dbPath = `${dbResult.path}/db.db`;
    await DBAccess.instance.closeConnection(dbPath);
    await dbResult.cleanup();
  },
  channelDb: async ({ db: _ }, use) => {
    const dbAccess = DBAccess.instance;

    const mockWorkerPoolFactory = () =>
      ({
        submit: async (task: any) => {
          if (typeof task === 'function') {
            return await task();
          }
          return task;
        },
        queueTask: async (task: any) => {
          return { result: task };
        },
      }) as any;

    const mockMaterializeLineupCommand = {
      execute: async () => ({}),
    } as any;

    const mockMaterializeProgramsCommand = {
      execute: async (programs: any[]) =>
        programs.map((p: any) => ({ uuid: p.uuid, type: 'movie' })),
    } as any;

    const fileSystemService = new FileSystemService(globalOptions());

    const programConverter = new ProgramConverter(
      LoggerFactory.child({ className: ProgramConverter.name }),
      dbAccess.db!,
    );

    const lineupRepo = new LineupRepository(
      dbAccess.db!,
      dbAccess.drizzle!,
      fileSystemService,
      mockWorkerPoolFactory,
      mockMaterializeLineupCommand,
      mockMaterializeProgramsCommand,
      mock<IProgramDB>(),
      programConverter,
    );

    const channelReadOpsRepo = new ChannelReadOpsRepository(dbAccess.drizzle!);

    const basicChannelRepo = new BasicChannelRepository(
      dbAccess.db!,
      dbAccess.drizzle!,
      mock(CacheImageService),
      channelReadOpsRepo,
      lineupRepo,
    );

    const channelProgramRepo = new ChannelProgramRepository(
      dbAccess.db!,
      dbAccess.drizzle!,
    );

    const channelConfigRepo = new ChannelConfigRepository(dbAccess.db!);

    const channelDb = new ChannelDB(
      basicChannelRepo,
      channelProgramRepo,
      lineupRepo,
      channelConfigRepo,
      channelReadOpsRepo,
    );

    await use(channelDb);
  },
  drizzle: async ({}, use) => {
    await use(DBAccess.instance.drizzle);
  },
  defaultTranscodeConfigId: async ({ db: _ }, use) => {
    const dbAccess = DBAccess.instance;
    const config = await dbAccess
      .db!.selectFrom('transcodeConfig')
      .select('uuid')
      .where('isDefault', '=', 1)
      .executeTakeFirst();
    if (!config) {
      throw new Error('Default transcode config not found');
    }
    await use(config.uuid);
  },
});

// Helper function to create valid SaveableChannel objects
function createSaveableChannel(
  transcodeConfigId: string,
  overrides?: Partial<SaveableChannel>,
): SaveableChannel {
  return {
    id: v4(),
    name: faker.company.name(),
    number: faker.number.int({ min: 1, max: 999 }),
    startTime: Date.now(),
    duration: 0,
    offline: {
      mode: 'pic' as const,
    },
    guideMinimumDuration: 30000,
    icon: {
      path: '',
      width: 100,
      duration: 0,
      position: 'bottom-right' as const,
    },
    disableFillerOverlay: false,
    groupTitle: '',
    stealth: false,
    streamMode: 'hls' as const,
    transcodeConfigId,
    subtitlesEnabled: false,
    ...overrides,
  };
}

describe('optional channel relations', () => {
  async function seedRelations(channelDb: IChannelDB, configId: string) {
    const db = DBAccess.instance.db;
    if (db === undefined) throw new Error('Test database is not initialized');
    const fillerId = v4();
    const replacementFillerId = v4();
    await db
      .insertInto('fillerShow')
      .values([
        { uuid: fillerId, name: 'Original filler' },
        { uuid: replacementFillerId, name: 'Replacement filler' },
      ])
      .execute();
    const data = createSaveableChannel(configId, {
      onDemand: { enabled: true },
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
    const created = await channelDb.saveChannel(data);
    const id = created.channel.uuid;
    const rows = async () => ({
      fillers: await db
        .selectFrom('channelFillerShow')
        .selectAll()
        .where('channelUuid', '=', id)
        .execute(),
      subtitles: await channelDb.getChannelSubtitlePreferences(id),
    });
    const {
      fillerCollections: _fillers,
      subtitlePreferences: _subtitles,
      startTime: _start,
      onDemand: _onDemand,
      ...unrelated
    } = data;
    return { db, id, data, unrelated, rows, replacementFillerId };
  }

  test('omitted relations retain exact rows, start time and on-demand position', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    const seeded = await seedRelations(channelDb, defaultTranscodeConfigId);
    const before = await seeded.rows();
    const lineup = await channelDb.loadLineup(seeded.id);
    await channelDb.saveLineup(seeded.id, {
      ...lineup,
      onDemandConfig: { state: 'paused', cursor: 12345 },
    });
    const savedLineup = await channelDb.loadLineup(seeded.id);
    await channelDb.updateChannel(seeded.id, {
      ...seeded.unrelated,
      name: 'Unrelated name edit',
    });
    expect(await seeded.rows()).toEqual(before);
    expect((await channelDb.getChannel(seeded.id))?.startTime).toBe(
      seeded.data.startTime,
    );
    expect((await channelDb.loadLineup(seeded.id)).onDemandConfig).toEqual(
      savedLineup.onDemandConfig,
    );
  });

  test('bulk stealth preserves every other column, relation row and lineup file', async ({
    channelDb,
    defaultTranscodeConfigId,
    db,
  }) => {
    const seeded = await seedRelations(channelDb, defaultTranscodeConfigId);
    const iconPath = path.join(db, 'channel-icon.png');
    await writeFile(iconPath, 'icon bytes');
    await seeded.db
      .updateTable('channel')
      .set({ icon: JSON.stringify({ ...seeded.data.icon, path: iconPath }) })
      .where('uuid', '=', seeded.id)
      .execute();
    const lineup = await channelDb.loadLineup(seeded.id);
    await channelDb.saveLineup(seeded.id, {
      ...lineup,
      onDemandConfig: { state: 'paused', cursor: 12345 },
    });
    const lineupPath = path.join(db, 'channel-lineups', `${seeded.id}.json`);
    const beforeFile = await readFile(lineupPath);
    const before = await channelDb.getChannel(seeded.id);
    const beforeRows = await seeded.rows();
    const missing = v4();
    expect(channelDb.setChannelStealth([missing, seeded.id], true)).toEqual({
      results: [
        {
          id: missing,
          success: false,
          statusCode: 404,
          message: 'Channel not found',
        },
        { id: seeded.id, success: true },
      ],
      changedIds: [seeded.id],
    });
    expect(await channelDb.getChannel(seeded.id)).toEqual({
      ...before,
      stealth: true,
    });
    expect(await seeded.rows()).toEqual(beforeRows);
    expect(await readFile(lineupPath)).toEqual(beforeFile);
    expect(await readFile(iconPath, 'utf8')).toBe('icon bytes');

    const sqlite = DBAccess.instance.getConnection()?.sqlite;
    if (sqlite === undefined)
      throw new Error('Test database is not initialized');
    sqlite.exec(
      "CREATE TRIGGER reject_stealth_update BEFORE UPDATE OF stealth ON channel BEGIN SELECT RAISE(ABORT, 'unexpected write'); END",
    );
    expect(channelDb.setChannelStealth([seeded.id], true)).toEqual({
      results: [{ id: seeded.id, success: true }],
      changedIds: [],
    });
  });

  test('bulk stealth rolls back earlier changes if the transaction fails', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    const first = await seedRelations(channelDb, defaultTranscodeConfigId);
    const second = await channelDb.saveChannel(
      createSaveableChannel(defaultTranscodeConfigId, {
        number: first.data.number + 1000,
      }),
    );
    const sqlite = DBAccess.instance.getConnection()?.sqlite;
    if (sqlite === undefined)
      throw new Error('Test database is not initialized');
    sqlite.exec(
      "CREATE TRIGGER fail_second_stealth_update AFTER UPDATE OF stealth ON channel WHEN (SELECT COUNT(*) FROM channel WHERE stealth = 1) = 2 BEGIN SELECT RAISE(ABORT, 'second update failed'); END",
    );
    const beforeRows = await first.rows();
    expect(() =>
      channelDb.setChannelStealth([first.id, second.channel.uuid], true),
    ).toThrow('second update failed');
    expect((await channelDb.getChannel(first.id))?.stealth).toBe(false);
    expect((await channelDb.getChannel(second.channel.uuid))?.stealth).toBe(
      false,
    );
    expect(await first.rows()).toEqual(beforeRows);
  });

  for (const field of ['fillerCollections', 'subtitlePreferences'] as const) {
    test(`explicit empty ${field} clears only that relation`, async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const seeded = await seedRelations(channelDb, defaultTranscodeConfigId);
      const before = await seeded.rows();
      await channelDb.updateChannel(seeded.id, {
        ...seeded.unrelated,
        [field]: [],
      });
      const after = await seeded.rows();
      expect(
        after[field === 'fillerCollections' ? 'fillers' : 'subtitles'],
      ).toEqual([]);
      expect(
        after[field === 'fillerCollections' ? 'subtitles' : 'fillers'],
      ).toEqual(
        before[field === 'fillerCollections' ? 'subtitles' : 'fillers'],
      );
    });

    test(`explicit ${field} replaces only that relation`, async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const seeded = await seedRelations(channelDb, defaultTranscodeConfigId);
      const before = await seeded.rows();
      const replacement =
        field === 'fillerCollections'
          ? {
              fillerCollections: [
                {
                  id: seeded.replacementFillerId,
                  weight: 50,
                  cooldownSeconds: 10,
                },
              ],
            }
          : {
              subtitlePreferences: [
                {
                  langugeCode: 'spa',
                  priority: 0,
                  allowExternal: false,
                  allowImageBased: true,
                  filter: 'forced' as const,
                },
              ],
            };
      await channelDb.updateChannel(seeded.id, {
        ...seeded.unrelated,
        ...replacement,
      });
      const after = await seeded.rows();
      if (field === 'fillerCollections') {
        expect(after.fillers).toMatchObject([
          {
            fillerShowUuid: seeded.replacementFillerId,
            weight: 50,
            cooldown: 10,
          },
        ]);
        expect(after.subtitles).toEqual(before.subtitles);
      } else {
        expect(after.subtitles).toMatchObject([
          { languageCode: 'spa', filterType: 'forced' },
        ]);
        expect(after.fillers).toEqual(before.fillers);
      }
    });
  }

  test('a failed relation replacement rolls back all relation and channel changes', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    const seeded = await seedRelations(channelDb, defaultTranscodeConfigId);
    const before = await seeded.rows();
    await expect(
      channelDb.updateChannel(seeded.id, {
        ...seeded.unrelated,
        name: 'Must roll back',
        fillerCollections: [{ id: v4(), weight: 1, cooldownSeconds: 0 }],
        subtitlePreferences: [],
      }),
    ).rejects.toThrow();
    expect(await seeded.rows()).toEqual(before);
    expect((await channelDb.getChannel(seeded.id))?.name).toBe(
      seeded.data.name,
    );
  });

  test('creating an ordinary channel accepts explicit empty subtitle preferences', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    const created = await channelDb.saveChannel(
      createSaveableChannel(defaultTranscodeConfigId, {
        subtitlePreferences: [],
      }),
    );
    expect(
      await channelDb.getChannelSubtitlePreferences(created.channel.uuid),
    ).toEqual([]);
  });
});

describe('channel subtitle preference mode', () => {
  const preferences = [
    {
      langugeCode: 'eng',
      priority: 7,
      allowExternal: true,
      allowImageBased: false,
      filter: 'none' as const,
    },
    {
      langugeCode: 'spa',
      priority: 12,
      allowExternal: false,
      allowImageBased: true,
      filter: 'forced' as const,
    },
  ];

  test('write schemas preserve omission while response mode is required', ({
    defaultTranscodeConfigId,
  }) => {
    const data = createSaveableChannel(defaultTranscodeConfigId);
    expect(SaveableChannelSchema.parse(data)).not.toHaveProperty(
      'subtitlePreferenceMode',
    );
    expect(UpdateChannelRequestSchema.parse(data)).not.toHaveProperty(
      'subtitlePreferenceMode',
    );
    expect(
      ChannelSchema.safeParse({
        ...data,
        programCount: 0,
        onDemand: { enabled: false },
      }).success,
    ).toBe(false);
    expect(
      SaveableChannelSchema.safeParse({
        ...data,
        subtitlePreferenceMode: 'global',
      }).success,
    ).toBe(false);
  });

  test('create derives omitted mode from rows and honors both explicit modes', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    for (const [index, values] of [
      { expected: 'inherit' },
      { subtitlePreferences: [], expected: 'inherit' },
      { subtitlePreferences: preferences, expected: 'custom' },
      {
        subtitlePreferenceMode: 'inherit' as const,
        subtitlePreferences: preferences,
        expected: 'inherit',
      },
      {
        subtitlePreferenceMode: 'custom' as const,
        subtitlePreferences: [],
        expected: 'custom',
      },
    ].entries()) {
      const { expected, ...overrides } = values;
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          ...overrides,
          number: 2000 + index,
        }),
      );
      expect(created.channel.subtitlePreferenceMode).toBe(expected);
      expect(
        (await channelDb.getChannel(created.channel.uuid))
          ?.subtitlePreferenceMode,
      ).toBe(expected);
      expect(dbChannelToApiChannel(created).subtitlePreferenceMode).toBe(
        expected,
      );
      expect(ormChannelToApiChannel(created).subtitlePreferenceMode).toBe(
        expected,
      );
    }
  });

  for (const mode of ['inherit', 'custom'] as const) {
    test(`omitted update mode preserves ${mode} independently of preference replacement`, async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const data = createSaveableChannel(defaultTranscodeConfigId, {
        subtitlePreferenceMode: mode,
        subtitlePreferences: preferences,
      });
      const created = await channelDb.saveChannel(data);
      const {
        subtitlePreferenceMode: _mode,
        subtitlePreferences: _rows,
        ...update
      } = data;
      const before = await channelDb.getChannelSubtitlePreferences(
        created.channel.uuid,
      );
      await channelDb.updateChannel(created.channel.uuid, {
        ...update,
        name: 'Unrelated update',
      });
      expect(
        await channelDb.getChannelSubtitlePreferences(created.channel.uuid),
      ).toEqual(before);
      await channelDb.updateChannel(created.channel.uuid, {
        ...update,
        subtitlePreferences: [preferences[1]],
      });
      expect(
        await channelDb.getChannelSubtitlePreferences(created.channel.uuid),
      ).toMatchObject([{ languageCode: 'spa', priority: 12 }]);
      expect(
        (await channelDb.getChannel(created.channel.uuid))
          ?.subtitlePreferenceMode,
      ).toBe(mode);
      await channelDb.updateChannel(created.channel.uuid, {
        ...update,
        subtitlePreferences: [],
      });
      expect(
        await channelDb.getChannelSubtitlePreferences(created.channel.uuid),
      ).toEqual([]);
      expect(
        (await channelDb.getChannel(created.channel.uuid))
          ?.subtitlePreferenceMode,
      ).toBe(mode);
    });

    test(`copy preserves ${mode} and retained preference values with fresh row IDs`, async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          subtitlePreferenceMode: mode,
          subtitlePreferences: preferences,
        }),
      );
      const originalRows = await channelDb.getChannelSubtitlePreferences(
        created.channel.uuid,
      );
      const copied = await channelDb.copyChannel(created.channel.uuid);
      const copiedRows = await channelDb.getChannelSubtitlePreferences(
        copied.channel.uuid,
      );
      expect(copied.channel.subtitlePreferenceMode).toBe(mode);
      expect(
        copiedRows.map(({ uuid: _id, channelId: _channel, ...row }) => row),
      ).toEqual(
        originalRows.map(({ uuid: _id, channelId: _channel, ...row }) => row),
      );
      expect(copiedRows).toHaveLength(preferences.length);
      copiedRows.forEach((row) => {
        expect(row.channelId).toBe(copied.channel.uuid);
        expect(originalRows.map((original) => original.uuid)).not.toContain(
          row.uuid,
        );
      });
    });
  }

  test('switching to inherit and back retains exact custom rows', async ({
    channelDb,
    defaultTranscodeConfigId,
  }) => {
    const data = createSaveableChannel(defaultTranscodeConfigId, {
      subtitlePreferenceMode: 'custom',
      subtitlePreferences: preferences,
    });
    const created = await channelDb.saveChannel(data);
    const before = await channelDb.getChannelSubtitlePreferences(
      created.channel.uuid,
    );
    const { subtitlePreferences: _rows, ...update } = data;
    for (const mode of ['inherit', 'custom'] as const) {
      const updated = await channelDb.updateChannel(created.channel.uuid, {
        ...update,
        subtitlePreferenceMode: mode,
      });
      expect(updated.channel.subtitlePreferenceMode).toBe(mode);
      expect(
        await channelDb.getChannelSubtitlePreferences(created.channel.uuid),
      ).toEqual(before);
    }
  });
});

describe('ChannelDB', () => {
  describe('Channel CRUD Operations', () => {
    test('should create a new channel', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId);

      const result = await channelDb.saveChannel(channelData);

      expect(result.channel.uuid).toBeDefined();
      expect(result.channel.name).toBe(channelData.name);
      expect(result.channel.number).toBe(channelData.number);
      expect(result.lineup.items).toHaveLength(0);
    });

    test('should retrieve channel by UUID', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Test Channel',
        number: 100,
      });

      const created = await channelDb.saveChannel(channelData);
      const retrieved = await channelDb.getChannel(created.channel.uuid);

      expect(retrieved).toBeDefined();
      expect(retrieved?.uuid).toBe(created.channel.uuid);
      expect(retrieved?.name).toBe(channelData.name);
    });

    test('should retrieve channel by number', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelNumber = faker.number.int({ min: 1, max: 999 });
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Test Channel',
        number: channelNumber,
      });

      const created = await channelDb.saveChannel(channelData);
      const retrieved = await channelDb.getChannel(channelNumber);

      expect(retrieved).toBeDefined();
      expect(retrieved?.uuid).toBe(created.channel.uuid);
      expect(retrieved?.number).toBe(channelNumber);
    });

    test('should update an existing channel', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Original Name',
        number: 200,
      });

      const created = await channelDb.saveChannel(channelData);

      const updateData: SaveableChannel = {
        ...channelData,
        name: 'Updated Name',
        number: 201,
      };

      const updated = await channelDb.updateChannel(
        created.channel.uuid,
        updateData,
      );

      expect(updated.channel.uuid).toBe(created.channel.uuid);
      expect(updated.channel.name).toBe('Updated Name');
      expect(updated.channel.number).toBe(201);
    });

    test('should delete a channel', async ({
      channelDb,
      drizzle,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Channel to Delete',
        number: 300,
      });

      const created = await channelDb.saveChannel(channelData);

      await channelDb.deleteChannel(created.channel.uuid);

      const retrieved = await channelDb.getChannel(created.channel.uuid);
      expect(retrieved).toBeUndefined();
    });

    test('should check if channel exists', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Existence Check Channel',
        number: 400,
      });

      const created = await channelDb.saveChannel(channelData);

      const exists = await channelDb.channelExists(created.channel.uuid);
      expect(exists).toBe(true);

      const notExists = await channelDb.channelExists(v4());
      expect(notExists).toBe(false);
    });

    test('should get all channels', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      // Create multiple channels
      for (let i = 0; i < 3; i++) {
        const channelData = createSaveableChannel(defaultTranscodeConfigId, {
          name: `Channel ${i}`,
          number: 500 + i,
        });
        await channelDb.saveChannel(channelData);
      }

      const channels = await channelDb.getAllChannels();
      expect(channels.length).toBeGreaterThanOrEqual(3);
    });

    test('should clear filler collections when updating with an empty list', async ({
      channelDb,
      drizzle,
      defaultTranscodeConfigId,
    }) => {
      const fillerShowId = v4();

      await drizzle.insert(FillerShow).values({
        uuid: fillerShowId,
        name: 'Test Filler',
      });

      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Filler Clear Test Channel',
        fillerCollections: [
          {
            id: fillerShowId,
            weight: 1,
            cooldownSeconds: 0,
          },
        ],
      });

      const created = await channelDb.saveChannel(channelData);

      expect(created.channel.fillerShows).toHaveLength(1);

      const updated = await channelDb.updateChannel(created.channel.uuid, {
        ...channelData,
        fillerCollections: [],
      });

      expect(updated.channel.fillerShows).toHaveLength(0);
    });

    describe('audio track layout (switchable audio)', () => {
      test('saves the layout and reads it back in order', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        const created = await channelDb.saveChannel(
          createSaveableChannel(defaultTranscodeConfigId, {
            audioTracks: ['eng', 'jpn'],
          }),
        );

        expect(created.channel.audioTracks).toEqual(['eng', 'jpn']);
        const read = await channelDb.getChannel(created.channel.uuid);
        expect(read?.audioTracks).toEqual(['eng', 'jpn']);
      });

      test('an update without the field keeps it; an empty list turns it off', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        const channelData = createSaveableChannel(defaultTranscodeConfigId, {
          audioTracks: ['jpn', 'eng'],
        });
        const created = await channelDb.saveChannel(channelData);

        // A client from before the field existed sends the channel without it
        const { audioTracks: _, ...withoutField } = channelData;
        const kept = await channelDb.updateChannel(
          created.channel.uuid,
          withoutField,
        );
        expect(kept.channel.audioTracks).toEqual(['jpn', 'eng']);

        const off = await channelDb.updateChannel(created.channel.uuid, {
          ...channelData,
          audioTracks: [],
        });
        expect(off.channel.audioTracks).toBeNull();
      });

      test('a channel without a layout stores none', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        const created = await channelDb.saveChannel(
          createSaveableChannel(defaultTranscodeConfigId),
        );

        expect(created.channel.audioTracks).toBeNull();
      });

      test.each([
        [['eng', 'jpn'], true],
        [[], true],
        [['en'], false],
        [['ENG'], false],
        [['eng', 'eng'], false],
        [['eng', 'jpn', 'deu', 'fra', 'spa'], false],
        // a well-formed code that isn't a language
        [['zzz'], false],
        // one language under its bibliographic and terminological codes
        [['ger', 'deu'], false],
        [['ger', 'eng'], true],
      ])('a save validates %j: %s', (audioTracks, valid) => {
        expect(
          StrictChannelAudioTracksSchema.safeParse(audioTracks).success,
        ).toBe(valid);
      });
    });

    describe("a channel's own caption settings", () => {
      test('saves them and reads them back', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        const captions = {
          testPattern: true,
          alignment: 'left' as const,
          appearance: { backgroundColor: 'magenta' as const, maxLines: 3 },
        };
        const created = await channelDb.saveChannel(
          createSaveableChannel(defaultTranscodeConfigId, { captions }),
        );

        expect(created.channel.captions).toEqual(captions);
        const read = await channelDb.getChannel(created.channel.uuid);
        expect(read?.captions).toEqual(captions);
      });

      test('an update without the field keeps them; null goes back to the global settings', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        const channelData = createSaveableChannel(defaultTranscodeConfigId, {
          captions: { appearance: { textColor: 'yellow' } },
        });
        const created = await channelDb.saveChannel(channelData);

        // A client or script from before the field existed
        const { captions: _, ...withoutField } = channelData;
        const kept = await channelDb.updateChannel(
          created.channel.uuid,
          withoutField,
        );
        expect(kept.channel.captions).toEqual({
          appearance: { textColor: 'yellow' },
        });

        const reset = await channelDb.updateChannel(created.channel.uuid, {
          ...channelData,
          captions: null,
        });
        expect(reset.channel.captions).toBeNull();
      });

      test('stores nothing when they set nothing', async ({
        channelDb,
        defaultTranscodeConfigId,
      }) => {
        for (const captions of [
          undefined,
          {},
          { testPattern: false },
          { appearance: {} },
        ]) {
          const created = await channelDb.saveChannel(
            createSaveableChannel(defaultTranscodeConfigId, {
              number: faker.number.int({ min: 1000, max: 999999 }),
              captions,
            }),
          );
          expect(created.channel.captions).toBeNull();
        }
      });

      test.each([
        [{ appearance: { backgroundColor: 'magenta' } }, true],
        [{ alignment: 'left', testPattern: true }, true],
        [{ appearance: { maxLines: 9 } }, false],
        [{ appearance: { textColor: 'black' } }, false],
        [{ alignment: 'middle' }, false],
      ])('a save validates %j: %s', (captions, valid) => {
        expect(ChannelCaptionsSchema.safeParse(captions).success).toBe(valid);
      });

      // A default inside an optional field would fill every field in and
      // override the global look with the defaults
      test("a channel's appearance gets no defaults filled in", () => {
        expect(
          ChannelCaptionsSchema.parse({ appearance: { textColor: 'red' } }),
        ).toEqual({ appearance: { textColor: 'red' } });
        expect(
          SaveableChannelSchema.shape.captions.parse({ appearance: {} }),
        ).toEqual({ appearance: {} });
      });

      test('can override every appearance setting', () => {
        expect(
          Object.keys(CaptionAppearanceOverridesSchema.shape).sort(),
        ).toEqual(Object.keys(CaptionAppearanceSchema.shape).sort());
      });
    });
  });

  describe('Channel Lineup Operations', () => {
    test('should save and load lineup', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Lineup Test Channel',
        number: 600,
      });

      const created = await channelDb.saveChannel(channelData);

      const lineupData = {
        items: [
          {
            type: 'offline' as const,
            durationMs: 30000,
          },
        ],
        startTimeOffsets: [0],
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);

      const lineup = await channelDb.loadLineup(created.channel.uuid);

      expect(lineup.items).toHaveLength(1);
      expect(lineup.items[0].type).toBe('offline');
    });

    test('should not hand out the cached lineup by reference', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          name: 'Lineup Aliasing Channel',
          number: 601,
        }),
      );

      await channelDb.saveLineup(created.channel.uuid, {
        items: [
          { type: 'offline' as const, durationMs: 1000 },
          { type: 'offline' as const, durationMs: 2000 },
          { type: 'offline' as const, durationMs: 3000 },
        ],
        startTimeOffsets: [0, 1000, 3000],
      });

      // A reader takes the lineup and then yields, as the guide build does.
      const readerLineup = await channelDb.loadLineup(created.channel.uuid);
      const itemsAtReadTime = readerLineup.items;
      const offsetsAtReadTime = readerLineup.startTimeOffsets;

      // A writer replaces the lineup while the reader still holds its copy.
      await channelDb.saveLineup(created.channel.uuid, {
        items: [{ type: 'offline' as const, durationMs: 5000 }],
        startTimeOffsets: [0],
      });

      // The reader's view must be the one it read, not the writer's.
      expect(readerLineup.items).toBe(itemsAtReadTime);
      expect(readerLineup.items).toHaveLength(3);
      expect(readerLineup.startTimeOffsets).toBe(offsetsAtReadTime);
      expect(readerLineup.startTimeOffsets).toHaveLength(3);

      // A fresh load sees the write.
      const afterWrite = await channelDb.loadLineup(created.channel.uuid);
      expect(afterWrite).not.toBe(readerLineup);
      expect(afterWrite.items).toHaveLength(1);
    });

    test('should not let a mutated loaded lineup leak into the cache', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          name: 'Lineup Mutation Channel',
          number: 602,
        }),
      );

      await channelDb.saveLineup(created.channel.uuid, {
        items: [
          { type: 'offline' as const, durationMs: 1000 },
          { type: 'offline' as const, durationMs: 2000 },
        ],
        startTimeOffsets: [0, 1000],
      });

      const lineup = await channelDb.loadLineup(created.channel.uuid);
      lineup.items = [];
      lineup.startTimeOffsets = [];

      const reloaded = await channelDb.loadLineup(created.channel.uuid);
      expect(reloaded.items).toHaveLength(2);
      expect(reloaded.startTimeOffsets).toHaveLength(2);
    });

    test('should still persist removeProgramsFromLineup edits', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          name: 'Lineup Removal Channel',
          number: 603,
        }),
      );

      const programId = v4();
      await channelDb.saveLineup(created.channel.uuid, {
        items: [
          {
            type: 'content' as const,
            id: programId,
            durationMs: 1000,
          } as ContentItem,
          { type: 'offline' as const, durationMs: 2000 },
        ],
        startTimeOffsets: [0, 1000],
      });

      await channelDb.removeProgramsFromLineup(created.channel.uuid, [
        programId,
      ]);

      const reloaded = await channelDb.loadLineup(created.channel.uuid);
      expect(reloaded.items).toHaveLength(2);
      expect(reloaded.items[0].type).toBe('offline');
      expect(reloaded.items[0].durationMs).toBe(1000);
    });

    test('should keep where a custom show mid-roll segment resumes', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const created = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, {
          name: 'Custom Show Mid-roll Channel',
          number: 604,
        }),
      );

      const programId = v4();
      const customShowId = v4();
      await channelDb.saveLineup(created.channel.uuid, {
        items: [
          {
            type: 'content' as const,
            id: programId,
            customShowId,
            durationMs: 1000,
          },
          {
            type: 'content' as const,
            id: programId,
            customShowId,
            durationMs: 2000,
            startOffsetMs: 1000,
          },
        ],
        startTimeOffsets: [0, 1000],
      });

      const condensed = await channelDb.loadCondensedLineup(
        created.channel.uuid,
      );

      expect(
        condensed?.lineup.map((p) =>
          p.type === 'custom'
            ? { type: p.type, startOffsetMs: p.startOffsetMs }
            : { type: p.type },
        ),
      ).toEqual([
        { type: 'custom', startOffsetMs: undefined },
        { type: 'custom', startOffsetMs: 1000 },
      ]);
    });

    test('should load channel and lineup together', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Combined Load Channel',
        number: 700,
      });

      const created = await channelDb.saveChannel(channelData);

      const lineupData = {
        items: [
          {
            type: 'offline' as const,
            durationMs: 60000,
          },
        ],
        startTimeOffsets: [0],
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);

      const result = await channelDb.loadChannelAndLineup(created.channel.uuid);

      expect(result).toBeDefined();
      expect(result?.channel.uuid).toBe(created.channel.uuid);
      expect(result?.lineup.items).toHaveLength(1);
    });

    test('should load condensed lineup with offset and limit', async ({
      channelDb,
      defaultTranscodeConfigId,
      drizzle,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Condensed Lineup Channel',
        number: 800,
      });

      const created = await channelDb.saveChannel(channelData);

      // Create 10 programs and associate them with the channel
      const programIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const programId = v4();
        await drizzle.insert(Program).values({
          uuid: programId,
          duration: 30000,
          type: 'movie',
          sourceType: 'plex',
          externalKey: faker.string.alphanumeric({ length: 16 }),
          externalSourceId: faker.string.alphanumeric({ length: 16 }),
          title: `Test Movie ${i}`,
          year: 2020 + i,
        });

        // Associate program with channel
        await drizzle.insert(ChannelPrograms).values({
          channelUuid: created.channel.uuid,
          programUuid: programId,
        });

        programIds.push(programId);
      }

      // Create lineup with the created programs
      const lineupData = {
        items: programIds.map(
          (id) =>
            ({
              type: 'content' as const,
              id,
              durationMs: 30000,
            }) satisfies ContentItem,
        ),
        startTimeOffsets: Array.from({ length: 10 }, (_, i) => i * 30000),
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);

      // Load with offset and limit
      const condensed = await channelDb.loadCondensedLineup(
        created.channel.uuid,
        2,
        5,
      );

      expect(condensed).toBeDefined();
      expect(condensed?.lineup).toBeDefined();
      expect(condensed?.lineup.length).toBeLessThanOrEqual(5);
      expect(condensed?.lineup.length).toBeGreaterThan(0);
    });

    test('should update lineup config', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Config Update Channel',
        number: 900,
      });

      const created = await channelDb.saveChannel(channelData);

      // Should not throw
      await expect(
        channelDb.updateLineupConfig(
          created.channel.uuid,
          'channelId',
          created.channel.uuid,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('Channel Start Time Management', () => {
    test('should update channel start time', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Start Time Channel',
        number: 1000,
        startTime: 1000000,
      });

      const created = await channelDb.saveChannel(channelData);
      const newStartTime = Date.now();

      await channelDb.updateChannelStartTime(
        created.channel.uuid,
        newStartTime,
      );

      const retrieved = await channelDb.getChannel(created.channel.uuid);
      expect(retrieved?.startTime).toBe(newStartTime);
    });

    test('snaps an off-minute start time to the minute when settings are saved', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Rebased Channel',
        number: 1001,
        startTime: 1_760_000_040_000,
      });
      const created = await channelDb.saveChannel(channelData);

      const rebased = 1_760_000_071_234;
      await channelDb.updateChannelStartTime(created.channel.uuid, rebased);

      const updated = await channelDb.updateChannel(created.channel.uuid, {
        ...channelData,
        startTime: rebased,
        name: 'Renamed',
      });

      expect(updated.channel.name).toBe('Renamed');
      expect(updated.channel.startTime).toBe(1_760_000_040_000);
    });

    test('rounds a new start time to the minute', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Moved Channel',
        number: 1002,
        startTime: 1_760_000_040_000,
      });
      const created = await channelDb.saveChannel(channelData);

      const updated = await channelDb.updateChannel(created.channel.uuid, {
        ...channelData,
        startTime: 1_760_003_671_234,
      });

      expect(updated.channel.startTime).toBe(1_760_003_640_000);
    });

    test('settings saves do not overwrite the lineup duration', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Duration Channel',
        number: 1003,
      });
      const created = await channelDb.saveChannel(channelData);
      await channelDb.saveLineup(created.channel.uuid, {
        items: [{ type: 'offline', durationMs: 90_000 }],
        schedule: null,
      });

      // A form loaded before the lineup change still holds the old duration.
      const updated = await channelDb.updateChannel(created.channel.uuid, {
        ...channelData,
        duration: 1,
      });

      expect(updated.channel.duration).toBe(90_000);
    });

    test('should sync channel duration', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Duration Sync Channel',
        number: 1100,
      });

      const created = await channelDb.saveChannel(channelData);

      // Create lineup
      const lineupData = {
        items: [
          {
            type: 'offline' as const,
            durationMs: 60000,
          },
          {
            type: 'offline' as const,
            durationMs: 120000,
          },
        ],
        startTimeOffsets: [0, 60000],
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);
      // await channelDb.du(created.channel.uuid);

      const retrieved = await channelDb.getChannel(created.channel.uuid);
      expect(retrieved?.duration).toBe(180000); // Sum of durations
    });
  });

  describe('Channel Copy Operation', () => {
    test('should copy a channel with new number', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Original Channel',
        number: 1200,
      });

      const created = await channelDb.saveChannel(channelData);

      const copied = await channelDb.copyChannel(created.channel.uuid);

      expect(copied.channel.uuid).not.toBe(created.channel.uuid);
      expect(copied.channel.name).toContain('Copy');
      expect(copied.channel.number).not.toBe(created.channel.number);
    });

    test('should copy channel lineup', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Original with Lineup',
        number: 1300,
      });

      const created = await channelDb.saveChannel(channelData);

      const lineupData = {
        items: [
          {
            type: 'offline' as const,
            durationMs: 30000,
          },
          {
            type: 'offline' as const,
            durationMs: 60000,
          },
        ],
        startTimeOffsets: [0, 30000],
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);

      const copied = await channelDb.copyChannel(created.channel.uuid);

      expect(copied.lineup.items).toHaveLength(2);
      expect(copied.lineup.items[0].durationMs).toBe(30000);
      expect(copied.lineup.items[1].durationMs).toBe(60000);
    });
  });

  describe('Batch Operations', () => {
    test('should load all lineups', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      // Create multiple channels with lineups
      for (let i = 0; i < 3; i++) {
        const channelData = createSaveableChannel(defaultTranscodeConfigId, {
          name: `Batch Channel ${i}`,
          number: 1400 + i,
        });

        const created = await channelDb.saveChannel(channelData);

        const lineupData = {
          items: [
            {
              type: 'offline' as const,
              durationMs: 30000,
            },
          ],
          startTimeOffsets: [0],
        };

        await channelDb.saveLineup(created.channel.uuid, lineupData);
      }

      const allLineups = await channelDb.loadAllLineupConfigs();
      expect(Object.keys(allLineups).length).toBeGreaterThanOrEqual(3);
    });

    test('should load all raw lineups', async ({
      channelDb,
      defaultTranscodeConfigId,
    }) => {
      const channelData = createSaveableChannel(defaultTranscodeConfigId, {
        name: 'Raw Lineup Channel',
        number: 1500,
      });

      const created = await channelDb.saveChannel(channelData);

      const lineupData = {
        items: [
          {
            type: 'offline' as const,
            durationMs: 30000,
          },
        ],
        startTimeOffsets: [0],
      };

      await channelDb.saveLineup(created.channel.uuid, lineupData);

      const rawLineups = await channelDb.loadAllRawLineups();
      expect(Object.keys(rawLineups).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('removeProgramsFromAllLineups', () => {
    async function createProgram(drizzle: any, durationMs: number) {
      const programId = v4();
      await drizzle.insert(Program).values({
        uuid: programId,
        duration: durationMs,
        type: 'movie',
        sourceType: 'plex',
        externalKey: faker.string.alphanumeric({ length: 16 }),
        externalSourceId: faker.string.alphanumeric({ length: 16 }),
        title: faker.word.words(3),
        year: 2020,
      });
      return programId;
    }

    test('rewrites matching content items to flex and leaves the rest alone', async ({
      channelDb,
      defaultTranscodeConfigId,
      drizzle,
    }) => {
      const target = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, { number: 810 }),
      );
      const other = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, { number: 811 }),
      );

      const trashedId = await createProgram(drizzle, 30000);
      const keptId = await createProgram(drizzle, 45000);

      await channelDb.saveLineup(target.channel.uuid, {
        items: [
          { type: 'content', id: trashedId, durationMs: 30000 },
          { type: 'content', id: keptId, durationMs: 45000 },
          { type: 'offline', durationMs: 5000 },
          {
            type: 'redirect',
            channel: other.channel.uuid,
            durationMs: 10000,
          },
        ],
      });

      const changed = await channelDb.removeProgramsFromAllLineups(
        new Set([trashedId]),
      );

      expect(changed).toBe(1);

      const lineup = await channelDb.loadLineup(target.channel.uuid, true);
      expect(lineup.items).toHaveLength(4);
      expect(lineup.items[0]).toEqual({ type: 'offline', durationMs: 30000 });
      expect(lineup.items[1]).toEqual({
        type: 'content',
        id: keptId,
        durationMs: 45000,
      });
      expect(lineup.items[2].type).toBe('offline');
      expect(lineup.items[3].type).toBe('redirect');

      // Flex preserves durationMs, so total channel duration is unchanged.
      const channel = await channelDb.getChannel(target.channel.uuid);
      expect(channel?.duration).toBe(90000);
    });

    test('does not rewrite lineups of unaffected channels', async ({
      channelDb,
      defaultTranscodeConfigId,
      drizzle,
    }) => {
      const affected = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, { number: 820 }),
      );
      const untouched = await channelDb.saveChannel(
        createSaveableChannel(defaultTranscodeConfigId, { number: 821 }),
      );

      const trashedId = await createProgram(drizzle, 30000);
      const unrelatedId = await createProgram(drizzle, 30000);

      await channelDb.saveLineup(affected.channel.uuid, {
        items: [{ type: 'content', id: trashedId, durationMs: 30000 }],
      });
      await channelDb.saveLineup(untouched.channel.uuid, {
        items: [{ type: 'content', id: unrelatedId, durationMs: 30000 }],
      });

      const before = await channelDb.loadLineup(untouched.channel.uuid, true);

      const changed = await channelDb.removeProgramsFromAllLineups([trashedId]);

      expect(changed).toBe(1);

      const after = await channelDb.loadLineup(untouched.channel.uuid, true);
      expect(after.items).toEqual(before.items);
      expect(after.lastUpdated).toBe(before.lastUpdated);
    });

    test('is a no-op for an empty id set', async ({ channelDb }) => {
      expect(await channelDb.removeProgramsFromAllLineups([])).toBe(0);
      expect(await channelDb.removeProgramsFromAllLineups(new Set())).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should return undefined for non-existent channel', async ({
      channelDb,
    }) => {
      const nonExistentId = v4();
      const channel = await channelDb.getChannel(nonExistentId);
      expect(channel).toBeUndefined();
    });

    test('should handle delete of non-existent channel', async ({
      channelDb,
    }) => {
      const nonExistentId = v4();
      // Should not throw
      await expect(
        channelDb.deleteChannel(nonExistentId),
      ).resolves.not.toThrow();
    });

    test('should return null for non-existent channel lineup', async ({
      channelDb,
    }) => {
      const nonExistentId = v4();
      const lineup = await channelDb.loadChannelAndLineup(nonExistentId);
      expect(lineup).toBeNull();
    });
  });
});
