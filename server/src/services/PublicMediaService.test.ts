import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { anything, instance, mock, when } from 'ts-mockito';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GlobalOptions } from '../globals.ts';
import type { ArtworkResult } from './ArtworkService.ts';
import { ArtworkService } from './ArtworkService.ts';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  describeLoadError,
  publishedArtworkFile,
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
const ThirdPng = Buffer.concat([Png, Buffer.from('third')]);
// A 1x1 GIF.
const Gif = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

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

  /** Where the server finds the file for a published URL. */
  function publishedFile(urlPath: string) {
    const url = new URL(urlPath, 'http://localhost');
    const file = publishedArtworkFile(
      url.pathname.replace(/^\/media\/artwork\//, ''),
      url.searchParams.get('v') ?? undefined,
    );
    if (file === undefined) {
      throw new Error(`Not a published URL: ${urlPath}`);
    }
    return path.join(dbDir, 'media', 'artwork', file);
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

  test('lists the artwork directory at most twice for a batch of new pictures', async () => {
    const picture = await source('batch.png', Png);
    const refs = Array.from({ length: 100 }, (_, i) => poster(`batch-${i}`));
    for (let i = 0; i < 100; i++)
      results.set(`batch-${i}`, {
        kind: 'file',
        path: picture,
        artworkType: 'poster',
      });
    const listing = vi.spyOn(fs, 'readdir');
    try {
      expect((await service.publish(refs)).size).toBe(100);
      expect(
        listing.mock.calls.filter(
          ([dir]) => dir === path.join(dbDir, 'media', 'artwork'),
        ).length,
      ).toBeLessThanOrEqual(2);
    } finally {
      listing.mockRestore();
    }
  });

  test('cleans abandoned temporary files without removing recent writes', async () => {
    const media = path.join(dbDir, 'media');
    await fs.mkdir(media);
    const old = path.join(media, '.11111111-1111-1111-1111-111111111111.tmp');
    const recent = path.join(
      media,
      '.22222222-2222-2222-2222-222222222222.tmp',
    );
    await fs.writeFile(old, 'old');
    await fs.writeFile(recent, 'recent');
    await fs.utimes(
      old,
      new Date(Start - 2 * 60 * 60 * 1000),
      new Date(Start - 2 * 60 * 60 * 1000),
    );
    await fs.utimes(recent, new Date(Start), new Date(Start));
    await service.publish([]);
    await expect(fs.stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(recent, 'utf8')).toBe('recent');
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
    const file = publishedFile(url ?? '');
    expect(path.basename(file)).toBe('show-poster.20261015041230.png');
    expect(await fs.readFile(file)).toEqual(Png);
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
    expect(await fs.readFile(publishedFile(url ?? ''))).toEqual(OtherPng);
    // The earlier URL still serves the bytes it was published with.
    expect(
      await fs.readFile(
        publishedFile('/media/artwork/show-poster.png?v=20261015041230'),
      ),
    ).toEqual(Png);
  });

  test('a change after changing back gets a version above every earlier one', async () => {
    const publishBytes = async (name: string, bytes: Buffer) => {
      results.set('show', {
        kind: 'file',
        path: await source(name, bytes),
        artworkType: 'poster',
      });
      return (await service.publish([poster('show')])).get('show-poster');
    };

    // A, B, A again and C, all within one second.
    const a = await publishBytes('a.png', Png);
    const b = await publishBytes('b.png', OtherPng);
    const aAgain = await publishBytes('a2.png', Png);
    const c = await publishBytes('c.png', ThirdPng);

    expect(a).toBe('/media/artwork/show-poster.png?v=20261015041230');
    expect(b).toBe('/media/artwork/show-poster.png?v=20261015041231');
    expect(aAgain).toBe(a);
    expect(c).toBe('/media/artwork/show-poster.png?v=20261015041232');
    expect(await fs.readFile(publishedFile(b ?? ''))).toEqual(OtherPng);
    expect(await fs.readFile(publishedFile(c ?? ''))).toEqual(ThirdPng);
  });

  test('refreshes that keep failing wait a week, so the others get their turn', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `p${i}`);
    for (const id of ids) {
      results.set(id, {
        kind: 'file',
        path: await source(`${id}.png`, Png),
        artworkType: 'poster',
      });
    }
    const refs = ids.map((id) => ({ ...poster(id), sourceHint: `hint:${id}` }));
    await service.publish(refs);

    // A week on, the first 20 can't be reached, and their source hasn't
    // changed, so each is only a due refresh.
    for (const id of ids.slice(0, 20)) {
      results.set(id, {
        kind: 'url',
        url: `http://127.0.0.1:9/library/metadata/${id}/thumb/1`,
      });
    }
    vi.setSystemTime(Start + 8 * Day);
    const before = service.loads;
    await service.publish(refs);
    expect(service.loads - before).toBe(20);

    // The next write, four hours later, refreshes the one left out.
    vi.setSystemTime(Start + 8 * Day + 4 * 60 * 60 * 1000);
    const next = service.loads;
    resolves = 0;
    await service.publish(refs);
    expect(service.loads - next).toBe(1);
    expect(resolves).toBe(1);
  });

  test('a replaced version is kept for 30 days, then deleted', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);
    const oldFile = publishedFile(first.get('show-poster') ?? '');

    vi.setSystemTime(Start + Day);
    results.set('show', {
      kind: 'file',
      path: await source('b.png', OtherPng),
      artworkType: 'poster',
    });
    const second = await service.publish([poster('show')]);
    const newFile = publishedFile(second.get('show-poster') ?? '');

    vi.setSystemTime(Start + 30 * Day);
    await service.publish([poster('show')]);
    expect(await fs.readFile(oldFile)).toEqual(Png);

    vi.setSystemTime(Start + 32 * Day);
    await service.publish([poster('show')]);
    await expect(fs.stat(oldFile)).rejects.toThrow();
    expect(await fs.readFile(newFile)).toEqual(OtherPng);
  });

  test('a picture in a new format keeps the old format at its old URL', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const first = await service.publish([poster('show')]);

    results.set('show', {
      kind: 'file',
      path: await source('b.gif', Gif),
      artworkType: 'poster',
    });
    const second = await service.publish([poster('show')]);

    expect(second.get('show-poster')).toBe(
      '/media/artwork/show-poster.gif?v=20261015041231',
    );
    expect(
      await fs.readFile(publishedFile(first.get('show-poster') ?? '')),
    ).toEqual(Png);
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

    // The four running at once had started before the budget ran out and were
    // looked up; the last two started after and weren't. Nothing was fetched,
    // and every picture kept its address.
    expect(resolves).toBe(4);
    expect(service.loads).toBe(loadsBefore);
    expect(second).toEqual(first);
  });

  test('a source hint that matches what was published skips the lookup', async () => {
    results.set('show', {
      kind: 'file',
      path: await source('a.png', Png),
      artworkType: 'poster',
    });
    const ref = { ...poster('show'), sourceHint: 'cache:aa/bb/a.png' };
    const first = await service.publish([ref]);
    expect(resolves).toBe(1);

    const second = await service.publish([ref]);
    expect(resolves).toBe(1);
    expect(second).toEqual(first);

    // A different hint means the source changed, so it is looked up again.
    results.set('show', {
      kind: 'file',
      path: await source('b.png', OtherPng),
      artworkType: 'poster',
    });
    const third = await service.publish([
      { ...ref, sourceHint: 'cache:cc/dd/b.png' },
    ]);
    expect(resolves).toBe(2);
    expect(third.get('show-poster')).toBe(
      '/media/artwork/show-poster.png?v=20261015041231',
    );
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
    const file = publishedFile(first.get('show-poster') ?? '');

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

describe('describeLoadError', () => {
  test('names the failure without the request or its headers', () => {
    const config = {
      headers: new AxiosHeaders({ 'X-Plex-Token': 'secret-token' }),
    };
    const refused = new AxiosError(
      'connect ECONNREFUSED 127.0.0.1:32400',
      'ECONNREFUSED',
      config,
    );
    expect(describeLoadError(refused)).toBe('ECONNREFUSED');

    const notFound = new AxiosError(
      'Request failed',
      'ERR_BAD_REQUEST',
      config,
      {},
      {
        status: 404,
        statusText: 'Not Found',
        data: undefined,
        headers: {},
        config,
      },
    );
    expect(describeLoadError(notFound)).toBe('HTTP 404');
    expect(describeLoadError(new Error('disk full'))).toBe('disk full');
  });
});

describe('publishedArtworkFile', () => {
  test('maps a published URL to the file for its version', () => {
    expect(publishedArtworkFile('abc-poster.jpg', '20261015041230')).toBe(
      'abc-poster.20261015041230.jpg',
    );
  });

  test('refuses anything else', () => {
    expect(publishedArtworkFile('abc-poster.jpg', undefined)).toBeUndefined();
    expect(publishedArtworkFile('abc-poster.jpg', '2026')).toBeUndefined();
    expect(
      publishedArtworkFile('abc-poster.jpg', ['20261015041230']),
    ).toBeUndefined();
    expect(
      publishedArtworkFile('../media/x.jpg', '20261015041230'),
    ).toBeUndefined();
    expect(publishedArtworkFile('abc.svg', '20261015041230')).toBeUndefined();
    expect(
      publishedArtworkFile('abc-poster.20261015041230.jpg', '20261015041230'),
    ).toBeUndefined();
  });
});
