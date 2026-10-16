import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaSourceId } from '../db/schema/base.ts';
import { QueryError } from '../external/BaseApiClient.ts';
import type { FileSystemService } from '../services/FileSystemService.ts';
import { Result } from '../types/result.ts';
import {
  ExternalSubtitleDownloader,
  missingSubtitleMessage,
} from './ExternalSubtitleDownloader.ts';

const { fakeLogger } = vi.hoisted(() => {
  const fakeLogger = {
    trace: vi.fn(),
    http_out: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => fakeLogger,
  };
  return { fakeLogger };
});

vi.mock('@/util/logging/LoggerFactory.js', () => ({
  LoggerFactory: { child: () => fakeLogger, root: fakeLogger },
}));

const ITEM = {
  externalKey: '4242',
  externalSourceId: 'media-source-1' as MediaSourceId,
  sourceType: 'plex' as const,
  uuid: 'program-1',
  title: 'The Movie',
};

const STREAM = {
  streamIndex: undefined,
  codec: 'srt',
  key: '/library/streams/173516',
};

let cacheFolder: string;
let downloader: ExternalSubtitleDownloader;

beforeEach(async () => {
  vi.clearAllMocks();
  cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-subtitles-'));
  downloader = new ExternalSubtitleDownloader({
    getSubtitleCacheFolder: () => cacheFolder,
  } as FileSystemService);
});

afterEach(async () => {
  await fs.rm(cacheFolder, { recursive: true, force: true });
});

describe('ExternalSubtitleDownloader.downloadSubtitlesIfNecessary', () => {
  test('a subtitle the media server no longer has is one info line, without the error', async () => {
    const result = await downloader.downloadSubtitlesIfNecessary(
      ITEM,
      STREAM,
      () =>
        Promise.resolve(
          Result.failure<string, QueryError>(
            QueryError.create(
              'not_found',
              'Request failed with status code 404',
            ),
          ),
        ),
    );

    expect(result).toBeUndefined();
    expect(fakeLogger.info).toHaveBeenCalledTimes(1);
    expect(fakeLogger.info).toHaveBeenCalledWith(
      'Plex no longer has subtitle stream 173516 for "The Movie" (item 4242); skipped until Plex rescans the item.',
    );
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(fakeLogger.error).not.toHaveBeenCalled();
  });

  test('any other failure is still a warning that carries the error', async () => {
    const error = QueryError.create(
      'generic_request_error',
      'Request failed with status code 500',
    );

    const result = await downloader.downloadSubtitlesIfNecessary(
      ITEM,
      STREAM,
      () => Promise.resolve(Result.failure<string, QueryError>(error)),
    );

    expect(result).toBeUndefined();
    expect(fakeLogger.warn).toHaveBeenCalledTimes(1);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      error,
      'Error while requesting external subtitle stream: %s',
      'Request failed with status code 500',
    );
    expect(fakeLogger.info).not.toHaveBeenCalled();
  });

  test('writes a fetched subtitle to the cache and returns its path', async () => {
    const result = await downloader.downloadSubtitlesIfNecessary(
      ITEM,
      STREAM,
      () => Promise.resolve(Result.success<string, QueryError>('1\nHello\n')),
    );

    expect(result).toBeDefined();
    expect(result?.startsWith(cacheFolder)).toBe(true);
    await expect(fs.readFile(result ?? '', 'utf-8')).resolves.toBe(
      '1\nHello\n',
    );
  });
});

describe('ExternalSubtitleDownloader.fetchToCache', () => {
  const ok = (text: string) => () =>
    Promise.resolve(Result.success<string, QueryError>(text));

  async function cachedCopy(text: string) {
    const first = await downloader.fetchToCache(ITEM, STREAM, ok(text));
    expect(first.type).toBe('written');
    if (first.type !== 'written') {
      throw new Error('no copy written');
    }
    // An old copy: a day ago
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await fs.utimes(first.path, old, old);
    return first.path;
  }

  test('without refresh an existing copy is used as it is, without a fetch', async () => {
    const copy = await cachedCopy('1\nOld\n');
    const fetch = vi.fn(ok('1\nNew\n'));

    const result = await downloader.fetchToCache(ITEM, STREAM, fetch);

    expect(result).toEqual({ type: 'cached', path: copy });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('refresh replaces a copy whose subtitle changed on the media server', async () => {
    const copy = await cachedCopy('1\nOld\n');

    const result = await downloader.fetchToCache(ITEM, STREAM, ok('1\nNew\n'), {
      refresh: true,
    });

    expect(result).toEqual({ type: 'replaced', path: copy });
    await expect(fs.readFile(copy, 'utf-8')).resolves.toBe('1\nNew\n');
    // Written through a temporary file that is gone afterwards
    expect(await fs.readdir(path.dirname(copy))).toEqual([
      path.basename(copy),
    ]);
  });

  test('refresh leaves an unchanged copy alone and restarts its age', async () => {
    const copy = await cachedCopy('1\nSame\n');
    const before = (await fs.stat(copy)).mtimeMs;

    const result = await downloader.fetchToCache(
      ITEM,
      STREAM,
      ok('1\nSame\n'),
      { refresh: true },
    );

    expect(result).toEqual({ type: 'unchanged', path: copy });
    await expect(fs.readFile(copy, 'utf-8')).resolves.toBe('1\nSame\n');
    expect((await fs.stat(copy)).mtimeMs).toBeGreaterThan(
      before + 60 * 60 * 1000,
    );
  });

  test('a failed refresh keeps the old copy', async () => {
    const copy = await cachedCopy('1\nOld\n');

    const result = await downloader.fetchToCache(
      ITEM,
      STREAM,
      () =>
        Promise.resolve(
          Result.failure<string, QueryError>(
            QueryError.create('generic_request_error', 'status code 500'),
          ),
        ),
      { refresh: true },
    );

    expect(result).toEqual({ type: 'failed', path: copy });
    await expect(fs.readFile(copy, 'utf-8')).resolves.toBe('1\nOld\n');
  });

  test('a 404 is returned to the caller, not logged', async () => {
    const result = await downloader.fetchToCache(
      ITEM,
      STREAM,
      () =>
        Promise.resolve(
          Result.failure<string, QueryError>(
            QueryError.create('not_found', 'status code 404'),
          ),
        ),
    );

    expect(result).toEqual({ type: 'not_found' });
    expect(fakeLogger.info).not.toHaveBeenCalled();
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });
});

describe('missingSubtitleMessage', () => {
  test('names a Jellyfin or Emby stream by its index, never the query string', () => {
    expect(
      missingSubtitleMessage(
        { ...ITEM, sourceType: 'jellyfin', externalKey: 'abc' },
        {
          streamIndex: undefined,
          key: '/Videos/abc/abc/Subtitles/3/0/Stream.srt?api_key=secret',
        },
      ),
    ).toBe(
      'Jellyfin no longer has subtitle stream 3 for "The Movie" (item abc); skipped until Jellyfin rescans the item.',
    );
  });

  test('falls back to the stream index when there is no key', () => {
    expect(
      missingSubtitleMessage(
        { ...ITEM, sourceType: 'emby' },
        { streamIndex: 2, key: undefined },
      ),
    ).toBe(
      'Emby no longer has subtitle stream index 2 for "The Movie" (item 4242); skipped until Emby rescans the item.',
    );
  });
});
