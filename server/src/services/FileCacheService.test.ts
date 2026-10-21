import { mkdtemp, mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCacheService } from './FileCacheService.ts';

describe('FileCacheService', () => {
  let directory: string;
  let key: string;
  let cache: FileCacheService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tunarr-file-cache-'));
    key = randomUUID();
    cache = new FileCacheService(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    await cache.deleteCache(key);
  });

  it('clears memory when the disk file has already disappeared', async () => {
    await cache.setCache(key, 'stale');
    await unlink(join(directory, key));

    expect(await cache.deleteCache(key)).toBe(false);
    expect(await cache.getCache(key)).toBeUndefined();
    expect(await cache.exists(key)).toBe(false);
  });

  it('deletes the disk file and memory together', async () => {
    await cache.setCache(key, 'old');

    expect(await cache.deleteCache(key)).toBe(true);
    expect(await cache.getCache(key)).toBeUndefined();
    await expect(readFile(join(directory, key))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('propagates a real unlink failure while clearing stale memory', async () => {
    await cache.setCache(key, 'stale');
    await unlink(join(directory, key));
    await mkdir(join(directory, key));

    await expect(cache.deleteCache(key)).rejects.toThrow();
    expect(await cache.getCache(key)).toBeUndefined();
  });

  it('does not populate memory for a failed disk write', async () => {
    await rm(directory, { recursive: true });

    await expect(cache.setCache(key, 'unpublished')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await cache.getCache(key)).toBeUndefined();
    expect(await cache.exists(key)).toBe(false);
  });
});
