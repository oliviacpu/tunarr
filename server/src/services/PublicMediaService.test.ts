import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { anything, instance, mock, when } from 'ts-mockito';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GlobalOptions } from '../globals.ts';
import type { ArtworkResult } from './ArtworkService.ts';
import { ArtworkService } from './ArtworkService.ts';
import {
  formatArtworkVersion,
  nextArtworkVersion,
  PublicMediaService,
  type PublicArtworkRef,
} from './PublicMediaService.ts';

// A 1x1 PNG. Bytes after IEND still read as PNG, which makes a second,
// different picture of the same type.
const Png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
const OtherPng = Buffer.concat([Png, Buffer.from('other')]);

const Day = 24 * 60 * 60 * 1000;
const Start = Date.UTC(2026, 9, 15, 4, 12, 30);

class CountingPublicMediaService extends PublicMediaService {
  loads = 0;

  protected override loadPicture(
    result: Exclude<ArtworkResult, { kind: 'not-found' }>,
    timeoutMs: number,
  ) {
    this.loads++;
    return super.loadPicture(result, timeoutMs);
  }
}

describe('PublicMediaService', () => {
  let dbDir: string;
  let sourceDir: string;
  let results: Map<string, ArtworkResult>;
  let resolves: number;
  let onResolve: (() => void) | undefined;
  let service: CountingPublicMediaService;

  const poster = (id: string): PublicArtworkRef => ({
    id,
    artworkType: 'poster',
  });

  async function source(name: string, bytes: Buffer) {
    const file = path.join(sourceDir, name);
    await fs.writeFile(file, bytes);
    return file;
  }

  async function publishedFile(urlPath: string) {
    const name = urlPath.replace(/^\/media\/artwork\//, '').replace(/\?.*/, '');
    return path.join(dbDir, 'media', 'artwork', name);
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Start);
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-media-'));
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-art-'));
    results = new Map();
    resolves = 0;
    onResolve = undefined;

    const artwork = mock(ArtworkService);
    when(artwork.resolveArtwork(anything(), anything(), anything())).thenCall(
      (id: string) => {
        resolves++;
        onResolve?.();
        return Promise.resolve(results.get(id) ?? { kind: 'not-found' });
      },
    );
    service = new CountingPublicMediaService(instance(artwork), {
      databaseDirectory: dbDir,
    } as GlobalOptions);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dbDir, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  test('publishes a picture as a file whose version is the second it was saved', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });

    const published = await service.publish([poster('show')]);

    const url = published.get('show-poster');
    expect(url).toBe('/media/artwork/show-poster.png?v=20261015041230');
    const file = await publishedFile(url ?? '');
    expect(await fs.readFile(file)).toEqual(Png);
    expect(Math.floor((await fs.stat(file)).mtimeMs / 1000)).toBe(
      Math.floor(Start / 1000),
    );
  });

  test('an unchanged source is not fetched again and keeps its URL', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);

    vi.setSystemTime(Start + Day);
    const second = await service.publish([poster('show')]);

    expect(second.get('show-poster')).toBe(first.get('show-poster'));
    expect(service.loads).toBe(1);
  });

  test('a new source with the same bytes keeps the URL', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);

    vi.setSystemTime(Start + 60_000);
    results.set('show', {
      kind: 'file',
      path: await source('b.png', Png),
      artworkType: 'poster',
    });
    const second = await service.publish([poster('show')]);

    expect(service.loads).toBe(2);
    expect(second.get('show-poster')).toBe(first.get('show-poster'));
  });

  test('new bytes get a new version, one second later even within the same second', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    await service.publish([poster('show')]);

    results.set('show', {
      kind: 'file',
      path: await source('b.png', OtherPng),
      artworkType: 'poster',
    });
    const second = await service.publish([poster('show')]);

    const url = second.get('show-poster');
    expect(url).toBe('/media/artwork/show-poster.png?v=20261015041231');
    expect(await fs.readFile(await publishedFile(url ?? ''))).toEqual(OtherPng);
  });

  test('refreshes an unchanged source after a week, keeping the URL when the bytes match', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);

    vi.setSystemTime(Start + 8 * Day);
    const second = await service.publish([poster('show')]);

    expect(service.loads).toBe(2);
    expect(second.get('show-poster')).toBe(first.get('show-poster'));
  });

  test('never publishes something that is not a raster image', async () => {
    results.set('svg', {
      kind: 'file',
      path: await source(
        'a.svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
        ),
      ),
      artworkType: 'poster',
    });

    const published = await service.publish([poster('svg')]);

    expect(published.has('svg-poster')).toBe(false);
    expect(await fs.readdir(path.join(dbDir, 'media', 'artwork'))).toEqual([]);
  });

  test('a failed fetch is left to the artwork route and not retried for an hour', async () => {
    results.set('show', {
      kind: 'url',
      // Nothing listens on port 9 here, so the connection is refused at once.
      url: 'http://127.0.0.1:9/library/metadata/1/thumb/1',
      headers: { 'X-Plex-Token': 'secret' },
    });

    const first = await service.publish([poster('show')]);
    vi.setSystemTime(Start + 30 * 60 * 1000);
    await service.publish([poster('show')]);

    expect(first.has('show-poster')).toBe(false);
    expect(service.loads).toBe(1);

    vi.setSystemTime(Start + 61 * 60 * 1000);
    await service.publish([poster('show')]);
    expect(service.loads).toBe(2);
  });

  test('a changed picture whose fetch fails keeps the old one, and tries again within the hour', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);
    const oldUrl = first.get('show-poster');

    // The source moves somewhere that fails.
    results.set('show', {
      kind: 'url',
      url: 'http://127.0.0.1:9/library/metadata/1/thumb/2',
    });
    const failed = await service.publish([poster('show')]);
    expect(failed.get('show-poster')).toBe(oldUrl);
    expect(service.loads).toBe(2);

    vi.setSystemTime(Start + 30 * 60 * 1000);
    await service.publish([poster('show')]);
    expect(service.loads).toBe(2);

    vi.setSystemTime(Start + 61 * 60 * 1000);
    await service.publish([poster('show')]);
    expect(service.loads).toBe(3);

    // Another new source is tried at once, and its bytes get a new version.
    results.set('show', {
      kind: 'file',
      path: await source('b.png', OtherPng),
      artworkType: 'poster',
    });
    const fixed = await service.publish([poster('show')]);
    expect(service.loads).toBe(4);
    expect(fixed.get('show-poster')).toBe(
      '/media/artwork/show-poster.png?v=20261015051330',
    );
  });

  test('past the time budget, later pictures skip their lookups and keep the files they have', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) {
      results.set(id, {
        kind: 'file',
        path: await source(`${id}.png`, Png),
        artworkType: 'poster',
      });
    }
    const first = await service.publish(ids.map(poster));
    expect(first.size).toBe(6);

    // Every source changes, and the first lookup of the next write takes
    // longer than the whole budget.
    for (const id of ids) {
      results.set(id, {
        kind: 'file',
        path: await source(`${id}-new.png`, OtherPng),
        artworkType: 'poster',
      });
    }
    resolves = 0;
    onResolve = () => {
      if (resolves === 1) {
        vi.setSystemTime(Date.now() + 61_000);
      }
    };
    const loadsBefore = service.loads;
    const second = await service.publish(ids.map(poster));

    // Only the slow first lookup ran. The others started after it had used up
    // the budget and were skipped. Nothing was fetched, and every picture kept
    // its address.
    expect(resolves).toBe(1);
    expect(service.loads).toBe(loadsBefore);
    expect(second).toEqual(first);
  });

  test('a lost index adopts the file already on disk without changing its URL', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);
    await fs.rm(path.join(dbDir, 'media', 'artwork-index.json'));

    vi.setSystemTime(Start + 5 * 60 * 1000);
    const second = await service.publish([poster('show')]);

    expect(second.get('show-poster')).toBe(first.get('show-poster'));
  });

  test('deletes pictures the guide has not linked to for 30 days', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);
    const file = await publishedFile(first.get('show-poster') ?? '');

    vi.setSystemTime(Start + 29 * Day);
    await service.publish([]);
    expect(await fs.readFile(file)).toEqual(Png);

    vi.setSystemTime(Start + 31 * Day);
    await service.publish([]);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});

describe('artwork versions', () => {
  test('format as YYYYMMDDHHMMSS in UTC', () => {
    expect(formatArtworkVersion(Math.floor(Start / 1000))).toBe(
      '20261015041230',
    );
  });

  test('never repeat or go back', () => {
    const now = Math.floor(Start / 1000);
    expect(nextArtworkVersion(Start, undefined)).toBe(now);
    expect(nextArtworkVersion(Start, now - 10)).toBe(now);
    expect(nextArtworkVersion(Start, now)).toBe(now + 1);
    expect(nextArtworkVersion(Start, now + 5)).toBe(now + 6);
  });
});
