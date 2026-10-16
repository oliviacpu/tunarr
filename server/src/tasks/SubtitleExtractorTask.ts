import { seq } from '@tunarr/shared/util';
import type { ContentGuideProgram, TerminalProgram } from '@tunarr/types';
import { tag } from '@tunarr/types';
import dayjs from 'dayjs';
import { inject, injectable } from 'inversify';
import { capitalize, isUndefined } from 'lodash-es';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path, { dirname, extname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpName } from 'tmp-promise';
import z from 'zod';
import { ProgramDaoMinter } from '../db/converters/ProgramMinter.ts';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import type { IProgramDB } from '../db/interfaces/IProgramDB.ts';
import type { ISettingsDB } from '../db/interfaces/ISettingsDB.ts';
import { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type {
  MediaSourceWithRelations,
  ProgramWithRelationsOrm,
} from '../db/schema/derivedTypes.js';
import type { ProgramSubtitles } from '../db/schema/ProgramSubtitles.ts';
import { QueryError, type QueryResult } from '../external/BaseApiClient.ts';
import { MediaSourceApiFactory } from '../external/MediaSourceApiFactory.ts';
import { HttpReconnectOptions } from '../ffmpeg/builder/options/input/HttpReconnectOptions.ts';
import type { GlobalOptions } from '../globals.ts';
import { TVGuideService } from '../services/TvGuideService.ts';
import { ExternalSubtitleDownloader } from '../stream/ExternalSubtitleDownloader.ts';
import { PathCalculator } from '../stream/PathCalculator.ts';
import { ProgramStreamDetailsFetcher } from '../stream/ProgramStreamDetailsFetcher.ts';
import { isImageBasedSubtitle } from '../stream/util.ts';
import { KEYS } from '../types/inject.ts';
import { OpenDateTimeRange } from '../types/OpenDateTimeRange.ts';
import { Result } from '../types/result.ts';
import { ChildProcessHelper } from '../util/ChildProcessHelper.ts';
import {
  CacheFolderName,
  SubtitlesCacheFolderName,
} from '../util/constants.ts';
import { fileExists } from '../util/fsUtil.ts';
import { isDefined, isNonEmptyString } from '../util/index.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import type { Maybe } from '../types/util.ts';
import {
  externalSubtitleStreamId,
  getSubtitleCacheFilePath,
} from '../util/subtitles.ts';
import { Task2 } from './Task.ts';
import { taskDef } from './TaskRegistry.ts';

/**
 * How old a downloaded copy of an external subtitle gets before the hourly
 * top-up fetches it again, for programs airing within the hour. The media
 * server's file can be rewritten under the same stream (a re-sync, a better
 * download), and a copy never notices on its own.
 */
export const STALE_CACHE_COPY_MS = 6 * 60 * 60 * 1000;

export function isInsideFolder(folder: string, file: string) {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

async function isOlderThan(file: string, ageMs: number) {
  try {
    return Date.now() - (await fs.stat(file)).mtimeMs > ageMs;
  } catch {
    return false;
  }
}

const ChannelExtractionFilter = z.object({
  type: z.literal('channel'),
  channelId: z.string(),
});

const ProgramExtractionFilter = z.object({
  type: z.literal('program'),
  programId: z.string(),
});

const DurationExtractionFilter = z.object({
  type: z.literal('time'),
  durationMs: z.number(),
});

type DurationExtractionFilter = z.infer<typeof DurationExtractionFilter>;

const ExtractionFilter = z.discriminatedUnion('type', [
  ChannelExtractionFilter,
  ProgramExtractionFilter,
  DurationExtractionFilter,
]);

const SubtitleExtractorTaskRequest = z.object({
  filter: ExtractionFilter.optional(),
});

type SubtitleExtractorTaskRequest = z.infer<
  typeof SubtitleExtractorTaskRequest
>;

const defaultFilter = {
  type: 'time',
  durationMs: dayjs.duration({ hours: 1 }).asMilliseconds(),
} satisfies DurationExtractionFilter;

@injectable()
@taskDef({
  name: SubtitleExtractorTask.name,
  description:
    'Extracts embedded, text-based subtitles from scheduled programs and downloads any external subtitles that are still missing',
  schema: SubtitleExtractorTaskRequest,
})
export class SubtitleExtractorTask extends Task2<
  typeof SubtitleExtractorTaskRequest
> {
  static KEY = SubtitleExtractorTask.name;
  static ID = SubtitleExtractorTask.name;
  public ID = SubtitleExtractorTask.ID;

  schema = SubtitleExtractorTaskRequest;

  @InjectLogger() declare protected readonly logger: Logger;

  constructor(
    @inject(TVGuideService) private guideService: TVGuideService,
    @inject(KEYS.ChannelDB) private channelDB: IChannelDB,
    @inject(ProgramStreamDetailsFetcher)
    private streamDetailsFetcher: ProgramStreamDetailsFetcher,
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(KEYS.SettingsDB) private settingsDB: ISettingsDB,
    @inject(KEYS.GlobalOptions) private globalOptions: GlobalOptions,
    @inject(KEYS.ProgramDB) private programDB: IProgramDB,
    @inject(ExternalSubtitleDownloader)
    private externalSubtitleDownloader: ExternalSubtitleDownloader,
    @inject(MediaSourceApiFactory)
    private mediaSourceApiFactory: MediaSourceApiFactory,
    @inject(ProgramDaoMinter) private programMinter: ProgramDaoMinter,
  ) {
    super();
  }

  protected async runInternal(
    request: SubtitleExtractorTaskRequest,
  ): Promise<void> {
    const filter = request.filter ?? defaultFilter;
    switch (filter.type) {
      case 'time':
        await this.handleTimeFilter(filter);
        break;
      case 'channel':
      case 'program':
        this.logger.debug(
          'Subtitle extraction filter type %s not yet implemented',
          filter.type,
        );
        break;
    }
  }

  private async handleTimeFilter(filter: DurationExtractionFilter) {
    const now = dayjs();

    // On the first run we may have to block if the guide is updating.
    await this.guideService.get();

    const channelIds = (await this.channelDB.getAllChannels())
      .filter((channel) => channel.subtitlesEnabled)
      .map((channel) => channel.uuid);

    if (channelIds.length === 0) {
      this.logger.trace(
        'Skipping subtitle extraction because no channel has subtitles enabled',
      );
      return;
    }

    const nextHourGuide = await this.guideService.getChannelGuides(
      OpenDateTimeRange.create(now, now.add(filter.durationMs))!,
      channelIds,
    );
    const mediaSources = await this.mediaSourceDB.getAll();

    // A program can air more than once in the hour (a repeat, or the same
    // program on two channels); everything handleProgram does is per program,
    // so it runs once a run. That keeps a heal that can't succeed (the item is
    // gone, or its new subtitle 404s too) from re-reading the item each time.
    const handled = new Set<string>();
    for (const { programs } of nextHourGuide) {
      for (const program of programs) {
        if (program.type !== 'content') {
          continue;
        }
        if (handled.has(program.id)) {
          continue;
        }
        handled.add(program.id);

        const mediaSource = mediaSources.find(
          (ms) => ms.uuid === program.program.mediaSourceId,
        );
        if (!mediaSource) {
          // log
          continue;
        }

        const result = await Result.attemptAsync(() =>
          this.handleProgram(program, mediaSource),
        );
        if (result.isFailure()) {
          this.logger.warn(
            result.error,
            'Failed to extract subtitles for program %s',
            program.id,
          );
        }
      }
    }
  }

  /**
   * Resolves sidecar subtitles that currently have no file Tunarr can open --
   * because the media source was unreachable when the library was scanned, or
   * because the cached copy has since been deleted. Without this, such a
   * subtitle stays missing until the library happens to be rescanned.
   *
   * It also keeps downloaded copies fresh where Tunarr can't read the media
   * server's file: a copy older than STALE_CACHE_COPY_MS is fetched again and
   * replaced only if it changed. And a stream the media server answers 404
   * for (its file was replaced) heals at once: see healMissingSidecar.
   */
  private async topUpExternalSubtitles(
    dbProgram: ProgramWithRelationsOrm,
    mediaSource: MediaSourceWithRelations,
  ) {
    const cacheFolder = this.subtitleCacheFolder();
    for (const subtitle of dbProgram.subtitles ?? []) {
      if (subtitle.subtitleType !== 'sidecar') {
        continue;
      }

      const recorded =
        isNonEmptyString(subtitle.path) && (await fileExists(subtitle.path))
          ? subtitle.path
          : undefined;
      // A file outside the cache (a local library's sidecar, or one on shared
      // storage) is the live file: nothing to fetch.
      if (recorded && !isInsideFolder(cacheFolder, recorded)) {
        continue;
      }

      // Storage shared with the media source is preferred: no download, and no
      // second copy of a file we can already read. With a copy recorded,
      // playback already reads the shared file ahead of it.
      const sharedPath = await PathCalculator.findLocalPath(
        subtitle.sourcePath,
        mediaSource.replacePaths,
      );
      if (sharedPath) {
        if (!recorded) {
          this.logger.debug(
            'Found external subtitle %s for program %s on shared storage: %s',
            subtitle.uuid,
            dbProgram.uuid,
            sharedPath,
          );
          await this.saveResolvedSubtitlePath(subtitle, sharedPath);
        }
        continue;
      }

      // A copy is fetched again once it is STALE_CACHE_COPY_MS old: the
      // media server's file may have been rewritten under the same stream.
      if (recorded && !(await isOlderThan(recorded, STALE_CACHE_COPY_MS))) {
        continue;
      }

      const subtitleKey = subtitle.sourceKey;
      if (!isNonEmptyString(subtitleKey)) {
        continue;
      }

      const fetchResult = await Result.attemptAsync(() =>
        this.externalSubtitleDownloader.fetchToCache(
          this.externalItem(dbProgram, mediaSource),
          {
            streamIndex: subtitle.streamIndex ?? undefined,
            codec: subtitle.codec,
            // External subtitles have no stream index, so the source-relative
            // location is what keeps their cache entries distinct.
            key: subtitleKey,
          },
          () => this.fetchExternalSubtitle(mediaSource, subtitleKey),
          { refresh: recorded !== undefined },
        ),
      );

      if (fetchResult.isFailure()) {
        this.logger.warn(
          fetchResult.error,
          'Error downloading external subtitle %s for program %s',
          subtitle.uuid,
          dbProgram.uuid,
        );
        continue;
      }

      const fetched = fetchResult.get();
      if (fetched.type === 'not_found') {
        // The media server no longer has this stream: its file was replaced
        // or removed. Re-read the item and save its subtitles as they are
        // now. That replaces every sidecar row of the program, so the rest
        // of this loop would work on stale rows.
        await this.healMissingSidecar(dbProgram, mediaSource, subtitle);
        return;
      }

      if (fetched.type === 'failed' || !isNonEmptyString(fetched.path)) {
        continue;
      }

      if (fetched.type === 'replaced') {
        this.logger.info(
          'Refreshed external subtitle %s for "%s": it changed on the media server since it was downloaded',
          externalSubtitleStreamId(subtitleKey),
          dbProgram.title,
        );
      } else {
        this.logger.debug(
          'External subtitle %s for program %s: %s (%s)',
          subtitle.uuid,
          dbProgram.uuid,
          fetched.path,
          fetched.type,
        );
      }

      if (subtitle.path !== fetched.path) {
        await this.saveResolvedSubtitlePath(subtitle, fetched.path);
      }
    }
  }

  /**
   * A sidecar's stream answered 404: the media server replaced or removed its
   * file. Rather than wait for the media server's rescan and then Tunarr's,
   * read the item again now, mint its subtitle rows from what it lists today
   * and save them the way a scan does (cached copies the new rows don't use
   * are deleted), resolving or downloading the sidecars first. Once per
   * program per run, no retry loop. An item that is gone itself is left to
   * the next library scan, which marks the program missing.
   */
  private async healMissingSidecar(
    dbProgram: ProgramWithRelationsOrm,
    mediaSource: MediaSourceWithRelations,
    missing: ProgramSubtitles,
  ) {
    const missingId = externalSubtitleStreamId(missing.sourceKey ?? '');
    const server = capitalize(mediaSource.type);

    const itemResult = await Result.attemptAsync(() =>
      this.fetchTerminalItem(mediaSource, dbProgram),
    );
    if (itemResult.isFailure()) {
      this.logger.warn(
        itemResult.error,
        'Could not re-read "%s" after its subtitle stream %s went missing',
        dbProgram.title,
        missingId,
      );
      return;
    }

    const item = itemResult.get();
    if (!item) {
      this.logger.info(
        '%s no longer has subtitle stream %s for "%s" (item %s); re-reading items of this type is not supported, so it waits for the next scan.',
        server,
        missingId,
        dbProgram.title,
        dbProgram.externalKey,
      );
      return;
    }

    if (item.isFailure()) {
      if (item.error.type === 'not_found') {
        this.logger.info(
          '%s no longer has "%s" (item %s); the next scan of its library marks it missing.',
          server,
          dbProgram.title,
          dbProgram.externalKey,
        );
      } else {
        this.logger.warn(
          item.error,
          'Could not re-read "%s" after its subtitle stream %s went missing',
          dbProgram.title,
          missingId,
        );
      }
      return;
    }

    const minted = this.programMinter.mintSubtitles(
      dbProgram.uuid,
      item.get(),
      mediaSource.type,
    );

    // The media server still lists the stream it just answered 404 for: it
    // hasn't rescanned the item since the file changed, so there is nothing
    // new to save. The rows and whatever copy there is stay as they are (the
    // best subtitle available now) until it does; this is checked again at
    // most once an hour, for a program about to air.
    if (
      minted.some(
        (row) =>
          row.subtitleType === 'sidecar' && row.sourceKey === missing.sourceKey,
      )
    ) {
      this.logger.info(
        '%s still lists subtitle stream %s for "%s" but no longer serves it; waiting for %s to rescan the item.',
        server,
        missingId,
        dbProgram.title,
        server,
      );
      return;
    }

    // Sidecars that are still the same stream keep the file they have; the
    // others are resolved on shared storage or downloaded, as a scan does.
    const kept = new Map(
      seq.collect(dbProgram.subtitles ?? [], (sub) =>
        sub.subtitleType === 'sidecar' &&
        sub.uuid !== missing.uuid &&
        isNonEmptyString(sub.sourceKey) &&
        isNonEmptyString(sub.path)
          ? ([sub.sourceKey, sub.path] as const)
          : undefined,
      ),
    );
    for (const row of minted) {
      if (row.subtitleType !== 'sidecar' || isNonEmptyString(row.path)) {
        continue;
      }
      const keptPath = row.sourceKey ? kept.get(row.sourceKey) : undefined;
      if (keptPath && (await fileExists(keptPath))) {
        row.path = keptPath;
        continue;
      }
      const sharedPath = await PathCalculator.findLocalPath(
        row.sourcePath,
        mediaSource.replacePaths,
      );
      if (sharedPath) {
        row.path = sharedPath;
        continue;
      }
      const key = row.sourceKey;
      if (!isNonEmptyString(key)) {
        continue;
      }
      const fetched = await Result.attemptAsync(() =>
        this.externalSubtitleDownloader.fetchToCache(
          this.externalItem(dbProgram, mediaSource),
          { streamIndex: row.streamIndex ?? undefined, codec: row.codec, key },
          () => this.fetchExternalSubtitle(mediaSource, key),
        ),
      );
      const result = fetched.isSuccess() ? fetched.get() : undefined;
      if (result && result.type !== 'not_found' && result.path) {
        row.path = result.path;
      }
    }

    // By program, so an item that lists no subtitles any more clears its rows
    await this.programDB.replaceProgramSubtitles(dbProgram.uuid, minted);

    const replacement = minted.find(
      (row) =>
        row.subtitleType === 'sidecar' &&
        row.language === missing.language &&
        row.forced === missing.forced &&
        row.sdh === missing.sdh,
    );
    this.logger.info(
      '%s no longer had subtitle stream %s for "%s"; re-read the item and saved its subtitles as they are now (%s).',
      server,
      missingId,
      dbProgram.title,
      replacement
        ? `the ${missing.language} one is now stream ${externalSubtitleStreamId(replacement.sourceKey ?? '')}${replacement.path ? '' : ', not downloaded yet'}`
        : `no ${missing.language} sidecar any more`,
    );
  }

  /**
   * The program as its media server lists it now, for re-minting its
   * subtitles. Undefined for item types this doesn't re-read.
   */
  private async fetchTerminalItem(
    mediaSource: MediaSourceWithRelations,
    dbProgram: ProgramWithRelationsOrm,
  ): Promise<Maybe<QueryResult<TerminalProgram>>> {
    const key = dbProgram.externalKey;
    if (dbProgram.type !== 'movie' && dbProgram.type !== 'episode') {
      return;
    }
    const movie = dbProgram.type === 'movie';
    switch (mediaSource.type) {
      case 'plex': {
        const client =
          await this.mediaSourceApiFactory.getPlexApiClientForMediaSource(
            mediaSource,
          );
        return movie ? client.getMovie(key) : client.getEpisode(key);
      }
      case 'jellyfin': {
        const client =
          await this.mediaSourceApiFactory.getJellyfinApiClientForMediaSource(
            mediaSource,
          );
        return movie ? client.getMovie(key) : client.getEpisode(key);
      }
      case 'emby': {
        const client =
          await this.mediaSourceApiFactory.getEmbyApiClientForMediaSource(
            mediaSource,
          );
        return movie ? client.getMovie(key) : client.getEpisode(key);
      }
      case 'local':
        return;
    }
  }

  private externalItem(
    dbProgram: ProgramWithRelationsOrm,
    mediaSource: MediaSourceWithRelations,
  ) {
    return {
      externalKey: dbProgram.externalKey,
      externalSourceId: mediaSource.uuid,
      sourceType: dbProgram.sourceType,
      uuid: dbProgram.uuid,
      title: dbProgram.title,
    };
  }

  private subtitleCacheFolder() {
    return path.join(
      this.globalOptions.databaseDirectory,
      CacheFolderName,
      SubtitlesCacheFolderName,
    );
  }

  private async saveResolvedSubtitlePath(
    subtitle: ProgramSubtitles,
    path: string,
  ) {
    await this.programDB.setSubtitlePath(subtitle.uuid, path);
    // Keep the in-memory row in step so anything downstream in this run sees
    // the same location that was just persisted.
    subtitle.path = path;
  }

  private async fetchExternalSubtitle(
    mediaSource: MediaSourceWithRelations,
    key: string,
  ): Promise<QueryResult<string>> {
    switch (mediaSource.type) {
      case 'plex': {
        const client =
          await this.mediaSourceApiFactory.getPlexApiClientForMediaSource(
            mediaSource,
          );
        return client.getSubtitles(key);
      }
      case 'jellyfin': {
        const client =
          await this.mediaSourceApiFactory.getJellyfinApiClientForMediaSource(
            mediaSource,
          );
        return client.getSubtitlesByPath(key);
      }
      case 'emby': {
        const client =
          await this.mediaSourceApiFactory.getEmbyApiClientForMediaSource(
            mediaSource,
          );
        return client.getSubtitlesByPath(key);
      }
      case 'local':
        // Local libraries are scanned off storage Tunarr already has open, so
        // their sidecars are never fetched over the network.
        return Result.failure(
          QueryError.create(
            'generic_request_error',
            'Local media sources have no subtitle endpoint',
          ),
        );
    }
  }

  private async handleProgram(
    program: ContentGuideProgram,
    mediaSource: MediaSourceWithRelations,
  ) {
    const dbProgram = await this.programDB.getProgramById(program.id);
    if (!dbProgram) {
      return;
    }

    // External subtitles are files we fetch, not streams we extract, so they
    // are topped up regardless of the extraction setting below.
    await this.topUpExternalSubtitles(dbProgram, mediaSource);

    if (!this.settingsDB.ffmpegSettings().enableSubtitleExtraction) {
      this.logger.trace(
        'Subtitle extraction is not enabled, skipping extraction for program %s',
        program.id,
      );
      return;
    }

    const stream = await this.streamDetailsFetcher.getStream({
      server: mediaSource,
      lineupItem: { ...dbProgram, mediaSourceId: mediaSource.uuid },
    });

    if (stream.isFailure()) {
      this.logger.error(stream.error);
      return;
    }

    const textBasedSubs =
      stream.get().streamDetails.subtitleDetails?.filter((subtitle) => {
        return (
          subtitle.type === 'embedded' && !isImageBasedSubtitle(subtitle.codec)
        );
      }) ?? [];

    const ffmpegSetting = this.settingsDB.ffmpegSettings();

    if (textBasedSubs.length === 0) {
      this.logger.debug('No text-based subtitles for ID: %s', program.id);
      return;
    }

    const cacheFolder = path.join(
      this.globalOptions.databaseDirectory,
      CacheFolderName,
      SubtitlesCacheFolderName,
    );

    // This should've been created on startup but double-check
    if (!(await fileExists(cacheFolder))) {
      await fs.mkdir(cacheFolder);
    }

    const subtitlesToSave = (
      await Promise.all(
        seq.collect(textBasedSubs, async (subtitle) => {
          if (isUndefined(subtitle.index)) {
            return;
          }

          const filePath = getSubtitleCacheFilePath(
            {
              externalKey: program.program.externalId,
              externalSourceId: tag(program.program.mediaSourceId),
              externalSourceType: program.program.sourceType,
              id: program.id,
            },
            { streamIndex: subtitle.index, codec: subtitle.codec },
          );
          if (!filePath) {
            return;
          }

          const fullPath = path.join(cacheFolder, filePath);

          if (!(await fileExists(fullPath))) {
            return {
              subtitle,
              outPath: fullPath,
              tmpPath: await tmpName({ postfix: extname(filePath) }),
            };
          }
          this.logger.trace(
            'Skipping existing subtitle extraction (stream index = %d) path for program %s (%s). File already exists: %s',
            subtitle.index,
            program.id,
            program.program.title,
            fullPath,
          );
          return;
        }),
      )
    ).filter(isDefined);

    for (const { outPath } of subtitlesToSave) {
      const outDir = dirname(outPath);
      if (!(await fileExists(outDir))) {
        await fs.mkdir(outDir, { recursive: true });
      }
    }

    const subtitleOutputArgs = subtitlesToSave.reduce((prev, curr) => {
      const codec = curr.subtitle.codec === 'mov_text' ? 'text' : 'copy';
      prev.push(
        '-map',
        `0:${curr.subtitle.index}`,
        '-c:s',
        codec,
        `${curr.tmpPath}`,
      );
      return prev;
    }, [] as string[]);

    if (subtitlesToSave.length === 0) {
      this.logger.trace(
        'No subtitles to extract for program ID = %s',
        program.id,
      );
      return;
    }

    const outputResult = await Result.attemptAsync(async () => {
      return await new ChildProcessHelper().getStdout(
        ffmpegSetting.ffmpegExecutablePath,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'warning',
          ...(stream.get().streamSource.type === 'http'
            ? new HttpReconnectOptions().options()
            : []),
          '-i',
          `${stream.get().streamSource.path}`,
          ...subtitleOutputArgs,
        ],
        {
          swallowError: false,
          isPath: true,
          timeout: 500_000,
        },
      );
    });

    if (outputResult.isFailure()) {
      this.logger.warn(outputResult.error, 'Failed to extract subtitles');
      return;
    }

    const copyResults = await Promise.allSettled(
      subtitlesToSave.map(async ({ outPath, tmpPath }) => {
        // Stream through a Transform that drops stray NUL bytes that some
        // sources (notably mov_text -> ass and certain Plex muxers) embed
        // inside the extracted text. libass refuses to parse a file that
        // contains a NUL, which manifests as missing burn-in subtitles
        // with no obvious ffmpeg-level error.
        await pipeline(
          createReadStream(tmpPath),
          new Transform({
            transform(chunk: Buffer, _encoding, cb) {
              cb(
                null,
                chunk.filter((byte) => byte !== 0x00),
              );
            },
          }),
          createWriteStream(outPath),
        );
      }),
    );

    for (const result of copyResults) {
      if (result.status === 'rejected') {
        this.logger.warn(result.reason, 'Failed to copy tmp subtitles');
      }
    }
  }
}
