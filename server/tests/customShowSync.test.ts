import type { CustomShow } from '@tunarr/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { container } from '../src/container.ts';
import type { MediaSourceId } from '../src/db/schema/base.ts';
import { MeilisearchService } from '../src/services/MeilisearchService.ts';
import { getAvailablePort } from '../src/util/net.ts';
import type { FakePlex } from './support/fakePlex.ts';
import { startFakePlex } from './support/fakePlex.ts';
import { seedFakePlexSource } from './support/seedPlex.ts';
import { initTestApp } from './testServer.js';

/**
 * Custom shows synced from a Plex playlist, through the API, against a
 * stand-in Plex server.
 */

const PLAYLIST_SIZE = 3;

let app: FastifyInstance;
let plex: FakePlex;
let mediaSourceId: MediaSourceId;

beforeAll(async () => {
  app = await initTestApp(await getAvailablePort());
  plex = await startFakePlex(PLAYLIST_SIZE);
  mediaSourceId = seedFakePlexSource(plex);
  // No search server runs under vitest
  vi.spyOn(container.get(MeilisearchService), 'indexMovie').mockResolvedValue(
    undefined,
  );
});

afterAll(async () => {
  await plex?.close();
  await app?.close();
});

async function createShow(playlistId: string | null) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/custom-shows',
    payload: {
      name: 'Synced playlist',
      programs: [],
      syncMediaSourceId: playlistId === null ? null : mediaSourceId,
      syncMediaSourceType: playlistId === null ? null : 'plex',
      syncExternalPlaylistId: playlistId,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CustomShow>();
}

describe('custom show sync', () => {
  test('creating a synced show syncs it, and returns it synced', async () => {
    const show = await createShow(plex.playlistId);

    expect(show.contentCount).toBe(PLAYLIST_SIZE);
    expect(show.isSyncing).toBe(false);
  });

  test('Sync Now syncs, and returns the synced show', async () => {
    const show = await createShow(null);
    const linked = await app.inject({
      method: 'PUT',
      url: `/api/custom-shows/${show.id}`,
      payload: {
        enableSync: true,
        syncMediaSourceId: mediaSourceId,
        syncMediaSourceType: 'plex',
        syncExternalPlaylistId: plex.playlistId,
      },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json<CustomShow>().contentCount).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: `/api/custom-shows/${show.id}/sync`,
    });

    // The response used to leave out isSyncing, which its schema requires,
    // so a sync that worked answered 500
    expect(res.statusCode).toBe(200);
    const synced = res.json<CustomShow>();
    expect(synced.contentCount).toBe(PLAYLIST_SIZE);
    expect(synced.isSyncing).toBe(false);
    expect(synced.lastSyncedAt).toBeDefined();
  });

  test('a sync that fails is a server error', async () => {
    // Plex has no such playlist
    const show = await createShow('404404');
    expect(show.contentCount).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: `/api/custom-shows/${show.id}/sync`,
    });

    expect(res.statusCode).toBe(500);
  });
});
