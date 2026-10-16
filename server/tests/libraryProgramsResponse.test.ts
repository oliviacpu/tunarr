import { ContentProgramSchema } from '@tunarr/types/schemas';
import type { FastifyInstance } from 'fastify';
import { sortBy } from 'lodash-es';
import http from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import z from 'zod/v4';
import { MaterializeProgramsCommand } from '../src/commands/MaterializeProgramsCommand.ts';
import { container } from '../src/container.ts';
import { ProgramConverter } from '../src/db/converters/ProgramConverter.ts';
import type { IProgramDB } from '../src/db/interfaces/IProgramDB.ts';
import { ProgramDB } from '../src/db/ProgramDB.ts';
import { KEYS } from '../src/types/inject.ts';
import { getAvailablePort } from '../src/util/net.ts';
import { seedPrograms, seedShows } from './support/seed.ts';
import { initTestApp } from './testServer.js';

/**
 * `GET /api/media-libraries/:libraryId/programs` builds and sends its body a
 * page at a time so a large library doesn't freeze the server. These pin that
 * body to what the route returned when it loaded, encoded and stringified the
 * whole library in one go: the same items with the same fields. Item order is
 * uuid order now (before, whatever order SQLite returned).
 */
describe('library programs response', () => {
  let app: FastifyInstance;
  let port: number;
  let showsLibraryId: string;
  let moviesLibraryId: string;

  beforeAll(async () => {
    port = await getAvailablePort();
    app = await initTestApp(port);
    // More episodes than one page, so the body spans page boundaries.
    showsLibraryId = (
      await seedShows({ showCount: 6, seasonsPerShow: 3, episodesPerSeason: 9 })
    ).libraryId;
    const [movieId] = await seedPrograms(40);
    const programDB = container.get<IProgramDB>(KEYS.ProgramDB);
    const movie = movieId ? await programDB.getProgramById(movieId) : undefined;
    if (!movie?.libraryId) {
      throw new Error('seeded movie has no library');
    }
    moviesLibraryId = movie.libraryId;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const libraryUrl = (libraryId: string) =>
    `http://127.0.0.1:${port}/api/media-libraries/${libraryId}/programs`;

  /** The page query, failing or waiting from its `n`th call on. */
  function pageQueryFrom(n: number, page: () => Promise<never> | 'wait') {
    const realRead = ProgramDB.prototype.getMediaSourceLibraryProgramsPage;
    let calls = 0;
    let release = () => {};
    const spy = vi
      .spyOn(ProgramDB.prototype, 'getMediaSourceLibraryProgramsPage')
      .mockImplementation(function (this: ProgramDB, ...args) {
        calls++;
        if (calls < n) {
          return realRead.apply(this, args);
        }
        const replacement = page();
        if (replacement !== 'wait') {
          return replacement;
        }
        return new Promise((resolve) => {
          release = () => resolve(realRead.apply(this, args));
        });
      });
    return { spy, release: () => release() };
  }

  /** The response as the route built it before: everything in one go. */
  async function oneShotBody(libraryId: string): Promise<unknown> {
    const programDB = container.get<IProgramDB>(KEYS.ProgramDB);
    const converter = container.get(ProgramConverter);
    const materialized = await container
      .get(MaterializeProgramsCommand)
      .execute(await programDB.getMediaSourceLibraryPrograms(libraryId));
    const encoded = z.safeEncode(
      z.array(ContentProgramSchema),
      materialized.map((p) => converter.materializedProgramToContentProgram(p)),
    );
    if (encoded.error) {
      throw encoded.error;
    }
    return JSON.parse(JSON.stringify(encoded.data));
  }

  test.each([
    ['episodes', () => showsLibraryId],
    ['movies', () => moviesLibraryId],
  ])(
    '%s: the same items and fields as the one-shot response',
    async (_, libraryId) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/media-libraries/${libraryId()}/programs`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      const body: { id: string }[] = res.json();
      const expected = (await oneShotBody(libraryId())) as { id: string }[];

      expect(body.length).toBeGreaterThan(0);
      expect(sortBy(body, 'id')).toEqual(sortBy(expected, 'id'));
      // uuid order
      expect(body.map((p) => p.id)).toEqual(body.map((p) => p.id).sort());
    },
  );

  test('is sent in chunks, without a length up front', async () => {
    const res = await fetch(libraryUrl(showsLibraryId));

    expect(res.status).toBe(200);
    expect(res.headers.get('transfer-encoding')).toBe('chunked');
    expect(res.headers.get('content-length')).toBeNull();
    const body = (await res.json()) as { id: string }[];
    expect(sortBy(body, 'id')).toEqual(
      sortBy((await oneShotBody(showsLibraryId)) as { id: string }[], 'id'),
    );
  });

  test('a failure before the first page is an error response', async () => {
    pageQueryFrom(1, () => Promise.reject(new Error('database is locked')));

    const res = await fetch(libraryUrl(showsLibraryId));

    expect(res.status).toBe(500);
  });

  // The status is already sent: the client must see a broken download, never
  // a shorter list that parses.
  test('a failure after the first page cuts the response off', async () => {
    pageQueryFrom(2, () => Promise.reject(new Error('database is locked')));

    const res = await fetch(libraryUrl(showsLibraryId));

    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });

  test('a client that disconnects stops the page reads', async () => {
    const { spy, release } = pageQueryFrom(2, () => 'wait');

    // node:http rather than fetch: an aborted fetch opens a new connection,
    // which then holds the server open.
    const firstChunk = await new Promise<string>((resolve, reject) => {
      const req = http.get(libraryUrl(showsLibraryId), (res) => {
        res.on('error', () => {});
        res.once('data', (chunk: Buffer) => {
          req.destroy();
          resolve(chunk.toString());
        });
      });
      req.on('error', reject);
    });

    // The first page arrived without waiting for the second, which is held
    expect(firstChunk.startsWith('[{')).toBe(true);

    // Give the server time to see the closed connection, then let the second
    // page finish (if it started). A server still building the body would go
    // on to read a third.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('an unknown library is a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/media-libraries/00000000-0000-0000-0000-000000000000/programs',
    });
    expect(res.statusCode).toBe(404);
  });
});
