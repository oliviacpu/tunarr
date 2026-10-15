import type { CustomShow } from '@tunarr/types';
import type { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { container } from '../../src/container.ts';
import { MeilisearchService } from '../../src/services/MeilisearchService.ts';
import { formatLagSummary } from '../../src/util/eventLoopLag.ts';
import { getAvailablePort } from '../../src/util/net.ts';
import { withCpuProfile } from '../support/cpuProfile.ts';
import type { FakePlex } from '../support/fakePlex.ts';
import { startFakePlex } from '../support/fakePlex.ts';
import {
  formatProbeSummary,
  measureWithConcurrentProbe,
} from '../support/probe.ts';
import { seedFakePlexSource } from '../support/seedPlex.ts';
import { initTestApp } from '../testServer.js';

/**
 * Measures request stalls while a custom show syncs from a Plex playlist
 * (`POST /api/custom-shows/:id/sync`, which the hourly SyncCustomShowsTask and
 * creating a synced show also run).
 *
 * A sync lists the playlist, then scans each movie on its own: two metadata
 * requests, a lookup, and on the first sync the program's insert. Under vitest
 * it runs on the main thread (vitest has no worker pool), so this measures the
 * in-process path, as with TUNARR_SCAN_IN_WORKER=false, and reports rather
 * than judges it; `pnpm bench:custom-show-sync` measures a real scan worker.
 * The Plex server is a stand-in in its own thread (fakePlexServer.mjs).
 *
 *   TUNARR_LOG_LEVEL=info TUNARR_PERF_PLAYLIST_SIZE=1000 \
 *     pnpm vitest run tests/perf/customShowSyncLag.test.ts --silent=false
 *
 * Longest concurrent-request stall, and how long the main thread was busy
 * (MacBook, 2026-10-15):
 *
 *                       200 movies     1,000 movies     3,000 movies
 *   first sync          25 ms / 1.4 s  186 ms / 7.0 s   874 ms / 24.7 s
 *   unchanged resync    27 ms / 0.6 s  163 ms / 2.8 s   861 ms / 9.2 s
 *
 * The long stall comes at the end of every sync: looking up the playlist's
 * programs (ProgramExternalIdRepository.lookupByExternalIds) loads each one
 * with all its relations, in chunks joined only by microtasks. The rest is
 * thousands of short tasks that keep the main thread busy.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PLAYLIST_SIZE = envInt('TUNARR_PERF_PLAYLIST_SIZE', 200);
const SETUP_TIMEOUT_MS = envInt('TUNARR_PERF_SETUP_TIMEOUT_MS', 600_000);
const CPU_PROFILE_PATH = process.env['TUNARR_PERF_CPU_PROFILE'];

const PROBE_URL = '/api/xmltv-last-refresh';

let app: FastifyInstance;
let plex: FakePlex;
let customShowId: string;

beforeAll(async () => {
  // The probe endpoint reads the guide task's schedule, so it must exist.
  app = await initTestApp(await getAvailablePort(), {
    registerGuideTask: true,
  });
  plex = await startFakePlex(PLAYLIST_SIZE);
  const mediaSourceId = seedFakePlexSource(plex);
  // No search server runs under vitest. Without this, every movie's index
  // call fails and logs a stack trace, which would be measured instead.
  vi.spyOn(container.get(MeilisearchService), 'indexMovie').mockResolvedValue(
    undefined,
  );

  // Created without the sync fields, so creating it doesn't sync it; the
  // sync is the measured part
  const created = await app.inject({
    method: 'POST',
    url: '/api/custom-shows',
    payload: {
      name: 'Bench playlist',
      programs: [],
      syncMediaSourceId: null,
      syncMediaSourceType: null,
      syncExternalPlaylistId: null,
    },
  });
  expect(created.statusCode).toBe(201);
  customShowId = created.json<CustomShow>().id;
  const linked = await app.inject({
    method: 'PUT',
    url: `/api/custom-shows/${customShowId}`,
    payload: {
      enableSync: true,
      syncMediaSourceId: mediaSourceId,
      syncMediaSourceType: 'plex',
      syncExternalPlaylistId: plex.playlistId,
    },
  });
  expect(linked.statusCode).toBe(200);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await plex?.close();
  await app?.close();
});

async function measureSync(label: string) {
  const started = performance.now();
  // How busy this (the main) thread was: the probe's share is small
  const eluBefore = performance.eventLoopUtilization();
  const { result, probe, lag } = await measureWithConcurrentProbe({
    app,
    url: PROBE_URL,
    operation: () =>
      withCpuProfile(
        CPU_PROFILE_PATH === undefined
          ? undefined
          : `${CPU_PROFILE_PATH}.${label.replaceAll(' ', '-')}.cpuprofile`,
        () =>
          app.inject({
            method: 'POST',
            url: `/api/custom-shows/${customShowId}/sync`,
          }),
      ),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const elu = performance.eventLoopUtilization(eluBefore);

  console.log(
    '[perf] custom show sync, %s (%d movies) in %d ms\n' +
      '       probe: %s\n' +
      '       loop:  %s\n' +
      '       main thread busy %d ms (%d%%)',
    label,
    PLAYLIST_SIZE,
    elapsedMs,
    formatProbeSummary(probe),
    formatLagSummary(lag),
    Math.round(elu.active),
    Math.round(elu.utilization * 100),
  );
  expect(result.statusCode).toBe(200);
  expect(probe.failures).toBe(0);
  return result.json<CustomShow>();
}

describe('custom show sync', () => {
  test('first sync imports every movie in the playlist', async () => {
    const show = await measureSync('first sync');
    expect(show.contentCount).toBe(PLAYLIST_SIZE);
  }, 600_000);

  test('a resync of an unchanged playlist keeps every movie', async () => {
    const show = await measureSync('unchanged resync');
    expect(show.contentCount).toBe(PLAYLIST_SIZE);
  }, 600_000);
});
