import { search } from '@tunarr/shared/util';
import { eq } from 'drizzle-orm';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
import { DBAccess } from '../../db/DBAccess.ts';
import type { DrizzleDBAccess } from '../../db/schema/index.ts';
import { SmartCollection } from '../../db/schema/SmartCollection.ts';
import { SmartCollectionsDB } from '../../db/SmartCollectionsDB.ts';
import { setGlobalOptionsUnchecked } from '../../globals.ts';
import type { MeilisearchService } from '../../services/MeilisearchService.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { FixSmartCollectionFilters } from './FixSmartCollectionFIlters.ts';

describe('FixSmartCollectionFilters', () => {
  let cleanup: () => Promise<void>;
  let drizzle: DrizzleDBAccess;

  beforeAll(async () => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    const opts = setGlobalOptionsUnchecked({
      database: dbResult.path,
      log_level: 'info',
      verbose: 0,
    });
    await bootstrapTunarr(opts);
    const connection = DBAccess.instance.drizzle;
    if (!connection) {
      throw new Error('Expected Drizzle DB connection to be initialized');
    }
    drizzle = connection;
    cleanup = async () => {
      await DBAccess.instance.closeConnection(`${dbResult.path}/db.db`);
      await dbResult.cleanup();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    drizzle.delete(SmartCollection).run();
  });

  function silentLogger(warn = vi.fn()) {
    return { debug: vi.fn(), info: vi.fn(), warn } as unknown as Logger;
  }

  /** Runs the fixer over every saved collection and returns its warn mock. */
  async function runFixer() {
    const smartCollectionsDB = new SmartCollectionsDB(
      drizzle,
      new search.SearchParser(),
      {} as unknown as MeilisearchService,
    );
    Object.defineProperty(smartCollectionsDB, 'logger', {
      value: silentLogger(),
    });
    const fixer = new FixSmartCollectionFilters(smartCollectionsDB);
    const warn = vi.fn();
    Object.defineProperty(fixer, 'logger', { value: silentLogger(warn) });
    await fixer.run();
    return warn;
  }

  function insertCollection(filter: string | null, keywords: string | null) {
    const uuid = v4();
    drizzle
      .insert(SmartCollection)
      .values({ uuid, name: `collection ${uuid}`, filter, keywords })
      .run();
    return uuid;
  }

  function readCollection(uuid: string) {
    return drizzle
      .select({
        filter: SmartCollection.filter,
        keywords: SmartCollection.keywords,
      })
      .from(SmartCollection)
      .where(eq(SmartCollection.uuid, uuid))
      .get();
  }

  test('moves a free-text query saved before keywords existed into keywords', async () => {
    const uuid = insertCollection('space opera classics', null);

    await runFixer();

    expect(readCollection(uuid)).toEqual({
      filter: null,
      keywords: 'space opera classics',
    });
  });

  test('clears keywords that hold a copy of the filter', async () => {
    const filter =
      'genres.name in ["Genre X"] AND title not in ["Movie A", "Movie B"]';
    const uuid = insertCollection(filter, filter);

    const warn = await runFixer();

    expect(readCollection(uuid)).toEqual({ filter, keywords: null });
    expect(warn).not.toHaveBeenCalled();
  });

  test('clears keywords that hold an older version of the filter', async () => {
    const filter =
      'title in ["Movie A"] OR genres.name in ["Genre X"] OR genres.name in ["Genre Y"] AND rating in ["G"]';
    const uuid = insertCollection(
      filter,
      'title in ["Movie A"] OR genres.name in ["Genre X"]',
    );

    await runFixer();

    expect(readCollection(uuid)).toEqual({ filter, keywords: null });
  });

  test('keeps free-text keywords next to a filter', async () => {
    const filter = 'genre in ["Genre X"]';
    const uuid = insertCollection(filter, 'space opera');

    await runFixer();

    expect(readCollection(uuid)).toEqual({ filter, keywords: 'space opera' });
  });

  test('leaves an unparseable filter alone when keywords are set, and warns', async () => {
    const uuid = insertCollection('title = "Movie \\"A\\""', 'space opera');

    const warn = await runFixer();

    expect(readCollection(uuid)).toEqual({
      filter: 'title = "Movie \\"A\\""',
      keywords: 'space opera',
    });
    expect(warn).toHaveBeenCalled();
  });

  test('changes nothing on a second run', async () => {
    const legacy = insertCollection('weekend matinee', null);
    const filter = 'genres.name in ["Genre Z"]';
    const copied = insertCollection(filter, filter);

    await runFixer();
    const afterFirst = [readCollection(legacy), readCollection(copied)];
    await runFixer();

    expect([readCollection(legacy), readCollection(copied)]).toEqual(
      afterFirst,
    );
    expect(afterFirst).toEqual([
      { filter: null, keywords: 'weekend matinee' },
      { filter, keywords: null },
    ]);
  });
});
