import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readIntoFileCache } from './readIntoFileCache.ts';

describe('readIntoFileCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-filecache-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeFile(name: string, bytes: number) {
    const file = path.join(dir, name);
    await fs.writeFile(file, Buffer.alloc(bytes, 1));
    return file;
  }

  test('reads every file to its end, across several chunks', async () => {
    const db = await writeFile('db.db', 3 * 1024 * 1024 + 123);
    const wal = await writeFile('db.db-wal', 4096);

    const result = await readIntoFileCache([db, wal]);

    expect(result.bytes).toBe(3 * 1024 * 1024 + 123 + 4096);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  test('skips a file that does not exist, such as a missing WAL', async () => {
    const db = await writeFile('db.db', 10_000);

    const result = await readIntoFileCache([db, path.join(dir, 'db.db-wal')]);

    expect(result.bytes).toBe(10_000);
  });

  test('stops at the byte limit, across files', async () => {
    const db = await writeFile('db.db', 2 * 1024 * 1024);
    const wal = await writeFile('db.db-wal', 2 * 1024 * 1024);

    expect((await readIntoFileCache([db, wal], 1024 * 1024 + 5)).bytes).toBe(
      1024 * 1024 + 5,
    );
    expect((await readIntoFileCache([db, wal], 3 * 1024 * 1024)).bytes).toBe(
      3 * 1024 * 1024,
    );
  });

  test('never throws: a directory in place of a file is skipped', async () => {
    const db = await writeFile('db.db', 5_000);
    await fs.mkdir(path.join(dir, 'db.db-wal'));

    const result = await readIntoFileCache([db, path.join(dir, 'db.db-wal')]);

    expect(result.bytes).toBe(5_000);
  });
});
