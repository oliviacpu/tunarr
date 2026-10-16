import { inject, injectable } from 'inversify';
import { capitalize } from 'lodash-es';
import fs from 'node:fs/promises';
import path from 'path';
import type { MediaSourceId, MediaSourceType } from '../db/schema/base.ts';
import type { QueryResult } from '../external/BaseApiClient.ts';
import { FileSystemService } from '../services/FileSystemService.ts';

import type { Maybe } from '../types/util.ts';
import { fileExists } from '../util/fsUtil.ts';
import { isNonEmptyString } from '../util/index.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import {
  externalSubtitleStreamId,
  getSubtitleCacheFilePath,
  subtitleCodecToExt,
} from '../util/subtitles.ts';

export type GetSubtitleCallbackArgs = {
  extension: string;
};

type GetSubtitlesCallback = (
  cbArgs: GetSubtitleCallbackArgs,
) => Promise<QueryResult<string>>;

type ExternalItem = {
  externalKey: string;
  externalSourceId: MediaSourceId;
  sourceType: MediaSourceType;
  uuid: string;
  // Names the program in log lines.
  title: string;
};

type SubtitleStreamDetails = {
  streamIndex: Maybe<number>;
  codec: string;
  key?: Maybe<string>;
};

/**
 * The line logged when the media server answers 404 for a subtitle. It still
 * lists the stream, but the file behind it was replaced or removed and the
 * item has not been rescanned there yet. Once it is, the item's streams change
 * and the next library scan downloads the new subtitle, if there is one, so
 * this is reported as an expected outcome rather than a failure.
 */
export function missingSubtitleMessage(
  item: Pick<ExternalItem, 'externalKey' | 'sourceType' | 'title'>,
  details: Pick<SubtitleStreamDetails, 'streamIndex' | 'key'>,
): string {
  const server = capitalize(item.sourceType);
  const stream = isNonEmptyString(details.key)
    ? externalSubtitleStreamId(details.key)
    : `index ${details.streamIndex ?? 'unknown'}`;
  return `${server} no longer has subtitle stream ${stream} for "${item.title}" (item ${item.externalKey}); skipped until ${server} rescans the item.`;
}

@injectable()
export class ExternalSubtitleDownloader {
  @InjectLogger() declare private readonly logger: Logger;

  constructor(
    @inject(FileSystemService) private fileSystemService: FileSystemService,
  ) {}

  /**
   * Given an item and an external subtitle stream belonging to that item, potentially download the external stream from
   * the source
   * @param item
   * @param details
   * @param getSubtitlesCb
   * @returns The full path to the downloaded subtitles
   */
  async downloadSubtitlesIfNecessary(
    item: ExternalItem,
    details: SubtitleStreamDetails,
    getSubtitlesCb: GetSubtitlesCallback,
  ) {
    const result = await this.fetchToCache(item, details, getSubtitlesCb);
    if (result.type === 'not_found') {
      this.logger.info(missingSubtitleMessage(item, details));
      return;
    }
    return result.path;
  }

  /**
   * Fetches an external subtitle into the subtitle cache, named after its key.
   * Without `refresh` an existing copy is used as it is. With `refresh` the
   * copy is fetched again and replaced only when its content changed, so a
   * subtitle whose file the media server rewrote (a re-sync, a better
   * download) doesn't stay old for good. Copies are written to a temporary
   * file and renamed into place, so ffmpeg never reads half a file. A failed
   * fetch keeps the existing copy. A 404 is returned, not logged: the caller
   * decides what it means.
   */
  async fetchToCache(
    item: ExternalItem,
    details: SubtitleStreamDetails,
    getSubtitlesCb: GetSubtitlesCallback,
    opts: { refresh?: boolean } = {},
  ): Promise<SubtitleCacheResult> {
    const outPath = getSubtitleCacheFilePath(
      {
        externalKey: item.externalKey,
        externalSourceId: item.externalSourceId,
        externalSourceType: item.sourceType,
        id: item.uuid,
      },
      {
        codec: details.codec,
        streamIndex: details.streamIndex,
        key: details.key,
      },
    );
    const ext = subtitleCodecToExt(details.codec);

    if (!outPath || !ext) {
      this.logger.warn(
        'Was not able to calculate output path or extension for subtitle codec: %s',
        details.codec,
      );
      return { type: 'failed' };
    }

    // This should've been created on startup but double-check
    const cacheFolder = this.fileSystemService.getSubtitleCacheFolder();
    if (!(await fileExists(cacheFolder))) {
      await fs.mkdir(cacheFolder);
    }

    const fullPath = path.join(cacheFolder, outPath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const existing = (await fileExists(fullPath)) ? fullPath : undefined;
    if (existing && !opts.refresh) {
      return { type: 'cached', path: existing };
    }

    const subtitlesRes = await getSubtitlesCb({ extension: ext });

    if (subtitlesRes.isFailure()) {
      if (subtitlesRes.error.type === 'not_found') {
        return { type: 'not_found' };
      }

      this.logger.warn(
        subtitlesRes.error,
        'Error while requesting external subtitle stream: %s',
        subtitlesRes.error.message ?? '',
      );
      return { type: 'failed', path: existing };
    }

    const content = Buffer.from(subtitlesRes.get(), 'utf-8');
    try {
      if (existing) {
        const current = await fs.readFile(existing).catch(() => null);
        if (current?.equals(content)) {
          // The same subtitle: keep the copy, and restart its age so it isn't
          // fetched again until it is stale once more.
          const now = new Date();
          await fs.utimes(existing, now, now);
          return { type: 'unchanged', path: existing };
        }
      }
      await writeFileAtomically(fullPath, content);
      return { type: existing ? 'replaced' : 'written', path: fullPath };
    } catch (e) {
      this.logger.warn(e, 'Error writing subtitle output file to %s', fullPath);
      return { type: 'failed', path: existing };
    }
  }
}

/**
 * What fetchToCache did: `cached` (an existing copy, not fetched), `written`
 * (a new copy), `unchanged` (fetched again, the same content), `replaced`
 * (fetched again, the new content swapped in), `not_found` (the media server
 * no longer has the stream) or `failed` (an existing copy, if any, is kept).
 */
export type SubtitleCacheResult =
  | { type: 'cached' | 'written' | 'unchanged' | 'replaced'; path: string }
  | { type: 'not_found' }
  | { type: 'failed'; path?: string };

async function writeFileAtomically(target: string, content: Buffer) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}
