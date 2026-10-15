import { search } from '@tunarr/shared/util';
import type { SearchFilter } from '@tunarr/types/schemas';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import { MeilisearchService } from '../services/MeilisearchService.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import { DBAccess } from './DBAccess.ts';
import type { DrizzleDBAccess } from './schema/index.ts';
import { SmartCollection } from './schema/SmartCollection.ts';
import { SmartCollectionsDB } from './SmartCollectionsDB.ts';

// The fields buildFilterExpression consults; none of these are case-encoded.
const ProgramsIndex = {
  name: 'programs',
  primaryKey: 'id',
  filterable: ['title', 'genres.name', 'rating'],
  sortable: ['title'],
  caseSensitiveFilters: ['libraryId', 'mediaSourceId'],
};

// The shapes of filters an API client saved to a real database, with the
// values replaced, and the Meilisearch filter each one should run. A single
// value `in` becomes `=`, and AND and OR group from the right.
const StoredFilters = [
  {
    name: 'single genre',
    filter: 'genres.name in ["Genre X"]',
    meilisearch: `genres.name = 'Genre X'`,
  },
  {
    name: 'genres and excluded titles',
    filter:
      'genres.name in ["Genre X"] AND genres.name in ["Genre Y"] AND title not in ["Movie A: Part 2", "Movie B"]',
    meilisearch: `genres.name = 'Genre X' AND genres.name = 'Genre Y' AND title NOT IN ['Movie A: Part 2', 'Movie B']`,
  },
  {
    name: 'genre and one excluded title',
    filter: 'genres.name in ["Genre X"] AND title not in ["Movie A"]',
    meilisearch: `genres.name = 'Genre X' AND title != 'Movie A'`,
  },
  {
    name: 'OR chain ending in AND',
    filter: `title in ["Movie A", "Movie's Night (2008)", "Where's My Movie?"] OR genres.name in ["Genre X"] OR genres.name in ["Genre Y"] AND rating in ["G", "PG", "TV-Y"]`,
    meilisearch: `title IN ['Movie A', 'Movie\\'s Night (2008)', 'Where\\'s My Movie?'] OR genres.name = 'Genre X' OR (genres.name = 'Genre Y' AND rating IN ['G', 'PG', 'TV-Y'])`,
  },
  {
    name: 'AND followed by OR',
    filter:
      'genres.name in ["Genre X"] AND genres.name not in ["Genre Y", "Genre Z"] OR title in ["Movie A", "Movie B"]',
    meilisearch: `genres.name = 'Genre X' AND (genres.name NOT IN ['Genre Y', 'Genre Z'] OR title IN ['Movie A', 'Movie B'])`,
  },
  {
    name: 'OR followed by AND',
    filter:
      'genres.name in ["Genre X"] OR genres.name in ["Genre Y"] AND genres.name in ["Genre Z"]',
    meilisearch: `genres.name = 'Genre X' OR (genres.name = 'Genre Y' AND genres.name = 'Genre Z')`,
  },
];

describe('SmartCollectionsDB', () => {
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

  function makeDb() {
    const parser = new search.SearchParser();
    const searchFn = vi.fn(async () => ({ type: 'filter', results: [] }));
    const db = new SmartCollectionsDB(drizzle, parser, {
      search: searchFn,
    } as unknown as MeilisearchService);
    const warn = vi.fn();
    Object.defineProperty(db, 'logger', {
      value: { debug: vi.fn(), warn } as unknown as Logger,
    });
    return { db, parser, searchFn, warn };
  }

  function insertCollection(filter: string, keywords: string = '') {
    const uuid = v4();
    drizzle
      .insert(SmartCollection)
      .values({ uuid, name: `collection ${uuid}`, filter, keywords })
      .run();
    return uuid;
  }

  test.each(StoredFilters)(
    'reads a stored $name filter',
    async ({ filter }) => {
      const { db, warn } = makeDb();
      const uuid = insertCollection(filter);

      const collection = await db.getById(uuid);

      expect(warn).not.toHaveBeenCalled();
      expect(collection?.filter).toBeDefined();
      expect(collection?.filterString).toEqual(filter);
    },
  );

  test.each(StoredFilters)(
    'materializes a stored $name filter into the right Meilisearch filter',
    async ({ filter, meilisearch }) => {
      const { db, searchFn } = makeDb();
      const uuid = insertCollection(filter);

      await db.materializeSmartCollection(uuid);

      expect(searchFn).toHaveBeenCalledTimes(1);
      const [index, request] = searchFn.mock.calls[0] as unknown as [
        string,
        { query: string; filter: SearchFilter },
      ];
      expect(index).toEqual('programs');
      expect(request.query).toEqual('');
      expect(
        MeilisearchService.buildFilterExpression(ProgramsIndex, request.filter),
      ).toEqual(meilisearch);
    },
  );

  test('parses a stored filter once and then serves it from the cache', async () => {
    const { db, parser } = makeDb();
    const parse = vi.spyOn(parser, 'searchExpression');
    const uuid = insertCollection(
      'genres.name in ["Cached Genre"] AND title not in ["Cached Movie"]',
    );

    const first = await db.getById(uuid);
    const second = await db.getById(uuid);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(second?.filter).toEqual(first?.filter);
  });

  test('saves a filter whose fields use index paths as a string it can read back', async () => {
    const { db, warn } = makeDb();
    const filter = {
      type: 'op',
      op: 'or',
      children: [
        {
          type: 'op',
          op: 'and',
          children: [
            {
              type: 'value',
              fieldSpec: {
                key: 'genres.name',
                name: 'genres.name',
                op: 'in',
                type: 'faceted_string',
                value: ['Genre X'],
              },
            },
            {
              type: 'value',
              fieldSpec: {
                key: 'genres.name',
                name: 'genres.name',
                op: 'not in',
                type: 'faceted_string',
                value: ['Genre Y'],
              },
            },
          ],
        },
        {
          type: 'value',
          fieldSpec: {
            key: 'title',
            name: 'title',
            op: 'in',
            type: 'string',
            value: ['Movie A'],
          },
        },
      ],
    } satisfies SearchFilter;

    const saved = (
      await db.insert({ name: 'saved from the API', filter, keywords: '' })
    ).getOrThrow();

    expect(warn).not.toHaveBeenCalled();
    expect(saved.filterString).toEqual(
      '(genre in ["Genre X"] AND genre not in ["Genre Y"]) OR title in ["Movie A"]',
    );
    if (saved.filter === undefined) {
      throw new Error('Expected the saved filter to parse');
    }
    expect(
      MeilisearchService.buildFilterExpression(ProgramsIndex, saved.filter),
    ).toEqual(
      `(genres.name = 'Genre X' AND genres.name != 'Genre Y') OR title = 'Movie A'`,
    );
  });
});
