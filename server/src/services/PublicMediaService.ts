import type { ArtworkType } from '@/db/schema/Artwork.js';
import { Mutex } from 'async-mutex';
import axios from 'axios';
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
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import { ArtworkService, type ArtworkResult } from './ArtworkService.ts';

/** Where published guide pictures are served from. No login needed. */
export const PublicArtworkPathPrefix = '/media/artwork/';

const IndexFileName = 'artwork-index.json';

/** A picture the guide links to: what `/api/programs/<id>/artwork/<type>` serves. */
export type PublicArtworkRef = {
  id: string;
  artworkType: ArtworkType;
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
    const index = await this.loadIndex();
    const startedAt = Date.now();
    const run = {
      deadline: startedAt + PublishBudgetMs,
      refreshesLeft: MaxRefreshesPerRun,
      changed: false,
    };

    const queue = new PQueue({ concurrency: Concurrency });
    for (const [key, ref] of unique) {
      void queue.add(async () => {
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
          this.logger.warn(e, 'Could not publish guide picture %s', key);
        }
      });
    }
    await queue.onIdle();

    if (await this.collectGarbage(index)) {
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
    const result = await this.artworkService.resolveArtwork(
      ref.id,
      'program',
      ref.artworkType,
    );
    if (result.kind === 'not-found') {
      return;
    }

    const sourceKey = await this.sourceKey(result);
    const existing = index.entries[key];
    const current = await this.alreadyPublished(existing);
    const now = Date.now();
    const backingOff =
      existing?.failedAt !== undefined &&
      existing.failedSourceKey === sourceKey &&
      now - existing.failedAt < RetryFailedAfterMs;

    if (current && current.sourceKey === sourceKey) {
      const due = now - current.fetchedAt >= RefreshAfterMs;
      if (!due || backingOff || run.refreshesLeft <= 0) {
        return current;
      }
      run.refreshesLeft--;
    } else if (backingOff) {
      return current;
    }

    if (now >= run.deadline) {
      return current;
    }

    const loaded = await this.loadPicture(
      result,
      Math.min(FetchTimeoutMs, run.deadline - now),
    ).catch((e: unknown) => {
      this.logger.debug(e, 'Could not load guide picture %s', key);
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
        }),
        failedAt: now,
        failedSourceKey: sourceKey,
      };
      run.changed = true;
      return current;
    }

    const file = `${key}.${loaded.extension}`;
    const sha256 = createHash('sha256').update(loaded.bytes).digest('hex');
    if (current && current.sha256 === sha256 && current.file === file) {
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

    const adopted = await this.adoptExistingFile(file, sha256);
    const version =
      adopted ??
      nextArtworkVersion(
        now,
        existing && existing.version > 0 ? existing.version : undefined,
      );
    if (adopted === undefined) {
      await this.writeAtomically(file, loaded.bytes, version);
    }
    if (existing && existing.file !== '' && existing.file !== file) {
      await fs.rm(path.join(this.artworkDirectory, existing.file), {
        force: true,
      });
    }

    const entry: IndexEntry = {
      file,
      sourceKey,
      sha256,
      version,
      fetchedAt: now,
      referencedAt: now,
    };
    index.entries[key] = entry;
    run.changed = true;
    return entry;
  }

  /**
   * After the index is lost, a file already holding these bytes keeps the
   * version its modification time records, so its URL doesn't change.
   */
  private async adoptExistingFile(
    file: string,
    sha256: string,
  ): Promise<Maybe<number>> {
    const full = path.join(this.artworkDirectory, file);
    try {
      const [bytes, stat] = await Promise.all([
        fs.readFile(full),
        fs.stat(full),
      ]);
      if (createHash('sha256').update(bytes).digest('hex') === sha256) {
        return Math.floor(stat.mtimeMs / 1000);
      }
    } catch {
      // No file to adopt.
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

  /** The entry, when its file is on disk. */
  private async alreadyPublished(
    entry: Maybe<IndexEntry>,
  ): Promise<Maybe<IndexEntry>> {
    if (entry === undefined || entry.file === '') {
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

  private async writeAtomically(
    file: string,
    bytes: Buffer,
    version: number,
  ): Promise<void> {
    // Written next to the served folder, never inside it, so a half-written
    // file is never served. Same file system, so the rename is atomic.
    const temp = path.join(this.mediaDirectory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, bytes);
      const versionDate = new Date(version * 1000);
      await fs.utimes(temp, versionDate, versionDate);
      await fs.rename(temp, path.join(this.artworkDirectory, file));
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  /**
   * Deletes pictures no guide write has linked to for 30 days, and files the
   * index doesn't know. Returns whether the index changed.
   */
  private async collectGarbage(index: Index): Promise<boolean> {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of Object.entries(index.entries)) {
      if (now - entry.referencedAt < ForgetUnreferencedAfterMs) {
        continue;
      }
      if (entry.file !== '') {
        await fs.rm(path.join(this.artworkDirectory, entry.file), {
          force: true,
        });
      }
      delete index.entries[key];
      changed = true;
    }

    const known = new Set(Object.values(index.entries).map((e) => e.file));
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
    return `${PublicArtworkPathPrefix}${entry.file}?v=${formatArtworkVersion(entry.version)}`;
  }

  private async loadIndex(): Promise<Index> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = IndexSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }
      this.logger.warn(
        'Guide picture index at %s is unreadable; starting a new one',
        this.indexPath,
      );
    } catch {
      // A missing index starts empty. Files already on disk are adopted.
    }
    return { entries: {} };
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

async function fileSize(file: string): Promise<Maybe<number>> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}
