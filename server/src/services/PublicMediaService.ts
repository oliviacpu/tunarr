import type { ArtworkType } from '@/db/schema/Artwork.js';
import { Mutex } from 'async-mutex';
import axios, { isAxiosError } from 'axios';
import { fileTypeFromBuffer } from 'file-type';
import { inject, injectable } from 'inversify';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
import { z } from 'zod';
import type { GlobalOptions } from '../globals.ts';
import { KEYS } from '../types/inject.ts';
import {
  PublicArtworkFolderName,
  PublicMediaFolderName,
} from '../util/constants.ts';
import type { Maybe } from '../types/util.ts';
import { caughtErrorToError } from '../util/index.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import throttle from '../util/throttle.ts';
import { ArtworkService, type ArtworkResult } from './ArtworkService.ts';

/** Where published guide pictures are served from. No login needed. */
export const PublicArtworkPathPrefix = '/media/artwork/';

const IndexFileName = 'artwork-index.json';

/** A picture the guide links to: what `/api/programs/<id>/artwork/<type>` serves. */
export type PublicArtworkRef = {
  id: string;
  artworkType: ArtworkType;
  /**
   * What the picture comes from, as the caller already knows it, such as the
   * artwork row's cache or source path. When it matches what was published,
   * the picture is reused without looking anything up.
   */
  sourceHint?: string;
};

/** Published URL paths (no host) by `publicArtworkKey`. */
export type PublishedArtwork = ReadonlyMap<string, string>;

export function publicArtworkKey(ref: PublicArtworkRef): string {
  return `${ref.id}-${ref.artworkType}`;
}

/**
 * A version is the second the picture's bytes were saved, written as
 * `YYYYMMDDHHMMSS` in UTC, so a URL tells when its picture last changed.
 */
export function formatArtworkVersion(epochSeconds: number): string {
  return new Date(epochSeconds * 1000)
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);
}

/**
 * The second to stamp new bytes with. Never at or before the previous version,
 * so two changes within one second still get different URLs.
 */
export function nextArtworkVersion(
  nowMs: number,
  previous: Maybe<number>,
): number {
  const now = Math.floor(nowMs / 1000);
  return previous !== undefined && previous >= now ? previous + 1 : now;
}

/** `YYYYMMDDHHMMSS` back to seconds since the epoch. */
function parseArtworkVersion(version: string): number {
  const [y, mo, d, h, mi, se] = [0, 4, 6, 8, 10, 12].map((start, i) =>
    Number(version.slice(start, start + (i === 0 ? 4 : 2))),
  );
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d, h, mi, se) / 1000;
}

const PublicNamePattern = /^([0-9A-Za-z_-]+)\.(jpg|png|webp|gif|avif)$/;
const VersionPattern = /^\d{14}$/;
const DiskNamePattern = /^([0-9A-Za-z_-]+)\.(\d{14})\.(jpg|png|webp|gif|avif)$/;

/**
 * The file holding `/media/artwork/<name>?v=<version>`. Each version is its own
 * file, so a URL keeps serving the bytes it was published with even after the
 * picture changes. Undefined for a malformed request.
 */
export function publishedArtworkFile(
  name: string,
  version: unknown,
): Maybe<string> {
  const match = PublicNamePattern.exec(name);
  if (!match || typeof version !== 'string' || !VersionPattern.test(version)) {
    return undefined;
  }
  return `${match[1]}.${version}.${match[2]}`;
}

function diskFileName(key: string, version: number, extension: string) {
  return `${key}.${formatArtworkVersion(version)}.${extension}`;
}

// Raster formats only. An SVG served from Tunarr's own origin could run script
// there, so it is never published.
const PublishableExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const MaxPictureBytes = 25 * 1024 * 1024;
const FetchTimeoutMs = 10_000;
const Concurrency = 4;
// Bounds how long one guide write waits on pictures. Whatever isn't done by
// then keeps its dynamic URL and is published on a later write.
const PublishBudgetMs = 60_000;
// A picture is fetched again after this long even when its source path is
// unchanged, because some sources (derived Plex paths, Jellyfin, Emby) carry
// no version of their own.
const RefreshAfterMs = 7 * 24 * 60 * 60 * 1000;
// At most this many such refreshes per write, so they spread out instead of
// all coming due on the same write.
const MaxRefreshesPerRun = 20;
const RetryFailedAfterMs = 60 * 60 * 1000;
const ForgetUnreferencedAfterMs = 30 * 24 * 60 * 60 * 1000;
const ReferencedResolutionMs = 60 * 60 * 1000;

const IndexEntrySchema = z.object({
  file: z.string(),
  sourceKey: z.string(),
  sha256: z.string(),
  version: z.number().int(),
  fetchedAt: z.number(),
  referencedAt: z.number(),
  // The last failed fetch and the source it tried. `sourceKey` always
  // describes the bytes on disk, so a failed new source never stands in for
  // them.
  failedAt: z.number().optional(),
  failedSourceKey: z.string().optional(),
  // Earlier versions, kept so their URLs keep working until the cleanup.
  retired: z.array(z.object({ file: z.string(), at: z.number() })).default([]),
});

type IndexEntry = z.infer<typeof IndexEntrySchema>;

const IndexSchema = z.object({
  entries: z.record(z.string(), IndexEntrySchema),
});

type Index = z.infer<typeof IndexSchema>;

const lock = new Mutex();

/**
 * Keeps the pictures the XMLTV guide links to as plain files in a public
 * folder, each URL carrying the second its bytes were saved.
 *
 * Plex's apps load guide pictures themselves and cache them by URL. Served
 * from the artwork routes, every load was proxied from the media server again,
 * and a replaced picture kept its URL, so apps went on showing the old one.
 * A published picture is a static file with a year-long immutable cache, and
 * its URL changes exactly when its bytes do.
 */
@injectable()
export class PublicMediaService {
  @InjectLogger() declare private readonly logger: Logger;

  constructor(
    @inject(ArtworkService) private artworkService: ArtworkService,
    @inject(KEYS.GlobalOptions) private globalOpts: GlobalOptions,
  ) {}

  get artworkDirectory(): string {
    return path.join(
      this.globalOpts.databaseDirectory,
      PublicMediaFolderName,
      PublicArtworkFolderName,
    );
  }

  private get mediaDirectory(): string {
    return path.join(this.globalOpts.databaseDirectory, PublicMediaFolderName);
  }

  private get indexPath(): string {
    return path.join(this.mediaDirectory, IndexFileName);
  }

  /**
   * Publishes each picture and returns the URL path of every one that is
   * available, such as `/media/artwork/<id>-poster.jpg?v=20261015041230`.
   * A picture that can't be published is left out, and its caller keeps
   * linking to the artwork route.
   */
  async publish(refs: PublicArtworkRef[]): Promise<PublishedArtwork> {
    return await lock.runExclusive(() => this.publishInternal(refs));
  }

  private async publishInternal(
    refs: PublicArtworkRef[],
  ): Promise<PublishedArtwork> {
    const published = new Map<string, string>();
    const unique = new Map<string, PublicArtworkRef>();
    for (const ref of refs) {
      unique.set(publicArtworkKey(ref), ref);
    }

    await fs.mkdir(this.artworkDirectory, { recursive: true });
    const { index, loaded: indexLoaded } = await this.loadIndex();
    const startedAt = Date.now();
    const run = {
      deadline: startedAt + PublishBudgetMs,
      refreshesLeft: MaxRefreshesPerRun,
      changed: false,
    };

    const queue = new PQueue({ concurrency: Concurrency });
    for (const [key, ref] of unique) {
      void queue.add(async () => {
        // A picture that needs no I/O resolves in microtasks alone, and
        // thousands in a row would hold the event loop. Let requests in.
        await throttle();
        try {
          // Past the budget, a picture costs no lookups or fetches: it keeps
          // the file it already has, or the artwork route.
          const entry =
            Date.now() >= run.deadline
              ? await this.alreadyPublished(index.entries[key])
              : await this.publishOne(key, ref, index, run);
          if (entry) {
            published.set(key, this.urlPath(entry));
            if (Date.now() - entry.referencedAt >= ReferencedResolutionMs) {
              entry.referencedAt = Date.now();
              run.changed = true;
            }
          }
        } catch (e) {
          this.logger.warn(
            'Could not publish guide picture %s: %s',
            key,
            caughtErrorToError(e).message,
          );
        }
      });
    }
    await queue.onIdle();

    if (await this.collectGarbage(index, indexLoaded)) {
      run.changed = true;
    }
    if (run.changed) {
      await this.saveIndex(index);
    }

    this.logger.debug(
      'Published %d of %d guide pictures in %dms',
      published.size,
      unique.size,
      Date.now() - startedAt,
    );
    return published;
  }

  private async publishOne(
    key: string,
    ref: PublicArtworkRef,
    index: Index,
    run: { deadline: number; refreshesLeft: number; changed: boolean },
  ): Promise<Maybe<IndexEntry>> {
    const existing = index.entries[key];
    const current = await this.alreadyPublished(existing);

    // Known up front, an unchanged source needs no lookup at all.
    if (ref.sourceHint !== undefined) {
      const reuse = this.reusable(existing, current, ref.sourceHint, run);
      if (reuse.reuse) {
        return reuse.entry;
      }
    }

    const result = await this.artworkService.resolveArtwork(
      ref.id,
      'program',
      ref.artworkType,
    );
    if (result.kind === 'not-found') {
      return;
    }

    const sourceKey = ref.sourceHint ?? (await this.sourceKey(result));
    if (ref.sourceHint === undefined) {
      const reuse = this.reusable(existing, current, sourceKey, run);
      if (reuse.reuse) {
        return reuse.entry;
      }
    }

    const now = Date.now();
    if (now >= run.deadline) {
      return current;
    }

    const loaded = await this.loadPicture(
      result,
      Math.min(FetchTimeoutMs, run.deadline - now),
    ).catch((e: unknown) => {
      // Never the error itself: an HTTP client error carries the request's
      // headers, credential included.
      this.logger.debug(
        'Could not load guide picture %s from %s: %s',
        key,
        result.kind === 'url' ? result.url : result.path,
        describeLoadError(e),
      );
      return undefined;
    });
    if (!loaded) {
      index.entries[key] = {
        ...(existing ?? {
          file: '',
          sourceKey: '',
          sha256: '',
          version: 0,
          fetchedAt: 0,
          referencedAt: now,
          retired: [],
        }),
        failedAt: now,
        failedSourceKey: sourceKey,
      };
      run.changed = true;
      return current;
    }

    const sha256 = createHash('sha256').update(loaded.bytes).digest('hex');
    if (
      current &&
      current.sha256 === sha256 &&
      current.file.endsWith(`.${loaded.extension}`)
    ) {
      const entry: IndexEntry = {
        ...current,
        sourceKey,
        fetchedAt: now,
        failedAt: undefined,
        failedSourceKey: undefined,
      };
      index.entries[key] = entry;
      run.changed = true;
      return entry;
    }

    let file: string;
    let version: number;
    const adopted = await this.adoptExistingFile(key, loaded.extension, sha256);
    if (adopted) {
      ({ file, version } = adopted);
    } else {
      version = nextArtworkVersion(
        now,
        existing && existing.version > 0 ? existing.version : undefined,
      );
      file = diskFileName(key, version, loaded.extension);
      await this.writeAtomically(file, loaded.bytes);
    }

    // The version it replaces stays, so its URL keeps its bytes.
    const retired = (existing?.retired ?? []).filter((r) => r.file !== file);
    if (current && current.file !== file) {
      retired.push({ file: current.file, at: now });
    }

    const entry: IndexEntry = {
      file,
      sourceKey,
      sha256,
      version,
      fetchedAt: now,
      referencedAt: now,
      retired,
    };
    index.entries[key] = entry;
    run.changed = true;
    return entry;
  }

  /**
   * A version already on disk holding these bytes, newest first, so a lost
   * index or a picture that changes back doesn't get a new URL.
   */
  private async adoptExistingFile(
    key: string,
    extension: string,
    sha256: string,
  ): Promise<Maybe<{ file: string; version: number }>> {
    const candidates = (await fs.readdir(this.artworkDirectory))
      .map((file) => ({ file, match: DiskNamePattern.exec(file) }))
      .filter(({ match }) => match?.[1] === key && match[3] === extension)
      .sort((a, b) => b.file.localeCompare(a.file));
    for (const { file, match } of candidates) {
      const bytes = await fs
        .readFile(path.join(this.artworkDirectory, file))
        .catch(() => undefined);
      if (
        match?.[2] !== undefined &&
        bytes !== undefined &&
        createHash('sha256').update(bytes).digest('hex') === sha256
      ) {
        return { file, version: parseArtworkVersion(match[2]) };
      }
    }
    return undefined;
  }

  /** What the picture comes from. A different key means it may have changed. */
  private async sourceKey(
    result: Exclude<ArtworkResult, { kind: 'not-found' }>,
  ): Promise<string> {
    if (result.kind === 'url') {
      // Plex paths end in Plex's own timestamp for the image. The credential
      // travels in the headers, never in this URL.
      return `url:${result.url}`;
    }
    const stat = await fs.stat(result.path).catch(() => undefined);
    return `file:${result.path}@${stat?.mtimeMs ?? 0}`;
  }

  /**
   * Whether the published picture can be reused for this source as is: it is
   * the same source and not due for a refresh, or a recent fetch of this
   * source failed. A due refresh uses up one of the run's refreshes.
   */
  private reusable(
    existing: Maybe<IndexEntry>,
    current: Maybe<IndexEntry>,
    sourceKey: string,
    run: { refreshesLeft: number },
  ): { reuse: true; entry: Maybe<IndexEntry> } | { reuse: false } {
    const now = Date.now();
    const backingOff =
      existing?.failedAt !== undefined &&
      existing.failedSourceKey === sourceKey &&
      now - existing.failedAt < RetryFailedAfterMs;

    if (current && current.sourceKey === sourceKey) {
      const due = now - current.fetchedAt >= RefreshAfterMs;
      if (!due || backingOff || run.refreshesLeft <= 0) {
        return { reuse: true, entry: current };
      }
      run.refreshesLeft--;
      return { reuse: false };
    }
    if (backingOff) {
      return { reuse: true, entry: current };
    }
    return { reuse: false };
  }

  /** The entry, when its file is on disk. */
  private async alreadyPublished(
    entry: Maybe<IndexEntry>,
  ): Promise<Maybe<IndexEntry>> {
    if (entry === undefined || !DiskNamePattern.test(entry.file)) {
      return undefined;
    }
    const size = await fileSize(path.join(this.artworkDirectory, entry.file));
    return size === undefined ? undefined : entry;
  }

  protected async loadPicture(
    result: Exclude<ArtworkResult, { kind: 'not-found' }>,
    timeoutMs: number,
  ): Promise<Maybe<{ bytes: Buffer; extension: string }>> {
    let bytes: Buffer;
    if (result.kind === 'file') {
      const size = await fileSize(result.path);
      if (size === undefined || size > MaxPictureBytes) {
        return;
      }
      bytes = await fs.readFile(result.path);
    } else {
      const response = await axios.request<ArrayBuffer>({
        url: result.url,
        headers: { Accept: 'image/*', ...result.headers },
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        maxContentLength: MaxPictureBytes,
        maxBodyLength: MaxPictureBytes,
      });
      bytes = Buffer.from(response.data);
    }

    // The bytes decide the type, not the file name or the server's header.
    const type = await fileTypeFromBuffer(bytes);
    const extension = type ? PublishableExtensions[type.mime] : undefined;
    if (extension === undefined) {
      return;
    }
    return { bytes, extension };
  }

  private async writeAtomically(file: string, bytes: Buffer): Promise<void> {
    // Written next to the served folder, never inside it, so a half-written
    // file is never served. Same file system, so the rename is atomic.
    const temp = path.join(this.mediaDirectory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, bytes);
      await fs.rename(temp, path.join(this.artworkDirectory, file));
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  /**
   * Deletes pictures no guide write has linked to for 30 days, versions
   * replaced 30 days ago, and files the index doesn't know. Returns whether the
   * index changed.
   */
  private async collectGarbage(
    index: Index,
    indexLoaded: boolean,
  ): Promise<boolean> {
    const now = Date.now();
    const remove = (file: string) =>
      fs.rm(path.join(this.artworkDirectory, file), { force: true });
    let changed = false;
    for (const [key, entry] of Object.entries(index.entries)) {
      if (now - entry.referencedAt >= ForgetUnreferencedAfterMs) {
        for (const file of [entry.file, ...entry.retired.map((r) => r.file)]) {
          if (file !== '') {
            await remove(file);
          }
        }
        delete index.entries[key];
        changed = true;
        continue;
      }
      const kept = entry.retired.filter(
        (r) => now - r.at < ForgetUnreferencedAfterMs,
      );
      if (kept.length !== entry.retired.length) {
        for (const r of entry.retired) {
          if (!kept.includes(r)) {
            await remove(r.file);
          }
        }
        entry.retired = kept;
        changed = true;
      }
    }

    // Without an index, every file looks unknown. They are adopted as their
    // pictures are published again, so leave them until then.
    if (!indexLoaded) {
      return changed;
    }
    const known = new Set(
      Object.values(index.entries).flatMap((e) => [
        e.file,
        ...e.retired.map((r) => r.file),
      ]),
    );
    for (const file of await fs.readdir(this.artworkDirectory)) {
      if (known.has(file)) {
        continue;
      }
      const full = path.join(this.artworkDirectory, file);
      const stat = await fs.stat(full).catch(() => undefined);
      if (stat?.isFile() && now - stat.mtimeMs >= ForgetUnreferencedAfterMs) {
        await fs.rm(full, { force: true });
      }
    }
    return changed;
  }

  private urlPath(entry: IndexEntry): string {
    const match = DiskNamePattern.exec(entry.file);
    if (!match) {
      throw new Error(`Unexpected published file name: ${entry.file}`);
    }
    return `${PublicArtworkPathPrefix}${match[1]}.${match[3]}?v=${match[2]}`;
  }

  private async loadIndex(): Promise<{ index: Index; loaded: boolean }> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = IndexSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return { index: parsed.data, loaded: true };
      }
      this.logger.warn(
        'Guide picture index at %s is unreadable; starting a new one',
        this.indexPath,
      );
    } catch {
      // A missing index starts empty. Files already on disk are adopted.
    }
    return { index: { entries: {} }, loaded: false };
  }

  private async saveIndex(index: Index): Promise<void> {
    const temp = path.join(this.mediaDirectory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(index));
      await fs.rename(temp, this.indexPath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
}

export function describeLoadError(e: unknown): string {
  if (isAxiosError(e)) {
    return e.response ? `HTTP ${e.response.status}` : (e.code ?? e.message);
  }
  return caughtErrorToError(e).message;
}

async function fileSize(file: string): Promise<Maybe<number>> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}
