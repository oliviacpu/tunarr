import fs, { mkdtemp, mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instance, mock, when } from 'ts-mockito';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import { FileCacheService } from './FileCacheService.ts';
import { M3uService } from './M3UService.ts';

describe('M3uService checked cache regeneration', () => {
  let directory: string;
  let cacheDirectory: string;
  let cache: FileCacheService;
  let service: M3uService;
  let getAllChannels: ReturnType<typeof vi.fn<IChannelDB['getAllChannels']>>;
  const key = 'channels.m3u';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tunarr-m3u-'));
    cacheDirectory = join(directory, 'cache');
    await mkdir(cacheDirectory);
    setGlobalOptionsUnchecked({
      database: directory,
      log_level: 'error',
      verbose: 0,
    });
    cache = new FileCacheService(cacheDirectory);
    getAllChannels = vi
      .fn<IChannelDB['getAllChannels']>()
      .mockResolvedValue([]);
    const channelDB = mock<IChannelDB>();
    when(channelDB.getAllChannels()).thenCall(() => getAllChannels());
    service = new M3uService(instance(channelDB));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
    await cache.deleteCache(key);
  });

  it('rebuilds disk and memory after the old disk file disappeared', async () => {
    await cache.setCache(key, 'stale playlist');
    await unlink(join(cacheDirectory, key));

    await service.regenerateCacheChecked();

    expect(getAllChannels).toHaveBeenCalledTimes(1);
    const written = await readFile(join(cacheDirectory, key), 'utf8');
    expect(written).toContain('#EXTM3U');
    expect(written).toContain('{{host}}/setup');
    expect(await cache.getCache(key)).toBe(written);
    expect(await service.getChannelsM3U('http://localhost:8000')).toContain(
      'http://localhost:8000/setup',
    );
    expect(getAllChannels).toHaveBeenCalledTimes(1);
  });

  it('propagates a build failure and permits a later successful refresh', async () => {
    await cache.setCache(key, 'stale playlist');
    getAllChannels.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.regenerateCacheChecked()).rejects.toThrow(
      'database unavailable',
    );
    expect(await cache.getCache(key)).toBeUndefined();
    await service.regenerateCacheChecked();
    expect(await cache.getCache(key)).toContain('#EXTM3U');
  });

  it('propagates a real write failure without caching an unpublished playlist', async () => {
    await rm(cacheDirectory, { recursive: true });

    await expect(service.regenerateCacheChecked()).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await cache.getCache(key)).toBeUndefined();
  });

  it('propagates a real deletion failure without returning stale memory', async () => {
    await cache.setCache(key, 'stale playlist');
    await unlink(join(cacheDirectory, key));
    await mkdir(join(cacheDirectory, key));

    await expect(service.regenerateCacheChecked()).rejects.toThrow();
    expect(getAllChannels).not.toHaveBeenCalled();
    expect(await cache.getCache(key)).toBeUndefined();
  });

  it('rebuilds after a partial write fails instead of serving damaged bytes', async () => {
    await cache.setCache(key, 'old playlist');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(
      async (filePath, flags, mode) => {
        const handle = await open(filePath, flags, mode);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await handle.write('partial playlist');
          throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
        });
        return handle;
      },
    );

    await expect(service.regenerateCacheChecked()).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(await fs.readdir(cacheDirectory)).toEqual([]);
    expect(await cache.getCache(key)).toBeUndefined();
    const playlist = await service.getChannelsM3U('http://localhost:8000');
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('http://localhost:8000/setup');
    expect(playlist).not.toContain('partial playlist');
    expect(getAllChannels).toHaveBeenCalledTimes(2);
  });

  it('preserves the legacy regeneration write-error behavior', async () => {
    await rm(cacheDirectory, { recursive: true });

    await expect(service.regenerateCache()).resolves.toBeUndefined();
    expect(getAllChannels).toHaveBeenCalledTimes(1);
  });
});
