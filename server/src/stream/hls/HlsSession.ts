import type { CaptionSession } from '../Session.ts';
import { hdhrCaptionsEnabled } from '../captions/hdhrCaptionsEnabled.ts';
import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import { GetLastPtsDurationTask } from '@/ffmpeg/GetLastPtsDuration.js';
import type { HlsOptions } from '@/ffmpeg/builder/constants.js';
import {
  HlsDirectOutputFormat,
  HlsOutputFormat,
  hlsPlaylistWindowSize,
} from '@/ffmpeg/builder/constants.js';
import { HlsSubtitleOutputFormat } from '@/ffmpeg/builder/options/HlsSubtitleOutputFormat.js';
import type { OnDemandChannelService } from '@/services/OnDemandChannelService.js';
import { PlayerContext } from '@/stream/PlayerStreamContext.js';
import type { StopOptions } from '@/stream/Session.js';
import type { StreamProgramCalculator } from '@/stream/StreamProgramCalculator.js';
import type {
  CaptionSchedule,
  CcPair,
} from '@/stream/captions/Cea608Encoder.js';
import {
  buildCaptionSchedule,
  EraseDisplayedMemory,
  PaddingPair,
} from '@/stream/captions/Cea608Encoder.js';
import type { CaptionRefusalKind } from '@/stream/captions/MpegTsCaptionInserter.js';
import { insertCaptions } from '@/stream/captions/MpegTsCaptionInserter.js';
import type { ProgramCaptions } from '@/stream/captions/ProgramCaptions.js';
import { pairsForFrames } from '@/stream/captions/pairsForFrames.js';
import type { HlsSlowerSession } from '@/stream/hls/HlsSlowerSession.js';
import type {
  AudioRenditionInfo,
  SubtitleRenditionInfo,
} from '@/stream/types.js';
import { Result } from '@/types/result.js';
import type { Maybe } from '@/types/util.js';
import { fileExists } from '@/util/fsUtil.js';
import { wait } from '@/util/index.js';
import { seq } from '@tunarr/shared/util';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { filter, isEmpty, last, maxBy, sortBy } from 'lodash-es';
import fs from 'node:fs/promises';
import path, { basename, dirname, extname } from 'node:path';
import type { DeepRequired } from 'ts-essentials';
import type { ProgramStreamFactory } from '../ProgramStreamFactory.ts';
import type { BaseHlsSessionOptions } from './BaseHlsSession.js';
import { BaseHlsSession, SegmentNameRegex } from './BaseHlsSession.js';
import { HlsMasterPlaylistMutator } from './HlsMasterPlaylistMutator.js';
import type {
  FilterBeforeSegmentNumber,
  HlsPlaylistFilterOptions,
} from './HlsPlaylistMutator.js';
import { HlsPlaylistMutator } from './HlsPlaylistMutator.js';
import { MediaPlaylistReader } from './MediaPlaylistReader.js';
import { transcodeConfigFor } from './readAheadThreads.js';
import { describeTranscodeSpeedEvent } from './TranscodeSpeedMonitor.js';
import { TranscodeSpeedWatcher } from './TranscodeSpeedWatcher.js';

export type HlsSessionProvider = (
  channel: ChannelOrmWithTranscodeConfig,
  options: HlsSessionOptions,
) => HlsSession;

export type HlsSlowerSessionProvider = (
  channel: ChannelOrmWithTranscodeConfig,
  options: BaseHlsSessionOptions,
) => HlsSlowerSession;

// One program's captions on the session's output clock (90 kHz MPEG-TS PTS)
type CaptionTimelineEntry = {
  startPts: number;
  // The program's planned length, cut short where the next program started
  // (see endCaptionsAt)
  durationPts: number;
  framePts: number;
  schedule: CaptionSchedule;
  language: string;
  rateMismatchLogged: boolean;
};

// MPEG-TS timestamps are 33 bits and wrap after about 26.5 hours
const PtsWrap = 2 ** 33;
// How far `pts` comes after `startPts` on the 33-bit clock
const ptsSince = (startPts: number, pts: number) =>
  (((pts - startPts) % PtsWrap) + PtsWrap) % PtsWrap;
// Where a session's output clock starts (90 kHz): its first program's
// -output_ts_offset. At 0, the encoder's B-frame delay makes the first
// decoding timestamps negative, and the muxer shifts the whole program later
// to keep them positive: its first frame came out at PTS 6000 (two frames at
// 30 fps) while its captions and subtitles were timed from 0, two frames
// early. From 1 s nothing goes negative, so the first program starts exactly
// at its offset, as every later program does.
export const SessionStartPts = 90_000;
// Captions of this many recent programs are kept, for segments still being served
const CaptionTimelineLength = 10;
// Where a program's captions were cut short, the first two frames within this
// long after the cut that no program's captions cover erase the screen, so a
// caption left showing goes away (608 sends a control code twice)
const CaptionCutClearPts = 90_000;
// A live subtitle playlist with no segments yet (see ensureSubtitlePlaylist)
const EmptySubtitlePlaylist = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  `#EXT-X-TARGETDURATION:${HlsSubtitleOutputFormat.SegmentSeconds}`,
  '#EXT-X-MEDIA-SEQUENCE:0',
  '',
].join('\n');
// Segments in each trimmed playlist served to clients
const PlaylistSegmentCount = 20;

export interface HlsSessionOptions extends BaseHlsSessionOptions {
  captionsEnabled?: boolean;
  streamMode: 'hls' | 'hls_direct_v2';
  // Segment length in hls mode, fixed for the session's lifetime so the
  // playlist's target duration stays true. hls_direct_v2 always uses 4 s.
  segmentSeconds?: number;
}

/**
 * Initializes an ffmpeg process that concatenates via the /playlist
 * endpoint and outputs an HLS format + segments
 */
export class HlsSession
  extends BaseHlsSession<HlsSessionOptions>
  implements CaptionSession
{
  readonly captionsEnabled: boolean;
  #playlistStart?: Dayjs;
  #hlsPlaylistMutator: HlsPlaylistMutator = new HlsPlaylistMutator();
  // Parses only what ffmpeg appended to stream.m3u8 since the last request,
  // and keeps the segments the file's 15-minute window no longer lists
  #playlistReader: MediaPlaylistReader;
  #currentSession: Maybe<FfmpegTranscodeSession>;
  #lastDelete: Dayjs = dayjs().subtract(1, 'year');
  #lastSubtitleDelete: Dayjs = dayjs().subtract(1, 'year');
  // Every video segment numbered below this has been deleted. ffmpeg's
  // stream.m3u8 can still list them (it keeps 15 minutes of segments), and
  // the reader's history can too, so trimmed playlists must start at or above
  // the floor. Subtitles need no floor. Their muxer keeps a 20-entry window
  // (HlsSubtitleOutputFormat), and that window is also the deletion boundary,
  // so subs.m3u8 never lists a pruned .vtt.
  #segmentFloor = 0;
  #isFirstTranscode = true;
  #lastDiscontinuitySequence: number | undefined;
  #currentSubtitleRendition: SubtitleRenditionInfo | undefined;
  #currentAudioRenditions: AudioRenditionInfo[] = [];
  #captionTimeline: CaptionTimelineEntry[] = [];
  // Where programs' captions were cut short (see endCaptionsAt)
  #captionCuts: number[] = [];
  // Time spent adding captions to served segments, summed up when the session
  // ends: numbers to decide whether caching captioned segments is worth it
  #captionRewrites = { count: 0, totalMs: 0, maxMs: 0 };
  #captionRefusals = new Set<CaptionRefusalKind>();

  constructor(
    channel: ChannelOrmWithTranscodeConfig,
    options: HlsSessionOptions,
    private programCalculator: StreamProgramCalculator,
    private settingsDB: ISettingsDB,
    private onDemandService: OnDemandChannelService,
    private programStreamFactory: ProgramStreamFactory,
  ) {
    super(channel, options);
    this.captionsEnabled =
      options.captionsEnabled ??
      hdhrCaptionsEnabled({
        hdhrClosedCaptions: settingsDB.ffmpegSettings().hdhrClosedCaptions,
        streamMode: options.streamMode,
        subtitlesEnabled: channel.subtitlesEnabled,
        videoFormat: channel.transcodeConfig.videoFormat,
      });
    this.#playlistReader = new MediaPlaylistReader(
      this._m3u8PlaylistPath,
      this.logger,
    );
  }

  public get sessionType(): HlsSessionOptions['streamMode'] {
    return this.sessionOptions.streamMode;
  }

  async getPlaylist() {
    return this.readPlaylist();
  }

  async getMasterPlaylist(): Promise<Result<string | undefined>> {
    return Result.attemptAsync(async () => {
      if (!(await fileExists(this._masterPlaylistPath))) {
        return undefined;
      }
      const content = await fs.readFile(this._masterPlaylistPath, 'utf-8');
      const rendition = this.#currentSubtitleRendition;
      const hlsOptions = this.getHlsOptions();
      const lines = HlsMasterPlaylistMutator.rewriteVariantPlaylistUrls(
        content,
        rendition,
        hlsOptions,
      );
      if (rendition) {
        HlsMasterPlaylistMutator.injectSubtitleMediaTag(
          lines,
          rendition,
          hlsOptions,
        );
      }
      if (this.#currentAudioRenditions.length > 0) {
        HlsMasterPlaylistMutator.injectAudioMediaTags(
          lines,
          this.#currentAudioRenditions,
          hlsOptions,
        );
      }
      return lines.join('\n');
    });
  }

  async trimPlaylist(filterOpts?: HlsPlaylistFilterOptions) {
    filterOpts ??= {
      type: 'before_segment_number',
      segmentNumber: this.minSegmentRequested,
      segmentsToKeepBefore: 10,
      segmentFloor: this.#segmentFloor,
    };
    return Result.attemptAsync(async () => {
      return await this.lock.runExclusive(async () => {
        const fullParses = this.#playlistReader.stats.fullParses;
        const trimResult = await this.#playlistReader.trim(
          this.#playlistStart,
          filterOpts,
          {
            maxSegmentsToKeep: PlaylistSegmentCount,
            targetDuration: this.getHlsOptions().hlsTime,
            previousDiscontinuitySequence: this.#lastDiscontinuitySequence,
            endWithDiscontinuity: false,
          },
        );
        if (
          fullParses > 0 &&
          this.#playlistReader.stats.fullParses > fullParses
        ) {
          this.logger.debug(
            'Parsed the whole HLS playlist again (channel id = %s, number = %d)',
            this.channel.uuid,
            this.channel.number,
          );
        }
        if (trimResult) {
          this.#lastDiscontinuitySequence = trimResult.discontinuitySequence;
          const now = dayjs();
          if (now.isAfter(this.#lastDelete.add(30, 'seconds'))) {
            this.logger.debug(
              'Deleting old segments from stream (channel id = %s, number = %d)',
              this.channel.uuid,
              this.channel.number,
            );

            // A playlist of 20 or fewer entries skips the filter, so its
            // sequence can fall below the floor.
            this.#segmentFloor = Math.max(
              this.#segmentFloor,
              trimResult.sequence,
            );
            // The default filter never lists them again, so a long session
            // holds only its recent segments
            this.#playlistReader.discardSegmentsBelow(
              this.#segmentFloor,
              PlaylistSegmentCount,
            );
            this.deleteOldSegmentFiles(trimResult.sequence, [
              '.ts',
              '.mp4',
            ]).catch((e) => this.logger.error(e));
            this.#lastDelete = now;
          }

          return trimResult;
        }

        this.logger.trace(
          'No playlist for HLS sessions at %s',
          this._m3u8PlaylistPath,
        );
        return;
      });
    });
  }

  async trimSubtitlePlaylist(filterOpts?: FilterBeforeSegmentNumber) {
    filterOpts ??= {
      type: 'before_segment_number',
      segmentNumber: this.minSubtitleSegmentRequested,
      segmentsToKeepBefore: 10,
    };
    return Result.attemptAsync(async () => {
      return await this.lock.runExclusive(async () => {
        const playlistLines = await this.readSubtitlePlaylist();
        if (playlistLines) {
          const trimResult = this.#hlsPlaylistMutator.trimSubtitlePlaylist(
            playlistLines,
            filterOpts,
            { maxSegmentsToKeep: 20 },
          );

          const now = dayjs();
          if (now.isAfter(this.#lastSubtitleDelete.add(30, 'seconds'))) {
            this.deleteOldSegmentFiles(trimResult.sequence, ['.vtt']).catch(
              (e) => this.logger.error(e),
            );
            this.#lastSubtitleDelete = now;
          }

          return trimResult;
        }

        this.logger.trace(
          'No subtitle playlist for HLS sessions at %s',
          this._subtitlePlaylistPath,
        );
        return;
      });
    });
  }

  protected async startInternal() {
    if (this.state === 'started') {
      return;
    }

    await this.initDirectories();

    this.state = 'started';
    this.#playlistStart = this.transcodedUntil = dayjs();
    // Fire-and-forget
    this.run().catch((e) => this.logger.error(e));
  }

  private async run() {
    while (this.state === 'started') {
      const transcodeBuffer = dayjs
        .duration(dayjs(this.transcodedUntil).diff())
        .asSeconds();

      if (transcodeBuffer <= 60) {
        const realtime = transcodeBuffer >= 30;
        this.logger.trace(
          'Transcode buffer is %d. Starting next transcode (realtime = %s)',
          transcodeBuffer,
          realtime,
        );
        await this.transcode(realtime);
        this.#isFirstTranscode = false;
      } else {
        // trim and delete
        // await this.trimPlaylistAndDeleteSegments();
        await wait(dayjs.duration({ seconds: 5 }));
      }
    }

    this.logger.debug('HLS worker ended main loop with state = %s', this.state);

    // Only schedule cleanup if the session wasn't already explicitly stopped
    // (e.g. via endSession). If the session is already stopped, its cleanup
    // has been handled and scheduling another timer would risk deleting a
    // replacement session that now occupies the same map key.
    if (!this.stoppingOrStopped) {
      this.scheduleCleanup();
    }
  }

  protected async stopInternal(options: StopOptions): Promise<void> {
    try {
      await this.stopStream(options);
    } catch (e) {
      this.logger.error(e, 'Error while shutting down session');
    }
    this.logCaptionRewriteSummary();
  }

  private logCaptionRewriteSummary() {
    const { count, totalMs, maxMs } = this.#captionRewrites;
    if (count === 0) {
      return;
    }
    this.logger.info(
      'Captioned %d segments: mean %s ms, max %s ms',
      count,
      (totalMs / count).toFixed(1),
      maxMs.toFixed(1),
    );
  }

  private async transcode(realtime: boolean) {
    // hls_direct_v2 keeps the source's timestamps (-copyts)
    const ptsOffset =
      this.sessionOptions.streamMode === 'hls_direct_v2'
        ? 0
        : this.#isFirstTranscode
          ? SessionStartPts
          : await this.getPtsOffset();
    // Unlike ptsOffset, this applies regardless of isFirstTranscode/
    // streamMode: scanning a fresh/empty working directory already
    // naturally yields 0, and hls_direct_v2's subs.m3u8 has the same
    // restart-numbering problem as hls (only the video/audio -copyts
    // handling is hls_direct_v2-specific).
    const subtitleSegmentStartNumber =
      await this.getLastSubtitleSegmentNumber();

    const lineupItemResult = await this.programCalculator.getCurrentLineupItem({
      allowSkip: true,
      channelId: this.channel.uuid,
      startTime: await this.onDemandService.getLiveTimestamp(
        this.channel.uuid,
        +(this.transcodedUntil ?? dayjs()),
      ),
    });

    // A transcode that reads ahead (a tune-in, or catching up) gets more
    // threads, so a viewer waits less for its first seconds
    const transcodeConfig = transcodeConfigFor(
      this.channel.transcodeConfig,
      realtime,
      undefined,
      this.settingsDB.ffmpegSettings().hlsReadAheadMaxThreads,
    );

    const transcodeResult = await lineupItemResult.mapAsync(async (result) => {
      this.logger.debug(
        'About to play lineup item: %s',
        JSON.stringify(result.lineupItem, undefined, 4),
      );
      const context = new PlayerContext(
        result.lineupItem,
        result.channelContext,
        result.sourceChannel,
        transcodeConfig,
        {
          audioOnly: false,
          realtime,
          streamMode: this.sessionType,
        },
      );

      let programStream = this.getProgramStream(
        context,
        ptsOffset,
        subtitleSegmentStartNumber,
      );

      programStream.on('error', () => {
        this.state = 'error';
        this.error = new Error(
          `Unrecoverable error in underlying FFMPEG process`,
        );
        this.emit('error', this.error);
      });

      let transcodeSessionResult = await programStream.setup();

      if (transcodeSessionResult.isFailure()) {
        this.logger.error(
          transcodeSessionResult.error,
          'Error while starting program stream. Attempting to subtitute with error stream',
        );

        programStream = this.getProgramStream(
          PlayerContext.error(
            result.lineupItem.streamDuration ?? result.lineupItem.duration,
            transcodeSessionResult.error,
            result.channelContext,
            this.channel,
            realtime,
            transcodeConfig,
            this.sessionType,
          ),
          ptsOffset,
          subtitleSegmentStartNumber,
        );

        transcodeSessionResult = await programStream.setup();

        if (transcodeSessionResult.isFailure()) {
          this.state = 'error';
          this.error = transcodeSessionResult.error;
          this.emit('error', this.error);
        }
      }

      // Both awaits below come before the stop check, which then also covers
      // a stop that lands during them.
      if (programStream.renditions?.subtitle !== undefined) {
        await this.ensureSubtitlePlaylist();
      }
      // hls_direct_v2 copies the video, so there is no encoder to fall behind
      const speedWatcher =
        this.sessionOptions.streamMode === 'hls'
          ? await this.watchTranscodeSpeed(programStream.context)
          : undefined;

      // A stop that landed during setup has already killed the previous
      // transcode. Starting this one would leave an ffmpeg nothing kills.
      if (this.state !== 'started') {
        speedWatcher?.stop();
        return;
      }

      transcodeSessionResult.forEach((transcodeSession) => {
        this.transcodedUntil = (this.transcodedUntil ?? dayjs()).add(
          transcodeSession.streamDuration,
        );
        this.#currentSession = transcodeSession;
        this.#currentSubtitleRendition = programStream.renditions?.subtitle;
        this.#currentAudioRenditions = programStream.renditions?.audio ?? [];
        // Every program, with captions or without, ends the captions of the
        // one before it
        this.endCaptionsAt(
          ptsOffset,
          transcodeSession.streamDuration.asMilliseconds() * 90,
        );
        const captions = programStream.renditions?.captions;
        if (captions) {
          this.addCaptions(ptsOffset, captions);
        }
      });

      if (this.sessionOptions.streamMode === 'hls') {
        // await this.trimPlaylistAndDeleteSegments();
      }
      try {
        await programStream.start();
        return await programStream.transcodeSession!.wait();
      } finally {
        speedWatcher?.stop();
      }
    });

    if (transcodeResult.isFailure()) {
      this.logger.error(
        transcodeResult.error,
        'Error while transcoding program stream.',
      );
    }

    this.logger.debug('Stream ended.');
  }

  // Warns once per program when its transcode can't keep up with real time
  private async watchTranscodeSpeed(context: PlayerContext) {
    const watcher = new TranscodeSpeedWatcher(
      this._m3u8PlaylistPath,
      (event) => {
        const message = describeTranscodeSpeedEvent(event, {
          channel: this.channel,
          item: context.lineupItem,
          transcodeConfig: context.transcodeConfig,
          configuredThreadCount: this.channel.transcodeConfig.threadCount,
          realtime: context.realtime,
        });
        if (event.type === 'behind') {
          this.logger.warn(message);
        } else {
          this.logger.info(message);
        }
      },
      {
        onError: (e) =>
          this.logger.debug(e, 'Could not measure the transcode speed'),
      },
    );
    await watcher.start();
    return watcher;
  }

  protected override getAdditionalRequiredFiles(): string[] {
    return this.#currentSubtitleRendition
      ? [this.getHlsOptions().subtitleStreamNameFormat]
      : [];
  }

  // ffmpeg's segment muxer (HlsSubtitleOutputFormat) writes subs.m3u8 only
  // when it closes a subtitle segment, which takes a cue past the segment's
  // end. Embedded subtitles are read at playback speed (hls_direct_v2 maps
  // them from the program's own input), so a stream that starts in a stretch
  // without dialogue would have no subtitle playlist for longer than start-up
  // waits for one. An empty live playlist stands in until ffmpeg replaces
  // it. One left by an earlier program is kept, so clients never see the
  // subtitle playlist emptied.
  private async ensureSubtitlePlaylist() {
    const result = await Result.attemptAsync(() =>
      fs.writeFile(this._subtitlePlaylistPath, EmptySubtitlePlaylist, {
        flag: 'wx',
      }),
    );
    if (result.isFailure() && result.error.nodeErrorCode() !== 'EEXIST') {
      this.logger.warn(result.error, 'Could not write subtitle playlist');
    }
  }

  // Lays a program's caption cues out on the session's output clock, which
  // starts the program at `ptsOffset` (the video's -output_ts_offset, 90 kHz)
  private addCaptions(ptsOffset: number, captions: ProgramCaptions) {
    const startMs = ptsOffset / 90;
    const scheduleStart = performance.now();
    const schedule = buildCaptionSchedule(
      captions.cues.map((cue) => ({
        ...cue,
        startMs: cue.startMs + startMs,
        endMs: cue.endMs + startMs,
      })),
      {
        firstFrameMs: startMs,
        frameRate: captions.frameRate,
        endMs: startMs + captions.durationMs,
        // Resolved per program (with the channel's own settings over the
        // global ones), so a settings change applies from the next one
        appearance: captions.appearance ?? {
          ...this.settingsDB.ffmpegSettings().hdhrCaptionAppearance,
          alignment: this.settingsDB.ffmpegSettings().hdhrCaptionAlignment,
        },
        // A transcode has a keyframe at every segment start (HlsOutputFormat's
        // -force_key_frames), where a player tuning in starts decoding.
        // Copied video (hls_direct_v2) never gets captions.
        keyframeIntervalMs: this.getHlsOptions().hlsTime * 1000,
      },
    );
    // Built before the program's ffmpeg starts, so a viewer tuning in waits
    // for it
    this.logger.debug(
      'Laid out %d caption cues for the program at PTS %d (%d s) in %s ms',
      captions.cues.length,
      ptsOffset,
      Math.round(captions.durationMs / 1000),
      (performance.now() - scheduleStart).toFixed(1),
    );
    this.#captionTimeline = [
      ...this.#captionTimeline,
      {
        startPts: ptsOffset,
        durationPts: captions.durationMs * 90,
        framePts: 90_000 / captions.frameRate,
        schedule,
        language: captions.language,
        rateMismatchLogged: false,
      },
    ].slice(-CaptionTimelineLength);
  }

  // A program's captions stop where the next program, planned to run for
  // `plannedPts`, starts on the output clock. A transcode advances
  // transcodedUntil by its planned length before ffmpeg runs, so when ffmpeg
  // stops early (a crash, or a file shorter than its recorded duration) the
  // next item starts inside the earlier program's window. Without this, an
  // item that adds no captions (a gap, an error screen, a commercial without
  // subtitles) would carry the earlier program's remaining dialogue. Only
  // frames from the new start on change: they are the new program's.
  private endCaptionsAt(pts: number, plannedPts: number) {
    // Starts inside the new program's planned span: the clock went back to
    // SessionStartPts, because the last segment couldn't be read, and the new
    // program will reuse these timestamps
    const inNewProgram = (startPts: number) => {
      const ahead = ptsSince(pts, startPts);
      return ahead > 0 && ahead < plannedPts;
    };
    let cut = false;
    for (const entry of this.#captionTimeline) {
      const offset = ptsSince(entry.startPts, pts);
      if (offset < entry.durationPts) {
        entry.durationPts = offset;
        cut = true;
      } else if (inNewProgram(entry.startPts)) {
        entry.durationPts = 0;
        cut = true;
      }
    }
    // A program cut to nothing would only take a place a program whose
    // segments are still being served needs
    this.#captionTimeline = this.#captionTimeline.filter(
      (entry) => entry.durationPts > 0,
    );
    this.#captionCuts = this.#captionCuts.filter(
      (cutPts) => cutPts !== pts && !inNewProgram(cutPts),
    );
    if (cut) {
      this.#captionCuts = [...this.#captionCuts, pts].slice(
        -CaptionTimelineLength,
      );
    }
  }

  private captionEntryAt(pts: number) {
    for (let i = this.#captionTimeline.length - 1; i >= 0; i--) {
      const entry = this.#captionTimeline[i];
      if (!entry) continue;
      const offset = ptsSince(entry.startPts, pts);
      if (offset < entry.durationPts) {
        return { entry, timeMs: (entry.startPts + offset) / 90 };
      }
    }
    return;
  }

  /**
   * A video segment with CEA-608 captions added for the .ts stream that
   * HDHomeRun clients read. Every frame carries caption data (null padding
   * when nothing is being said), so clients always find the caption track.
   * Undefined when the segment can't be captioned; serve it as it is.
   */
  async captionedSegment(file: string): Promise<Buffer | undefined> {
    const readStart = performance.now();
    const segment = await fs.readFile(path.join(this.workingDirectory, file));
    const readMs = performance.now() - readStart;

    // Synchronous, in the segment request's handler, once per viewer
    const rewriteStart = performance.now();
    const captioned = insertCaptions(segment, {
      language: (ptsInOrder) => this.captionLanguage(ptsInOrder[0]),
      pairsForFrames: (ptsInOrder) => this.captionPairs(ptsInOrder),
    });
    const rewriteMs = performance.now() - rewriteStart;
    if (!captioned.ok) {
      // Once per kind of refusal: the reason can name a byte offset or a
      // counter that differs from segment to segment
      if (!this.#captionRefusals.has(captioned.kind)) {
        this.#captionRefusals.add(captioned.kind);
        this.logger.warn(
          'Serving segment %s without captions: %s',
          file,
          captioned.reason,
        );
      }
      return;
    }
    this.#captionRewrites = {
      count: this.#captionRewrites.count + 1,
      totalMs: this.#captionRewrites.totalMs + rewriteMs,
      maxMs: Math.max(this.#captionRewrites.maxMs, rewriteMs),
    };
    this.logger.debug(
      'Captioned segment %s: %d bytes, %d frames, read %s ms, rewrite %s ms',
      file,
      segment.length,
      captioned.framesCaptioned,
      readMs.toFixed(1),
      rewriteMs.toFixed(1),
    );
    return captioned.segment;
  }

  // The language a segment's PMT names: that of the program its first frame
  // belongs to, so a client still fetching one program's last segments after
  // the next one started gets them in their own language. The first language
  // preference when no program's captions cover the frame.
  private captionLanguage(firstPts: number | undefined): string {
    const entry =
      firstPts === undefined ? undefined : this.captionEntryAt(firstPts)?.entry;
    return (
      entry?.language ??
      this.settingsDB.ffmpegSettings().languagePreferences.preferences[0]
        ?.iso6392 ??
      'eng'
    );
  }

  // The caption pair for each of a segment's frames, in presentation order
  private captionPairs(ptsInOrder: readonly number[]): CcPair[] {
    const pairs: CcPair[] = ptsInOrder.map(() => PaddingPair);
    // Frames no program's captions cover
    const uncovered: { index: number; pts: number }[] = [];
    // Each program's frames in this segment: their places, PTS and times
    const byEntry = new Map<
      CaptionTimelineEntry,
      { index: number; pts: number; timeMs: number }[]
    >();
    ptsInOrder.forEach((pts, index) => {
      const hit = this.captionEntryAt(pts);
      if (hit) {
        let frames = byEntry.get(hit.entry);
        if (!frames) {
          frames = [];
          byEntry.set(hit.entry, frames);
        }
        frames.push({ index, pts, timeMs: hit.timeMs });
      } else {
        uncovered.push({ index, pts });
      }
    });

    // Where a program's captions were cut short, what it left on screen is
    // erased by the first two frames after the cut that no captions cover.
    // An item with captions of its own replaces it with its first caption.
    for (const cut of this.#captionCuts) {
      uncovered
        .filter((f) => ptsSince(cut, f.pts) < CaptionCutClearPts)
        .slice(0, 2)
        .forEach((f) => {
          pairs[f.index] = EraseDisplayedMemory;
        });
    }

    for (const [entry, frames] of byEntry) {
      // The schedule assumes the program's frame rate. If the frames are
      // spaced differently, characters would be dropped or repeated, so send
      // padding only.
      const steps = frames
        .slice(1)
        .map((f, i) => f.pts - (frames[i]?.pts ?? f.pts));
      const step = steps.toSorted((a, b) => a - b)[
        Math.floor(steps.length / 2)
      ];
      if (
        step !== undefined &&
        Math.abs(step - entry.framePts) > entry.framePts / 100
      ) {
        if (!entry.rateMismatchLogged) {
          entry.rateMismatchLogged = true;
          this.logger.warn(
            'Frames are %d ticks apart but captions were laid out for %d; sending this program without caption text',
            step,
            Math.round(entry.framePts),
          );
        }
        continue;
      }
      const programPairs = pairsForFrames(
        entry.schedule,
        frames.map((f) => f.timeMs),
      );
      frames.forEach((f, k) => {
        pairs[f.index] = programPairs[k] ?? PaddingPair;
      });
    }
    return pairs;
  }

  protected getHlsOptions(): DeepRequired<HlsOptions> {
    const hlsTime =
      this.sessionOptions.streamMode === 'hls'
        ? (this.sessionOptions.segmentSeconds ?? 4)
        : 4;
    return {
      hlsDeleteThreshold: 3,
      streamNameFormat: 'stream.m3u8',
      subtitleStreamNameFormat: 'subs.m3u8',
      segmentNameFormat: BaseHlsSession.SegmentNameFormat,
      segmentBaseDirectory: dirname(this.workingDirectory),
      streamBasePath: basename(this.workingDirectory),
      streamBaseUrl: `/stream/channels/${this.channel.uuid}/${this.sessionType}/`,
      hlsTime,
      // stream.m3u8 lists the last 15 minutes of segments, so ffmpeg's cost
      // of rewriting it after each segment and of reading it back in at each
      // program start stays the same however long the session runs
      // (plans/hls-playlist-growth-2026-10-19.md). #playlistReader keeps the
      // session's history. A longer staleness gets a longer window.
      hlsListSize: hlsPlaylistWindowSize(
        hlsTime,
        this.sessionOptions.stalenessMs,
      ),
      deleteThreshold: null,
      appendSegments: true,
    };
  }

  private getProgramStream(
    context: PlayerContext,
    ptsOffset: Maybe<number>,
    subtitleSegmentStartNumber: Maybe<number>,
  ) {
    const hlsOptions = this.getHlsOptions();

    const outputFormat =
      this.sessionType === 'hls_direct_v2'
        ? HlsDirectOutputFormat(hlsOptions)
        : HlsOutputFormat(hlsOptions);

    return this.programStreamFactory(context, outputFormat, {
      ptsOffset,
      isFirstTranscode: this.#isFirstTranscode,
      captionsEnabled: this.captionsEnabled,
      subtitleSegmentStartNumber,
    });
  }

  private async getPtsOffset() {
    const lastSegment = await this.getLastSegment();

    if (!lastSegment) {
      if (!this.#isFirstTranscode) {
        this.logger.debug(
          'No last segment found. Starting with PTS offset %d.',
          SessionStartPts,
        );
      }
      return SessionStartPts;
    }

    const result = await new GetLastPtsDurationTask(this.settingsDB).run(
      lastSegment,
    );

    if (result.isFailure()) {
      this.logger.error(result.error);
      return SessionStartPts;
    }

    const { pts, duration } = result.get();

    return pts + duration + 1;
  }

  private async getLastSegment() {
    const workingDirectoryFiles = await Result.attemptAsync(() =>
      fs.readdir(this._workingDirectory),
    );

    if (workingDirectoryFiles.isFailure()) {
      this.logger.error(workingDirectoryFiles.error);
      return;
    }

    if (workingDirectoryFiles.get().length === 0) {
      return;
    }

    const p = last(
      sortBy(
        filter(
          workingDirectoryFiles.get(),
          (f) => extname(f) === '.ts' || extname(f) === '.mp4',
        ),
      ),
    );

    if (p) {
      return path.join(this._workingDirectory, p);
    }

    return;
  }

  private async getLastSubtitleSegmentNumber(): Promise<number> {
    const workingDirectoryFiles = await Result.attemptAsync(() =>
      fs.readdir(this._workingDirectory),
    );

    if (workingDirectoryFiles.isFailure()) {
      this.logger.error(workingDirectoryFiles.error);
      return 0;
    }

    const numbers = seq.collect(
      filter(workingDirectoryFiles.get(), (f) => extname(f) === '.vtt'),
      (file) => {
        const matches = file.match(SegmentNameRegex);
        if (!matches || matches.length < 2) {
          return;
        }
        const n = parseInt(matches[1]!);
        return isNaN(n) ? undefined : n;
      },
    );

    if (isEmpty(numbers)) {
      return 0;
    }

    return Math.max(...numbers) + 1;
  }

  isStale(): boolean {
    const remainingConnections = this.removeStaleConnections();
    return isEmpty(remainingConnections);
  }

  private get _subtitlePlaylistPath() {
    return path.join(
      this._workingDirectory,
      this.getHlsOptions().subtitleStreamNameFormat,
    );
  }

  private async readPlaylist() {
    if (!(await fileExists(this._m3u8PlaylistPath))) {
      return;
    }

    const playlistContents = await fs.readFile(this._m3u8PlaylistPath, {
      encoding: 'utf-8',
    });

    return playlistContents.toString().split('\n');
  }

  private async readSubtitlePlaylist() {
    if (!(await fileExists(this._subtitlePlaylistPath))) {
      return;
    }

    const playlistContents = await fs.readFile(this._subtitlePlaylistPath, {
      encoding: 'utf-8',
    });

    return playlistContents.toString().split('\n');
  }

  private async deleteOldSegmentFiles(
    sequenceNum: number,
    extensions: string[],
  ) {
    const workingDirectoryFiles = await fs.readdir(this._workingDirectory);
    const segments = filter(
      seq.collect(
        filter(workingDirectoryFiles, (f) => extensions.includes(extname(f))),
        (file) => {
          const matches = file.match(SegmentNameRegex);
          if (!matches || matches.length < 2) {
            return;
          }
          const n = parseInt(matches[1]!);
          if (isNaN(n)) {
            return;
          }
          return {
            file,
            seq: n,
          };
        },
      ),
      ({ seq }) => seq < sequenceNum,
    );

    if (segments.length > 0) {
      this.logger.trace(
        'Deleting %d segments. Max segment number: %d',
        segments.length,
        maxBy(segments, (seg) => seg.seq)?.seq ?? 0,
      );
    }

    for (const { file } of segments) {
      try {
        await fs.unlink(path.join(this._workingDirectory, file));
      } catch (e) {
        this.logger.error(e);
      }
    }
  }

  protected async stopStream(options: StopOptions): Promise<void> {
    if (this.#currentSession) {
      this.#currentSession.kill();
      await this.waitForExit(this.#currentSession, options);
    }

    this.logger.debug(
      `Cleaning out stream path for session: %s`,
      this._workingDirectory,
    );

    return await this.cleanupDirectory();
  }
}
