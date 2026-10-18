import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseFileWarmer, WarmCooldownMs } from './databaseFileWarmer.ts';
import type { FileCacheReadResult } from './readIntoFileCache.ts';
import { readIntoFileCache } from './readIntoFileCache.ts';

function fakeRead() {
  return vi.fn((files: string[]) =>
    Promise.resolve<FileCacheReadResult>({ bytes: files.length, ms: 1 }),
  );
}

describe('DatabaseFileWarmer', () => {
  test('reads the files the provider names', async () => {
    const read = fakeRead();
    const warmer = new DatabaseFileWarmer(() => ['db.db', 'db.db-wal'], read);

    await expect(warmer.warm()).resolves.toEqual({ bytes: 2, ms: 1 });
    expect(read).toHaveBeenCalledWith(['db.db', 'db.db-wal']);
  });

  test('callers asking while a read runs share it', async () => {
    let finish: ((result: FileCacheReadResult) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<FileCacheReadResult>((resolve) => {
          finish = resolve;
        }),
    );
    const warmer = new DatabaseFileWarmer(() => ['db.db'], read);

    const first = warmer.warm();
    const second = warmer.warm();
    if (finish === undefined) {
      throw new Error('the read should have started');
    }
    finish({ bytes: 10, ms: 2 });

    await expect(first).resolves.toEqual({ bytes: 10, ms: 2 });
    await expect(second).resolves.toEqual({ bytes: 10, ms: 2 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('skips a read within the cooldown of the last one, and reads again after it', async () => {
    let now = 1_000;
    const read = fakeRead();
    const warmer = new DatabaseFileWarmer(
      () => ['db.db'],
      read,
      () => now,
    );

    await warmer.warm();
    now += WarmCooldownMs - 1;
    await expect(warmer.warm()).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);

    now += 1;
    await warmer.warm();
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('never throws, and a failed read also waits out the cooldown', async () => {
    const read = vi.fn(() => Promise.reject(new Error('EACCES')));
    const warmer = new DatabaseFileWarmer(
      () => ['db.db'],
      read,
      () => 0,
    );

    await expect(warmer.warm()).resolves.toBeUndefined();
    await expect(warmer.warm()).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('never throws when the files cannot be named', async () => {
    const read = fakeRead();
    const warmer = new DatabaseFileWarmer(() => {
      throw new Error('Accessing global options before they were set!');
    }, read);

    await expect(warmer.warm()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  describe('with the real file read', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-warmer-'));
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    test('leaves the event loop running while it reads', async () => {
      const db = path.join(dir, 'db.db');
      await fs.writeFile(db, Buffer.alloc(16 * 1024 * 1024, 1));
      const warmer = new DatabaseFileWarmer(
        () => [db, `${db}-wal`],
        readIntoFileCache,
      );

      // Count event loop turns while the 16 chunks are read: a synchronous
      // read would hold the loop until it finished, and none would run.
      let turns = 0;
      let reading = true;
      const spin = () => {
        if (reading) {
          turns++;
          setImmediate(spin);
        }
      };
      setImmediate(spin);
      const result = await warmer.warm();
      reading = false;

      expect(result?.bytes).toBe(16 * 1024 * 1024);
      expect(turns).toBeGreaterThan(1);
    });
  });
});
