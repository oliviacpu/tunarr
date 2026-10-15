import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { formatLagSummary } from '../../src/util/eventLoopLag.ts';
import { getAvailablePort } from '../../src/util/net.ts';
import { withCpuProfile } from '../support/cpuProfile.ts';
import {
  formatProbeSummary,
  measureWithConcurrentProbe,
} from '../support/probe.ts';
import { seedShows } from '../support/seed.ts';
import { initTestApp } from '../testServer.js';

/**
 * Measures request stalls while a client fetches a whole library's programs
 * (`GET /api/media-libraries/:libraryId/programs`).
 *
 * On 2026-10-15 a script fetching the 5,393-episode TV library this way froze
 * production for about 17 s at a time and paused Live TV. The handler loaded,
 * converted, Zod-encoded and stringified the whole library in one go on the
 * main thread. It now does that a page at a time, yielding in between.
 *
 * Episodes, not bare movies: each one carries its show's and season's cast,
 * artwork and genres, which is what makes the request heavy. Scale is
 * env-overridable; production's TV library size:
 *
 *   TUNARR_PERF_SHOWS=30 TUNARR_PERF_SEASONS=12 TUNARR_PERF_EPISODES=15 \
 *     pnpm vitest run tests/perf/libraryProgramsLag.test.ts --silent=false
 *
 * Longest concurrent-request stall, and the request's own time (MacBook):
 *
 *                                   1,500 episodes     5,400 episodes
 *   whole library in one go         678 ms / 0.7 s     2.6 s / 2.6 s
 *   a page at a time, yielding       28 ms / 1.3 s      39 ms / 5.6 s
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SHOW_COUNT = envInt('TUNARR_PERF_SHOWS', 25);
const SEASONS_PER_SHOW = envInt('TUNARR_PERF_SEASONS', 4);
const EPISODES_PER_SEASON = envInt('TUNARR_PERF_EPISODES', 15);
const SETUP_TIMEOUT_MS = envInt('TUNARR_PERF_SETUP_TIMEOUT_MS', 600_000);
const MAX_ACCEPTABLE_PROBE_MS = envInt('TUNARR_PERF_MAX_PROBE_MS', 250);
const CPU_PROFILE_PATH = process.env['TUNARR_PERF_CPU_PROFILE'];

const PROBE_URL = '/api/xmltv-last-refresh';

let app: FastifyInstance;
let libraryId: string;
let episodeCount: number;

beforeAll(async () => {
  // The probe endpoint reads the guide task's schedule, so it must exist.
  app = await initTestApp(await getAvailablePort(), {
    registerGuideTask: true,
  });
  const seeded = await seedShows({
    showCount: SHOW_COUNT,
    seasonsPerShow: SEASONS_PER_SHOW,
    episodesPerSeason: EPISODES_PER_SEASON,
  });
  libraryId = seeded.libraryId;
  episodeCount = seeded.episodeIds.length;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
});

describe('library programs request', () => {
  test('returns every episode in the library', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/media-libraries/${libraryId}/programs`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toHaveLength(episodeCount);
  }, 300_000);

  test('does not stall concurrent requests', async () => {
    const started = performance.now();
    const { result, probe, lag } = await measureWithConcurrentProbe({
      app,
      url: PROBE_URL,
      operation: () =>
        withCpuProfile(CPU_PROFILE_PATH, () =>
          app.inject({
            method: 'GET',
            url: `/api/media-libraries/${libraryId}/programs`,
          }),
        ),
    });
    const elapsedMs = Math.round(performance.now() - started);

    expect(result.statusCode).toBe(200);
    expect(probe.failures).toBe(0);

    console.log(
      '[perf] library programs (%d episodes, %d KB) in %d ms\n' +
        '       probe: %s\n' +
        '       loop:  %s',
      episodeCount,
      Math.round(result.body.length / 1024),
      elapsedMs,
      formatProbeSummary(probe),
      formatLagSummary(lag),
    );

    expect(probe.maxMs).toBeLessThan(MAX_ACCEPTABLE_PROBE_MS);
  }, 600_000);
});
