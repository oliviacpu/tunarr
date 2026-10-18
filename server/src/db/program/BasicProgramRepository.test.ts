import { range } from 'lodash-es';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import { test as baseTest } from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
import { setGlobalOptions } from '../../globals.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import { databaseFileWarmer } from '../databaseFileWarmer.ts';
import { DBAccess } from '../DBAccess.ts';
import type { DrizzleDBAccess } from '../schema/index.ts';
import {
  BasicProgramRepository,
  GuideFetchBatchSize,
} from './BasicProgramRepository.ts';

vi.mock('../databaseFileWarmer.ts', () => ({
  databaseFileWarmer: {
    warm: vi.fn(() => Promise.resolve({ bytes: 0, ms: 0 })),
  },
}));

type Fixture = {
  drizzle: DrizzleDBAccess;
  repo: BasicProgramRepository;
};

const test = baseTest.extend<Fixture>({
  drizzle: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    setGlobalOptions({
      database: dbResult.path,
      log_level: 'debug',
      verbose: 0,
    });
    await bootstrapTunarr();
    const drizzle = DBAccess.instance.drizzle;
    if (drizzle === undefined) {
      throw new Error('the test database did not open');
    }
    await use(drizzle);
    await dbResult.cleanup();
  },
  repo: async ({ drizzle }, use) => {
    const kysely = DBAccess.instance.db;
    if (kysely === undefined) {
      throw new Error('the test database did not open');
    }
    await use(new BasicProgramRepository(kysely, drizzle));
  },
});

describe('BasicProgramRepository.getGuideProgramsByIds', () => {
  beforeEach(() => {
    vi.mocked(databaseFileWarmer.warm).mockClear();
    vi.restoreAllMocks();
  });

  test('reads the database into the file cache before its first query when asked', async ({
    drizzle,
    repo,
  }) => {
    const findMany = vi.spyOn(drizzle.query.program, 'findMany');

    await repo.getGuideProgramsByIds([v4(), v4()], {
      includeCreditArtwork: true,
      readDatabaseIntoFileCache: true,
    });

    expect(databaseFileWarmer.warm).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalled();
    expect(
      vi.mocked(databaseFileWarmer.warm).mock.invocationCallOrder[0],
    ).toBeLessThan(findMany.mock.invocationCallOrder[0] ?? 0);
  });

  test('leaves the file cache alone unless asked, or when there is nothing to fetch', async ({
    repo,
  }) => {
    await repo.getGuideProgramsByIds([v4()], { includeCreditArtwork: false });
    await repo.getGuideProgramsByIds([], {
      includeCreditArtwork: false,
      readDatabaseIntoFileCache: true,
    });

    expect(databaseFileWarmer.warm).not.toHaveBeenCalled();
  });

  test('queries at most 50 programs at a time, letting other work run between queries', async ({
    drizzle,
    repo,
  }) => {
    const ids = range(0, 120).map(() => v4());
    // Each query notes how many event loop turns ran since the last one
    let turns = 0;
    let spinning = true;
    const spin = () => {
      if (spinning) {
        turns++;
        setImmediate(spin);
      }
    };
    setImmediate(spin);
    const turnsAtQuery: number[] = [];
    const findMany = drizzle.query.program.findMany.bind(drizzle.query.program);
    vi.spyOn(drizzle.query.program, 'findMany').mockImplementation((config) => {
      turnsAtQuery.push(turns);
      return findMany(config);
    });

    await repo.getGuideProgramsByIds(ids, { includeCreditArtwork: false });
    spinning = false;

    expect(GuideFetchBatchSize).toBe(50);
    expect(turnsAtQuery).toHaveLength(3);
    for (let i = 1; i < turnsAtQuery.length; i++) {
      expect(turnsAtQuery[i]).toBeGreaterThan(turnsAtQuery[i - 1] ?? 0);
    }
  });
});
