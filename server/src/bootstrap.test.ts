import path from 'node:path';
import tmp from 'tmp-promise';
import { bootstrapTunarr } from './bootstrap.ts';
import { DBAccess } from './db/DBAccess.ts';
import { readIntoFileCache } from './db/readIntoFileCache.ts';
import { setGlobalOptionsUnchecked } from './globals.ts';
import { copyPreMigratedDb } from './testing/testDbFactory.ts';

vi.mock('./db/readIntoFileCache.ts', () => ({
  readIntoFileCache: vi.fn(() => Promise.resolve({ bytes: 0, ms: 0 })),
}));

describe('bootstrapTunarr', () => {
  afterEach(() => {
    vi.mocked(readIntoFileCache).mockClear();
  });

  test('reads an existing database and its WAL into the file cache before opening it', async () => {
    const dir = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dir.path);
    const dbPath = path.join(dir.path, 'db.db');
    const opened = vi.spyOn(DBAccess, 'init');

    try {
      await bootstrapTunarr(
        setGlobalOptionsUnchecked({
          database: dir.path,
          log_level: 'error',
          verbose: 0,
        }),
      );

      expect(readIntoFileCache).toHaveBeenCalledTimes(1);
      expect(readIntoFileCache).toHaveBeenCalledWith([dbPath, `${dbPath}-wal`]);
      expect(
        vi.mocked(readIntoFileCache).mock.invocationCallOrder[0],
      ).toBeLessThan(opened.mock.invocationCallOrder[0] ?? 0);
    } finally {
      opened.mockRestore();
      await DBAccess.instance.closeConnection(dbPath);
      await dir.cleanup();
    }
  });

  test('a new install has nothing to read', async () => {
    const dir = await tmp.dir({ unsafeCleanup: true });
    const databaseDirectory = path.join(dir.path, 'new');

    try {
      await bootstrapTunarr(
        setGlobalOptionsUnchecked({
          database: databaseDirectory,
          log_level: 'error',
          verbose: 0,
        }),
      );

      expect(readIntoFileCache).not.toHaveBeenCalled();
    } finally {
      await DBAccess.instance.closeConnection(
        path.join(databaseDirectory, 'db.db'),
      );
      await dir.cleanup();
    }
  });
});
