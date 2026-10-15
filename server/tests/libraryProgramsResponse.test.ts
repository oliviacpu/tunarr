import { ContentProgramSchema } from '@tunarr/types/schemas';
import type { FastifyInstance } from 'fastify';
import { sortBy } from 'lodash-es';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import z from 'zod/v4';
import { MaterializeProgramsCommand } from '../src/commands/MaterializeProgramsCommand.ts';
import { container } from '../src/container.ts';
import { ProgramConverter } from '../src/db/converters/ProgramConverter.ts';
import type { IProgramDB } from '../src/db/interfaces/IProgramDB.ts';
import { KEYS } from '../src/types/inject.ts';
import { getAvailablePort } from '../src/util/net.ts';
import { seedPrograms, seedShows } from './support/seed.ts';
import { initTestApp } from './testServer.js';

/**
 * `GET /api/media-libraries/:libraryId/programs` builds its body a page at a
 * time so a large library doesn't freeze the server. These pin that body to
 * what the route returned when it loaded, encoded and stringified the whole
 * library in one go: the same items with the same fields. Item order is uuid
 * order now (before, whatever order SQLite returned).
 */
describe('library programs response', () => {
  let app: FastifyInstance;
  let showsLibraryId: string;
  let moviesLibraryId: string;

  beforeAll(async () => {
    app = await initTestApp(await getAvailablePort());
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

  test('an unknown library is a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/media-libraries/00000000-0000-0000-0000-000000000000/programs',
    });
    expect(res.statusCode).toBe(404);
  });
});
