import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadSearchMasterKey } from './searchMasterKey.ts';

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-search-key-'));
  file = path.join(directory, 'meilisearch-master-key');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

test('publishes a private key and reuses it on restart and in workers', async () => {
  const first = await loadSearchMasterKey(file, true);
  expect(first.created).toBe(true);
  expect(first.key).toMatch(/^[a-f0-9]{64}$/);
  expect(await fs.readFile(file, 'utf8')).toBe(first.key);
  expect(await loadSearchMasterKey(file, true)).toEqual({
    ...first,
    created: false,
  });
  expect(await loadSearchMasterKey(file, false)).toEqual({
    ...first,
    created: false,
  });
  expect(await fs.readdir(directory)).toEqual(['meilisearch-master-key']);
});

test.skipIf(process.platform === 'win32')(
  'tightens existing permissions without rotating the key',
  async () => {
    const key = 'existing-search-key';
    await fs.writeFile(file, key, { mode: 0o644 });
    expect(await loadSearchMasterKey(file, true)).toEqual({
      key,
      created: false,
    });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  },
);

test('workers do not create or replace a missing or invalid key', async () => {
  await expect(loadSearchMasterKey(file, false)).rejects.toThrow(
    'main thread creates it',
  );
  await fs.writeFile(file, 'short');
  await expect(loadSearchMasterKey(file, false)).rejects.toThrow(
    'main thread creates it',
  );
  expect(await fs.readFile(file, 'utf8')).toBe('short');
});

test('a failed rename leaves the old file intact and removes the temporary file', async () => {
  await fs.writeFile(file, 'short');
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
  await expect(loadSearchMasterKey(file, true)).rejects.toThrow(
    'rename failed',
  );
  expect(await fs.readFile(file, 'utf8')).toBe('short');
  expect(await fs.readdir(directory)).toEqual(['meilisearch-master-key']);
});

test('read failures do not silently rotate a key', async () => {
  vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('read failed'));
  await expect(loadSearchMasterKey(file, true)).rejects.toThrow('read failed');
  expect(await fs.readdir(directory)).toEqual([]);
});
