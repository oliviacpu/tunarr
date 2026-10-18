// LoggerFactory before defaults: defaults imports LoggerFactory, whose module
// calls back into defaults while it initializes.
import { LoggerFactory } from '../util/logging/LoggerFactory.ts';
import { getDefaultDatabaseName } from '../util/defaults.ts';
import type { FileCacheReadResult } from './readIntoFileCache.ts';
import { readIntoFileCache } from './readIntoFileCache.ts';

// A warm-up that finished this recently is trusted to still be in the file
// cache. The burst of channel saves a daily lineup job makes (seven within ten
// seconds) then reads the file once, and the four-hourly guide refresh, which
// comes long after the cache last held it, reads it again.
export const WarmCooldownMs = 10 * 60 * 1000;

/**
 * Reads files into the operating system's file cache (see readIntoFileCache)
 * before a large synchronous read, at most once per cooldown.
 *
 * better-sqlite3 blocks the event loop for every database page it reads, and a
 * file cache that has dropped the database turns each page into a wait on the
 * disk. A full guide refresh reads about 6,000 pages that way; on the shared
 * server, at about 30 ms per read under its disk load, Tunarr stopped answering
 * for up to 219 s and a Live TV viewer's stream ended (2026-10-18). Reading the
 * file in order first uses the libuv thread pool, so the event loop keeps
 * running, and the queries after it find every page in memory.
 *
 * Callers asking while a warm-up runs share it. `warm` never throws: a failed
 * read only means slower queries.
 */
export class DatabaseFileWarmer {
  #inFlight: Promise<FileCacheReadResult | undefined> | undefined;
  #finishedAt: number | undefined;

  constructor(
    private readonly files: () => string[],
    private readonly read: (
      files: string[],
    ) => Promise<FileCacheReadResult> = readIntoFileCache,
    private readonly now: () => number = () => performance.now(),
    private readonly cooldownMs: number = WarmCooldownMs,
  ) {}

  /**
   * Resolves once the files have been read, or at once with undefined when a
   * warm-up finished within the cooldown.
   */
  warm(): Promise<FileCacheReadResult | undefined> {
    if (this.#inFlight !== undefined) {
      return this.#inFlight;
    }
    if (
      this.#finishedAt !== undefined &&
      this.now() - this.#finishedAt < this.cooldownMs
    ) {
      return Promise.resolve(undefined);
    }
    const inFlight = this.readFiles().finally(() => {
      this.#finishedAt = this.now();
      this.#inFlight = undefined;
    });
    this.#inFlight = inFlight;
    return inFlight;
  }

  private async readFiles(): Promise<FileCacheReadResult | undefined> {
    try {
      const result = await this.read(this.files());
      LoggerFactory.child({ className: DatabaseFileWarmer.name }).debug(
        'Read the database into the file cache: %d MB in %d ms',
        Math.round(result.bytes / 1024 / 1024),
        Math.round(result.ms),
      );
      return result;
    } catch (err) {
      LoggerFactory.child({ className: DatabaseFileWarmer.name }).warn(
        err,
        'Could not read the database into the file cache',
      );
      return;
    }
  }
}

/**
 * The warmer for this process's database and its WAL, the files the main
 * connection reads (the same ones bootstrap reads at startup).
 */
export const databaseFileWarmer = new DatabaseFileWarmer(() => {
  const dbPath = getDefaultDatabaseName();
  return [dbPath, `${dbPath}-wal`];
});
