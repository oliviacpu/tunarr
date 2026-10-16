import fs from 'node:fs/promises';

// One reusable buffer per call; big enough for the kernel's readahead to keep
// the disk streaming, small enough not to matter.
const ChunkBytes = 1024 * 1024;

// A very large database is read up to here. Startup still gains from the part
// that was read, and a slow disk never holds startup for long.
export const DefaultMaxBytes = 512 * 1024 * 1024;

export type FileCacheReadResult = {
  bytes: number;
  ms: number;
};

/**
 * Reads the given files once, front to back, and throws the bytes away, so the
 * operating system has them in its file cache.
 *
 * At startup the main thread's SQLite connection starts with an empty page
 * cache, and better-sqlite3 blocks the thread for every page it reads. On a
 * shared server the file cache had dropped the database within the hour, so
 * each of those reads waited on a busy disk: the first start of a release sat
 * at the `/dev/dri` log line for 4 to 7 minutes, in `pread64` on the database
 * with no CPU (2026-10-16). Reading the whole file in order took 0.8 s and the
 * same cold start was ready in 6 s instead of 35 s.
 *
 * Missing files are skipped (a database without a WAL has no `-wal` file), and
 * nothing here ever throws: a failed read only means a slower start.
 */
export async function readIntoFileCache(
  filePaths: string[],
  maxBytes: number = DefaultMaxBytes,
): Promise<FileCacheReadResult> {
  const started = performance.now();
  const buffer = Buffer.allocUnsafe(ChunkBytes);
  let bytes = 0;

  for (const filePath of filePaths) {
    if (bytes >= maxBytes) {
      break;
    }

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch {
      continue;
    }

    try {
      while (bytes < maxBytes) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(ChunkBytes, maxBytes - bytes),
          null,
        );
        if (bytesRead === 0) {
          break;
        }
        bytes += bytesRead;
      }
    } catch {
      // A read error only means a slower start; SQLite reports real problems.
    } finally {
      await handle.close().catch(() => {});
    }
  }

  return { bytes, ms: performance.now() - started };
}
