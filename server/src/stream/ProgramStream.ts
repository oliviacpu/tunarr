import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import type { OutputFormat } from '@/ffmpeg/builder/constants.js';
import type { TranscodeSessionResult } from '@/ffmpeg/types.js';
import { CacheImageService } from '@/services/cacheImageService.js';
import { Result } from '@/types/result.js';
import type { Maybe } from '@/types/util.js';
import {
  localUploadFile,
  resolveIconUrl,
  uploadsDirectory,
} from '@/util/iconUtil.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import { makeLocalUrl } from '@/util/serverUtil.js';
import type { Watermark } from '@tunarr/types';
import dayjs from 'dayjs';
import { isUndefined } from 'lodash-es';
import events from 'node:events';
import { PassThrough } from 'node:stream';
import { match, P } from 'ts-pattern';
import type {
  ContentBackedStreamLineupItem,
  ErrorStreamLineupItem,
  OfflineStreamLineupItem,
} from '../db/derived_types/StreamLineup.ts';
import { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { FFmpegAssistedFactory } from '../ffmpeg/FFmpegModule.ts';
import {
  loadNowPlayingFont,
  nowPlayingLine,
} from '../ffmpeg/nowPlayingText.ts';
import type {
  OfflineBackgroundMusic,
  OfflineNowPlaying,
  StreamOptions,
} from '../ffmpeg/types.ts';
import { globalOptions } from '../globals.ts';
import { KEYS } from '../types/inject.ts';
import { assisted, injected, multiInjected } from '../util/assistedInject.ts';
import {
  attempt,
  caughtErrorToError,
  isDefined,
  isNonEmptyString,
  isSuccess,
} from '../util/index.ts';
import { InjectLogger } from '../util/inject.ts';
import type { PlayerContext } from './PlayerStreamContext.ts';
import { ProgramStreamDetailsFetcher } from './ProgramStreamDetailsFetcher.ts';
import type { ProgramStreamPlugin } from './plugins/ProgramStreamPlugin.ts';
import { FileStreamSource, type StreamRenditions } from './types.ts';

type ProgramStreamEvents = {
  // Emitted when the stream has reached a fatal error point
  // This means that both the program and error stream have failed to play.
  error: [];
};

/**
 * Implements the functionality of managing an output stream
 * for a given program. This class is essentially a lineup item + transcode session
 */
export class ProgramStream extends events.EventEmitter<ProgramStreamEvents> {
  @InjectLogger() declare private readonly logger: Logger;

  private outStream?: PassThrough;
  private hadError: boolean = false;
  private _transcodeSession: Maybe<FfmpegTranscodeSession>;
  private _renditions?: StreamRenditions;

  constructor(
    @injected(KEYS.SettingsDB) protected settingsDB: ISettingsDB,
    @injected(CacheImageService) private cacheImageService: CacheImageService,
    @injected(KEYS.FFmpegFactory)
    protected ffmpegFactory: FFmpegAssistedFactory,
    @injected(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @injected(ProgramStreamDetailsFetcher)
    private programStreamDetails: ProgramStreamDetailsFetcher,
    @multiInjected(KEYS.ProgramStreamPlugin)
    private streamPlugins: ProgramStreamPlugin[],
    @assisted public context: PlayerContext,
    @assisted protected outputFormat: OutputFormat,
    @assisted public opts?: Partial<StreamOptions>,
  ) {
    super();
  }

  async setup(): Promise<Result<FfmpegTranscodeSession>> {
    if (this.isInitialized()) {
      return Result.success(this._transcodeSession!);
    }

    // A throw here would skip the caller's error-stream fallback, and the
    // session would retry the same item in a tight loop.
    const result = await this.setupInternal().catch((e: unknown) =>
      Result.forError<TranscodeSessionResult>(caughtErrorToError(e)),
    );

    result.forEach((value) => {
      this.transcodeSession = value.session;
      this._renditions = value.renditions;
    });

    return result.map((r) => r.session);
  }

  protected async setupInternal(): Promise<Result<TranscodeSessionResult>> {
    const { lineupItem } = this.context;
    return match(lineupItem)
      .with({ type: P.union('program', 'commercial', 'fallback') }, (item) =>
        this.setupContentItem(item),
      )
      .with({ type: 'offline' }, (item) => this.setupOfflineItem(item))
      .with({ type: 'error' }, (item) => this.setupErrorItem(item))
      .with({ type: 'redirect' }, (item) =>
        Result.failure<TranscodeSessionResult>(
          `ProgramStream cannot direct play a direct item: ${JSON.stringify(item)}`,
        ),
      )
      .exhaustive();
  }

  private async setupContentItem(
    lineupItem: ContentBackedStreamLineupItem,
  ): Promise<Result<TranscodeSessionResult>> {
    const server = await this.mediaSourceDB.getById(
      lineupItem.program.mediaSourceId,
    );
    if (!server) {
      return Result.forError(
        new Error(
          `Unable to find server "${lineupItem.program.mediaSourceId}" specified by program.`,
        ),
      );
    }

    const streamDetailsResult = await this.programStreamDetails.getStream({
      server,
      lineupItem: lineupItem.program,
    });

    if (streamDetailsResult.isFailure()) {
      return streamDetailsResult.recast();
    }

    const watermark = await this.getWatermark();
    const ffmpeg = this.ffmpegFactory(
      this.context.transcodeConfig,
      this.context.sourceChannel,
    );

    // TODO: check if this was killed before actually starting.

    const { streamDetails, streamSource } = streamDetailsResult.get();
    streamDetails.duration = dayjs.duration(lineupItem.streamDuration);

    const start = dayjs.duration(lineupItem.startOffset ?? 0);
    const resolvedOptions = {
      startTime: start,
      duration: dayjs.duration(lineupItem.streamDuration),
      watermark,
      realtime: this.context.realtime,
      outputFormat: this.outputFormat,
      streamMode: this.context.streamMode,
      encoding: this.context.encoding,
      ...(this.opts ?? {}),
    };
    const sessionResult = await ffmpeg.createStreamSession({
      stream: {
        source: streamSource,
        details: streamDetails,
      },
      options: resolvedOptions,
      lineupItem,
    });

    if (!sessionResult) {
      return Result.forError(new Error('Unable to create ffmpeg process'));
    }

    for (const plugin of this.streamPlugins) {
      try {
        await plugin.run({
          opts: resolvedOptions,
          outputFormat: this.outputFormat,
          playerContext: this.context,
          transcodeSession: sessionResult,
        });
      } catch (e) {
        this.logger.error(
          e,
          'Error firing stream plugin %s',
          plugin.constructor.name,
        );
      }
    }

    return Result.success(sessionResult);
  }

  private async setupOfflineItem(
    lineupItem: OfflineStreamLineupItem,
  ): Promise<Result<TranscodeSessionResult>> {
    const ffmpeg = this.ffmpegFactory(
      this.context.transcodeConfig,
      this.context.targetChannel,
    );

    let duration = dayjs.duration(lineupItem.streamDuration);
    const start = dayjs.duration(lineupItem.startOffset ?? 0);
    if (+duration > +start) {
      duration = duration.subtract(start);
    }

    this.logger.debug(
      'starting offline session of %d ms',
      duration.asMilliseconds(),
    );

    const [backgroundMusic, title, picture] = await Promise.all([
      lineupItem.backgroundMusic
        ? this.resolveBackgroundMusic(lineupItem.backgroundMusic)
        : undefined,
      lineupItem.backgroundMusic
        ? this.resolveNowPlaying(lineupItem.backgroundMusic)
        : undefined,
      this.resolveOfflinePicture(),
    ]);
    const nowPlaying = backgroundMusic ? title : undefined;

    const result = await ffmpeg.createPlaceholderSession({
      kind: 'offline',
      duration,
      outputFormat: this.outputFormat,
      ptsOffset: this.opts?.ptsOffset,
      isFirstTranscode: this.opts?.isFirstTranscode,
      // Paced like a program: a session's first transcode reads ahead, so a
      // tune-in that lands in a gap starts as fast as one in a program
      realtime: this.opts?.realtime ?? this.context.realtime,
      backgroundMusic,
      picture,
      nowPlaying,
    });

    if (isUndefined(result)) {
      throw new Error('Unable to start ffmpeg transcode session');
    }

    return Result.success(result);
  }

  // The gap music track's source and audio stream, resolved like any program
  // (local file if present, else the media server). Undefined on any failure,
  // which leaves the gap with the placeholder audio.
  private async resolveBackgroundMusic(
    music: NonNullable<OfflineStreamLineupItem['backgroundMusic']>,
  ): Promise<OfflineBackgroundMusic | undefined> {
    const server = await this.mediaSourceDB.getById(
      music.program.mediaSourceId,
    );
    if (!server) {
      this.logger.warn(
        'Gap music track %s: media source %s not found',
        music.program.uuid,
        music.program.mediaSourceId,
      );
      return;
    }

    const streamResult = await this.programStreamDetails.getStream({
      server,
      lineupItem: music.program,
    });
    if (streamResult.isFailure()) {
      this.logger.warn(
        streamResult.error,
        'Gap music track %s: could not resolve its stream',
        music.program.uuid,
      );
      return;
    }

    const { streamDetails, streamSource } = streamResult.get();
    if (streamSource.type !== 'file' && streamSource.type !== 'http') {
      this.logger.warn(
        'Gap music track %s: unsupported stream source %s',
        music.program.uuid,
        streamSource.type,
      );
      return;
    }
    const audioStream = streamDetails.audioDetails?.[0];
    if (!audioStream) {
      this.logger.warn(
        'Gap music track %s has no audio stream',
        music.program.uuid,
      );
      return;
    }

    return {
      source: streamSource,
      audioStream,
      trackDurationMs: music.program.duration,
    };
  }

  // The gap music track's artist and title, to draw over the offline picture,
  // unless the channel turned that off. Undefined when the font couldn't be
  // set up, or can't draw the text.
  private async resolveNowPlaying(
    music: NonNullable<OfflineStreamLineupItem['backgroundMusic']>,
  ): Promise<OfflineNowPlaying | undefined> {
    if (this.context.targetChannel.offline?.showNowPlaying === false) {
      return;
    }

    const font = await loadNowPlayingFont();
    if (!font) {
      return;
    }

    const text = nowPlayingLine(
      { title: music.program.title, artist: music.artist },
      font.metrics,
    );
    if (text === undefined) {
      this.logger.debug(
        "Gap music track %s: no title, or a character the font can't draw",
        music.program.uuid,
      );
      return;
    }
    return { text, fontFile: font.file };
  }

  // The channel's offline picture from disk when it's one of this server's
  // uploads, as channel cards are. Fetching it back through the server's
  // address (often public HTTPS) slowed every tune-in that landed in a gap.
  private async resolveOfflinePicture(): Promise<FileStreamSource | undefined> {
    const file = await localUploadFile(
      this.context.targetChannel.offline?.picture,
      uploadsDirectory(globalOptions().databaseDirectory),
    );
    return file ? new FileStreamSource(file) : undefined;
  }

  private async setupErrorItem(
    lineupItem: ErrorStreamLineupItem,
  ): Promise<Result<TranscodeSessionResult>> {
    const ffmpeg = this.ffmpegFactory(
      this.context.transcodeConfig,
      this.context.targetChannel,
    );

    let duration = dayjs.duration(lineupItem.streamDuration);
    const start = dayjs.duration(lineupItem.startOffset ?? 0);
    if (+duration > +start) {
      duration = duration.subtract(start);
    }

    this.logger.debug(
      'starting offline session of %d ms',
      duration.asMilliseconds(),
    );

    const result = await ffmpeg.createPlaceholderSession({
      kind: 'error',
      title: 'Error',
      duration,
      outputFormat: this.outputFormat,
      realtime: this.opts?.realtime ?? this.context.realtime,
      ptsOffset: this.opts?.ptsOffset,
      isFirstTranscode: this.opts?.isFirstTranscode,
    });

    if (isUndefined(result)) {
      throw new Error('Unable to start ffmpeg transcode session');
    }

    return Result.success(result);
  }

  isInitialized(): boolean {
    return isDefined(this._transcodeSession);
  }

  async start(sink?: PassThrough) {
    if (!this.isInitialized()) {
      await this.setup();
    }

    return (this.outStream = this._transcodeSession?.start(sink));
  }

  shutdown(): void {
    if (this.isInitialized()) {
      this.transcodeSession!.kill();
    }
    this.shutdownInternal();
  }

  protected shutdownInternal(): void {}

  get renditions(): StreamRenditions | undefined {
    return this._renditions;
  }

  get transcodeSession(): Maybe<FfmpegTranscodeSession> {
    return this._transcodeSession;
  }

  set transcodeSession(session: FfmpegTranscodeSession) {
    this._transcodeSession = session;
    this._transcodeSession.on('end', () => this.shutdownInternal());
    this._transcodeSession.on('error', () => {
      if (this.hadError) {
        // We're streaming the error and something went wrong with that..
        // time to just bail.
        this.shutdown();
        this.emit('error');
      } else {
        this.hadError = true;
        const failedStream = this._transcodeSession;
        failedStream?.kill();
        if (!this.opts?.disableErrorStream) {
          this.tryReplaceWithErrorStream(this.outStream).catch((e) => {
            this.logger.error(e, 'Error while setting up ');
          });
        }
      }
    });
  }

  private async tryReplaceWithErrorStream(sink?: PassThrough) {
    const out = sink ?? new PassThrough();
    try {
      const errorResult = await this.getErrorStream(this.context);

      if (isUndefined(errorResult)) {
        out.push(null);
        return;
      }

      errorResult.session.start(out);
      this.transcodeSession = errorResult.session;

      this.transcodeSession.on('end', () => {
        out.push(null);
      });
    } catch (e) {
      this.logger.error(e, 'Error while trying to spawn error stream! YIKES');
      throw e;
    }
  }

  private getErrorStream(context: PlayerContext) {
    const ffmpeg = this.ffmpegFactory(
      context.transcodeConfig,
      context.sourceChannel,
    );

    const duration = dayjs.duration(
      dayjs(this.transcodeSession?.streamEndTime).diff(),
    );

    return ffmpeg.createPlaceholderSession({
      kind: 'error',
      title: 'Playback Error',
      subtitle: 'Check server logs for details',
      duration,
      outputFormat: this.outputFormat,
      realtime: true,
    });
  }

  protected async getWatermark(): Promise<Maybe<Watermark>> {
    const channel = this.context.targetChannel;

    if (this.context.transcodeConfig.disableChannelOverlay) {
      return;
    }

    if (
      this.context.lineupItem.type === 'commercial' &&
      this.context.targetChannel.disableFillerOverlay
    ) {
      return;
    }

    if (channel.watermark?.enabled) {
      const watermark = { ...channel.watermark };
      let icon: string;
      // Capture this so it can't change asynchronously.
      const watermarkUrl = watermark.url;
      if (isNonEmptyString(watermarkUrl) && URL.canParse(watermarkUrl)) {
        const parsed = new URL(watermarkUrl);
        if (parsed.host.includes('localhost')) {
          icon = watermarkUrl;
        } else {
          const cachedWatermarkUrl = await attempt(() =>
            this.cacheImageService.getOrDownloadImageUrl(watermarkUrl),
          );

          if (
            isSuccess(cachedWatermarkUrl) &&
            isNonEmptyString(cachedWatermarkUrl?.path)
          ) {
            icon = cachedWatermarkUrl.path;
          } else {
            icon = makeLocalUrl('/images/tunarr.png');
          }
        }
      } else {
        const resolvedIcon = resolveIconUrl(
          channel.icon,
          makeLocalUrl('/images/tunarr.png'),
        );
        if (!resolvedIcon) {
          return;
        }
        icon = resolvedIcon;
      }

      return {
        ...watermark,
        enabled: true,
        url: icon,
      };
    }

    return;
  }
}
