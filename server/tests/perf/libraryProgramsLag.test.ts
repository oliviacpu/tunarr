import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
 * main thread. It now does that a page at a time, yielding in between, and
 * sends each page as it is built.
 *
 * Episodes, not bare movies: each one carries its show's and season's cast,
 * artwork and genres, which is what makes the request heavy. Scale is
 * env-overridable; production's TV library size, and with
 * TUNARR_PERF_CAST=160 its 185 MB body:
 *
 *   TUNARR_PERF_SHOWS=30 TUNARR_PERF_SEASONS=12 TUNARR_PERF_EPISODES=15 \
 *     pnpm vitest run tests/perf/libraryProgramsLag.test.ts --silent=false
 *
 * Longest concurrent-request stall, and the request's own time (MacBook,
 * fetched with `inject`):
 *
 *                                   1,500 episodes     5,400 episodes
 *   whole library in one go         678 ms / 0.7 s     2.6 s / 2.6 s
 *   a page at a time, yielding       28 ms / 1.3 s      39 ms / 5.6 s
 *
 * With the 185 MB body, fetched with curl (3 runs each): pages joined and
 * sent at the end, 74-76 ms; each page sent as it is built, 49-59 ms. On
 * production the join and send had stalled for 0.93 s.
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
const SHOW_CAST = envInt('TUNARR_PERF_CAST', 25);
const SETUP_TIMEOUT_MS = envInt('TUNARR_PERF_SETUP_TIMEOUT_MS', 600_000);
const MAX_ACCEPTABLE_PROBE_MS = envInt('TUNARR_PERF_MAX_PROBE_MS', 250);
const CPU_PROFILE_PATH = process.env['TUNARR_PERF_CPU_PROFILE'];

const PROBE_URL = '/api/xmltv-last-refresh';

const execFileAsync = promisify(execFile);

let app: FastifyInstance;
let port: number;
let libraryId: string;
let episodeCount: number;

beforeAll(async () => {
  // The probe endpoint reads the guide task's schedule, so it must exist.
  port = await getAvailablePort();
  app = await initTestApp(port, {
    registerGuideTask: true,
  });
  const seeded = await seedShows({
    showCount: SHOW_COUNT,
    seasonsPerShow: SEASONS_PER_SHOW,
    episodesPerSeason: EPISODES_PER_SEASON,
    showCastCount: SHOW_CAST,
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

  // Over a real connection, from another process, like the script on
  // production. `inject`, or fetch in this process, would read the body on
  // the event loop being measured: gathering it whole blocks the loop the way
  // production never does.
  test('does not stall concurrent requests', async () => {
    // Memory the server holds for the body at its peak (heap and buffers)
    const memoryNow = () => {
      const { heapUsed, external } = process.memoryUsage();
      return heapUsed + external;
    };
    const memoryBefore = memoryNow();
    let memoryPeak = memoryBefore;
    const memorySampler = setInterval(() => {
      memoryPeak = Math.max(memoryPeak, memoryNow());
    }, 20);

    const started = performance.now();
    const { result, probe, lag } = await measureWithConcurrentProbe({
      app,
      url: PROBE_URL,
      operation: () =>
        withCpuProfile(CPU_PROFILE_PATH, async () => {
          const { stdout } = await execFileAsync('curl', [
            '--silent',
            '--output',
            '/dev/null',
            '--write-out',
            '%{http_code} %{size_download}',
            `http://127.0.0.1:${port}/api/media-libraries/${libraryId}/programs`,
          ]);
          const [status, bytes] = stdout.split(' ').map(Number);
          return { status, bytes: bytes ?? 0 };
        }),
    });
    const elapsedMs = Math.round(performance.now() - started);
    clearInterval(memorySampler);

    expect(result.status).toBe(200);
    expect(probe.failures).toBe(0);

    console.log(
      '[perf] library programs (%d episodes, %d KB) in %d ms, peak +%d MB\n' +
        '       probe: %s\n' +
        '       loop:  %s',
      episodeCount,
      Math.round(result.bytes / 1024),
      elapsedMs,
      Math.round((memoryPeak - memoryBefore) / 2 ** 20),
      formatProbeSummary(probe),
      formatLagSummary(lag),
    );

    expect(probe.maxMs).toBeLessThan(MAX_ACCEPTABLE_PROBE_MS);
  }, 600_000);
});
