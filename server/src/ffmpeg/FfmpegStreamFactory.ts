import { droppedCaptionCharacters } from '../stream/captions/Cea608Encoder.ts';
import { streamMatchesLanguage } from './StreamSelectionEvaluator.ts';
import fs from 'node:fs/promises';
import type { DecodedSubtitleFile } from '../stream/captions/decodeSubtitleText.ts';
import { decodeSubtitleFile } from '../stream/captions/decodeSubtitleText.ts';
import type {
  ISettingsDB,
  ReadableFfmpegSettings,
} from '@/db/interfaces/ISettingsDB.js';
import type { ChannelOrm } from '@/db/schema/Channel.js';
import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import {
  HardwareAccelerationMode,
  libvaDriverName,
} from '@/db/schema/TranscodeConfig.js';
import { InfiniteLoopInputOption } from '@/ffmpeg/builder/options/input/InfiniteLoopInputOption.js';
import type {
  AudioRenditionInfo,
  StreamDetails,
  StreamRenditions,
  SubtitleRenditionInfo,
  SubtitleStreamDetails,
} from '@/stream/types.js';
import { FileStreamSource, HttpStreamSource } from '@/stream/types.js';
import type { Maybe, Nullable } from '@/types/util.js';
import { isDefined, isLinux, isNonEmptyString } from '@/util/index.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import { makeLocalUrl } from '@/util/serverUtil.js';
import { channelHasOwnCaptionLook } from '@tunarr/shared/util';
import type {
  ChannelStreamMode,
  LoudnormConfig,
  Watermark,
} from '@tunarr/types';
import { ChannelStreamModes } from '@tunarr/types';
import dayjs from 'dayjs';
import type { Duration } from 'dayjs/plugin/duration.js';
import { injectable } from 'inversify';
import { isUndefined } from 'lodash-es';
import { basename } from 'node:path';
import type { DeepReadonly } from 'ts-essentials';
import { match, P } from 'ts-pattern';
import type { ContentBackedStreamLineupItem } from '../db/derived_types/StreamLineup.ts';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import { FeatureFlagService } from '../services/FeatureFlagService.ts';
import { captionTestPattern } from '../stream/captions/CaptionTestPattern.ts';
import { hdhrCaptionsEnabled } from '../stream/captions/hdhrCaptionsEnabled.ts';
import {
  channelCaptionAppearance,
  channelCaptionTestPattern,
} from '../stream/captions/channelCaptions.ts';
import type { ProgramCaptions } from '../stream/captions/ProgramCaptions.ts';
import {
  loadProgramCaptions,
  captionTrackCandidates,
  noCaptionsNotice,
} from '../stream/captions/ProgramCaptions.ts';
import { isImageBasedSubtitle } from '../stream/util.ts';
import { KEYS } from '../types/inject.ts';
import { assisted, injected } from '../util/assistedInject.ts';
import { InjectLogger } from '../util/inject.ts';
import { loggingDef } from '../util/logging/loggingDef.ts';
import type { FfmpegPlaybackParams } from './FfmpegPlaybackParamsCalculator.ts';
import { FfmpegPlaybackParamsCalculator } from './FfmpegPlaybackParamsCalculator.ts';
import { FfmpegProcess } from './FfmpegProcess.ts';
import { FfmpegTranscodeSession } from './FfmpegTrancodeSession.ts';
import { StreamSelector } from './StreamSelector.ts';
import { audioTrackSlots, pickSlotAudioStreams } from './AudioTrackLayout.ts';
import { SubtitleStreamPicker } from './SubtitleStreamPicker.ts';
import {
  AudioStream,
  EmbeddedSubtitleStream,
  ExternalSubtitleStream,
  StillImageStream,
  SubtitleMethods,
  VideoStream,
} from './builder/MediaStream.ts';
import type { OutputFormat } from './builder/constants.ts';
import {
  AudioFormats,
  MpegTsOutputFormat,
  OutputFormatTypes,
  VideoFormats,
} from './builder/constants.ts';
import { ColorFormat } from './builder/format/ColorFormat.ts';
import type { PixelFormat } from './builder/format/PixelFormat.ts';
import {
  KnownPixelFormats,
  PixelFormatUnknown,
  PixelFormatYuv420P,
  PixelFormatYuv420P10Le,
} from './builder/format/PixelFormat.ts';
import {
  AudioInputFilterSource,
  AudioInputSource,
  NullAudioInputSource,
} from './builder/input/AudioInputSource.ts';
import { ConcatInputSource } from './builder/input/ConcatInputSource.ts';
import { LavfiVideoInputSource } from './builder/input/LavfiVideoInputSource.ts';
import { SubtitlesInputSource } from './builder/input/SubtitlesInputSource.ts';
import type { StreamSource as PipelineStreamSource } from './builder/input/InputSource.ts';
import { VideoInputSource } from './builder/input/VideoInputSource.ts';
import { WatermarkInputSource } from './builder/input/WatermarkInputSource.ts';
import type { Pipeline } from './builder/pipeline/Pipeline.ts';
import type { PipelineBuilderFactory } from './builder/pipeline/PipelineBuilderFactory.ts';
import { GapMusicLoudnorm } from './builder/filter/LoudnormFilter.ts';
import { NowPlayingTextFilter } from './builder/filter/NowPlayingTextFilter.ts';
import type { AudioFades } from './builder/state/AudioState.ts';
import { AudioState } from './builder/state/AudioState.ts';
import type {
  AudioCodecOverride,
  PipelineOptions,
} from './builder/state/FfmpegState.ts';
import {
  DefaultPipelineOptions,
  FfmpegState,
} from './builder/state/FfmpegState.ts';
import { FrameState } from './builder/state/FrameState.ts';
import { FrameSize } from './builder/types.ts';
import type {
  ConcatOptions,
  OfflineBackgroundMusic,
  OfflineNowPlaying,
  PlaceholderSessionOpts,
  StreamSessionCreateArgs,
  TranscodeSessionResult,
} from './types.ts';
import { FfmpegInfo } from './ffmpegInfo.ts';

const GapMusicFadeInMs = 1000;
const GapMusicFadeOutMs = 3000;

// Fade gap music in, and out over the item's last seconds when the item ends
// before the track does (the gap is over, or the 10-minute item cap).
export function gapMusicFades(itemMs: number, trackMs: number): AudioFades {
  const cutShort = itemMs < trackMs - 500;
  return {
    fadeInMs: Math.min(GapMusicFadeInMs, itemMs),
    fadeOut: cutShort
      ? {
          startMs: Math.max(0, itemMs - GapMusicFadeOutMs),
          durationMs: Math.min(GapMusicFadeOutMs, itemMs),
        }
      : null,
  };
}

@injectable()
@loggingDef({ category: 'streaming' })
export class FfmpegStreamFactory {
  @InjectLogger() declare private readonly logger: Logger;

  // The ffmpeg executable last found without a drawtext filter, so the
  // warning is given once per executable rather than per placeholder. Cleared
  // when an ffmpeg with drawtext is used, so switching to another ffmpeg and
  // back to this one warns again.
  private static missingDrawtextWarnedFor: string | undefined;

  /** Forgets which ffmpeg the missing-drawtext warning was given for. */
  static resetMissingDrawtextWarning(): void {
    FfmpegStreamFactory.missingDrawtextWarnedFor = undefined;
  }

  private readonly ffmpegSettings: ReadableFfmpegSettings;

  constructor(
    @injected(FfmpegInfo) private ffmpegInfo: FfmpegInfo,
    @injected(KEYS.SettingsDB) private settingsDB: ISettingsDB,
    @injected(KEYS.PipelineBuilderFactory)
    private pipelineBuilderFactory: PipelineBuilderFactory,
    @injected(KEYS.ChannelDB) private channelDB: IChannelDB,
    @injected(FeatureFlagService)
    private featureFlagService: FeatureFlagService,
    @injected(StreamSelector) private streamSelector: StreamSelector,
    @assisted private transcodeConfig: TranscodeConfigOrm,
    @assisted private channel: ChannelOrm,
  ) {
    this.ffmpegSettings = this.settingsDB.ffmpegSettings();
  }

  async createConcatSession(
    streamUrl: string,
    opts: DeepReadonly<ConcatOptions>,
  ): Promise<FfmpegTranscodeSession> {
    if (
      opts.mode === 'hls_concat' ||
      opts.mode === 'hls_direct_concat' ||
      opts.mode === 'hls_direct_v2_concat'
    ) {
      return this.createHlsWrapperSession(streamUrl, opts);
    }

    const concatInput = new ConcatInputSource(
      new HttpStreamSource(streamUrl),
      FrameSize.create({
        height: this.transcodeConfig.resolution.heightPx,
        width: this.transcodeConfig.resolution.widthPx,
      }),
    );

    if (opts.mode === 'hls_slower_concat') {
      return this.createHlsSlowerConcatSession(concatInput, {
        outputFormat: opts.outputFormat,
        mode: 'hls_slower_concat',
      });
    }

    const pipelineBuilder = await this.pipelineBuilderFactory(
      this.transcodeConfig,
    )
      .setConcatInputSource(concatInput)
      .build();

    const concatState = FfmpegState.forConcat(
      await this.ffmpegInfo.getVersion(),
      this.channel.name,
    );
    // ffmpeg's own pick would keep one of the layout's audio tracks
    concatState.mapAllStreams = this.audioSlots.length > 0;
    const pipeline = pipelineBuilder.concat(concatInput, concatState);

    return this.wrapInSession(
      pipeline,
      `channel-${this.channel.number}-concat`,
      dayjs.duration(-1),
    );
  }

  private async createHlsWrapperSession(
    streamUrl: string,
    opts: DeepReadonly<ConcatOptions>,
  ): Promise<FfmpegTranscodeSession> {
    const concatInput = new ConcatInputSource(
      new HttpStreamSource(streamUrl),
      FrameSize.create({
        height: this.transcodeConfig.resolution.heightPx,
        width: this.transcodeConfig.resolution.widthPx,
      }),
    );

    const pipelineBuilder = await this.pipelineBuilderFactory(
      this.transcodeConfig,
    )
      .setConcatInputSource(concatInput)
      .build();

    const state = FfmpegState.forConcat(
      await this.ffmpegInfo.getVersion(),
      this.channel.name,
      opts.outputFormat,
    );
    state.readrateInitialBurstSeconds =
      this.ffmpegSettings.hlsTsInitialBurstSeconds;
    const pipeline = pipelineBuilder.hlsWrap(concatInput, state);

    return this.wrapInSession(
      pipeline,
      `channel-${this.channel.number}-concat`,
      dayjs.duration(-1),
    );
  }

  private async createHlsSlowerConcatSession(
    concatInput: ConcatInputSource,
    opts: DeepReadonly<ConcatOptions>,
  ): Promise<FfmpegTranscodeSession> {
    const calculator = new FfmpegPlaybackParamsCalculator(
      this.transcodeConfig,
      this.channel.streamMode,
    );
    const playbackParams = calculator.calculateForHlsConcat();

    const videoStream = VideoStream.create({
      index: 0,
      codec: VideoFormats.Raw,
      pixelFormat: new PixelFormatYuv420P(), // Hard-coded right now
      frameSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
      providedSampleAspectRatio: '1:1',
      displayAspectRatio: '1:1',
      inputKind: 'video',
      colorFormat: ColorFormat.bt709,
    });

    const videoInputSource = VideoInputSource.withStream(
      concatInput.source,
      videoStream,
    );

    // The joined programs carry one audio track, or one per slot of the
    // channel's audio track layout, right after the video
    const slots = this.audioSlots;
    const audioStreams =
      slots.length > 0
        ? slots.map((language, i) =>
            AudioStream.create({
              index: 1 + i,
              codec: '', // Unknown
              channels: this.transcodeConfig.audioChannels,
              language,
            }),
          )
        : [
            AudioStream.create({
              index: 1,
              codec: '', // Unknown
              channels: this.transcodeConfig.audioChannels,
            }),
          ];

    const audioInputSource = new AudioInputSource(
      concatInput.source,
      audioStreams,
      this.createAudioState(playbackParams, null),
    );

    const pipelineBuilder = await this.pipelineBuilderFactory(
      this.transcodeConfig,
    )
      .setHardwareAccelerationMode(
        this.transcodeConfig.hardwareAccelerationMode,
      )
      .setVideoInputSource(videoInputSource)
      .setAudioInputSource(audioInputSource)
      .setConcatInputSource(concatInput)
      .build();

    const pipeline = pipelineBuilder.build(
      FfmpegState.create({
        version: await this.ffmpegInfo.getVersion(),
        outputFormat: opts.outputFormat ?? MpegTsOutputFormat,
        metadataServiceProvider: 'Tunarr',
        metadataServiceName: this.channel.name,
        ptsOffset: 0,
        vaapiDevice: this.getVaapiDevice(),
        vaapiDriver: this.getVaapiDriver(),
        threadCount: this.transcodeConfig.threadCount,
      }),
      new FrameState({
        realtime: playbackParams.realtime,
        scaledSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
        paddedSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
        isAnamorphic: false,
        deinterlace: false,
        pixelFormat: new PixelFormatYuv420P(),
        frameRate: playbackParams.frameRate,
        videoBitrate: playbackParams.videoBitrate,
        videoBufferSize: playbackParams.videoBufferSize,
        videoTrackTimescale: playbackParams.videoTrackTimeScale,
        videoFormat: playbackParams.videoFormat,
        videoPreset: playbackParams.videoPreset ?? null,
      }),
      {
        ...DefaultPipelineOptions,
        encoderThreadCount: this.transcodeConfig.threadCount,
      },
    );

    pipeline.inputs.concatInput?.addOptions(
      ...(pipeline.inputs.videoInput?.inputOptions ?? []),
    );

    pipeline.setInputs({
      ...pipeline.inputs,
      videoInput: null,
      audioInput: null,
    });

    return this.wrapInSession(
      pipeline,
      'Concat Wrapper v2 FFmpeg',
      dayjs.duration(-1),
    );
  }

  async createStreamSession({
    // TODO Fix these dumb params
    stream: { source: streamSource, details: streamDetails },
    options: {
      ptsOffset,
      startTime,
      outputFormat,
      duration,
      realtime,
      watermark,
      streamMode,
      encoding,
      isFirstTranscode,
      emitEndList,
      captionsEnabled: sessionCaptionsEnabled,
      subtitleSegmentStartNumber,
    },
    lineupItem,
  }: StreamSessionCreateArgs): Promise<Maybe<TranscodeSessionResult>> {
    if (streamSource.type !== 'http' && streamSource.type !== 'file') {
      throw new Error('Unsupported stream source format: ' + streamSource.type);
    }

    const isRemux = encoding?.mode === 'remux';
    // Passthrough mode: copy all video/audio streams from the source without
    // re-encoding. Incompatible audio codecs get per-stream overrides.
    // Subtitles are still processed as WebVTT sidecar when available.
    const isPassthrough =
      isRemux || outputFormat.type === OutputFormatTypes.HlsDirectV2;
    const captionsOn =
      !isPassthrough && (sessionCaptionsEnabled ?? this.captionsOn(streamMode));
    const playbackParams = isPassthrough
      ? null
      : new FfmpegPlaybackParamsCalculator(
          this.transcodeConfig,
          streamMode ?? this.channel.streamMode,
        ).calculateForStream(streamDetails, {
          // Captions are laid out one pair per output frame, so the output's
          // rate must be known exactly
          pinFrameRate: captionsOn,
        });

    const { videoStream, videoInputSource } = this.buildVideoInput(
      streamSource,
      streamDetails,
    );

    // In copy-all mode, audio is handled by `-map 0:a` with per-stream codec
    // overrides — no AudioInputSource needed. Watermark is also skipped since
    // we're not re-encoding video.
    let audioInput: Nullable<AudioInputSource> = null;
    let watermarkSource: Nullable<WatermarkInputSource> = null;
    let subtitleSource: Nullable<SubtitlesInputSource> = null;
    let subtitleRendition: SubtitleRenditionInfo | undefined;
    let captions: ProgramCaptions | undefined;

    if (!isPassthrough) {
      ({
        audioInput,
        subtitleSource,
        subtitleRendition,
        watermarkSource,
        captions,
      } = await this.buildTranscodeInputs(
        streamSource,
        streamDetails,
        lineupItem,
        playbackParams!,
        { duration, startTime, streamMode, watermark, captionsOn },
      ));
    } else {
      ({ subtitleSource, subtitleRendition } =
        await this.buildPassthroughSubtitles(
          streamSource,
          streamDetails,
          lineupItem,
        ));
    }

    // For copy-all, use the source video's actual dimensions so no scaling or
    // padding filters are injected. For normal transcode, use the transcode
    // config's target resolution.
    const sourceFrameSize =
      isPassthrough && streamDetails.videoDetails
        ? FrameSize.create({
            height: streamDetails.videoDetails[0].height,
            width: streamDetails.videoDetails[0].width,
          })
        : null;

    const scaledSize =
      sourceFrameSize ??
      videoStream.squarePixelFrameSize(
        FrameSize.fromResolution(this.transcodeConfig.resolution),
      );

    const paddedSize =
      sourceFrameSize ??
      FrameSize.fromResolution(this.transcodeConfig.resolution);

    // Build per-stream audio codec overrides for copy-all mode.
    const audioCodecOverrides = isPassthrough
      ? this.buildAudioCodecOverrides(streamDetails)
      : [];

    const effectiveHwAccel = isPassthrough
      ? HardwareAccelerationMode.None
      : (playbackParams?.hwAccel ?? 'none');

    const builder = await this.pipelineBuilderFactory(this.transcodeConfig)
      .setHardwareAccelerationMode(effectiveHwAccel)
      .setVideoInputSource(videoInputSource)
      .setAudioInputSource(audioInput)
      .setWatermarkInputSource(watermarkSource)
      .setSubtitleInputSource(subtitleSource)
      .build();

    const pipelineOptions: PipelineOptions = isPassthrough
      ? DefaultPipelineOptions
      : {
          ...DefaultPipelineOptions,
          decoderThreadCount: this.transcodeConfig.threadCount,
          encoderThreadCount: this.transcodeConfig.threadCount,
          vaapiDevice: this.getVaapiDevice(),
          vaapiDriver: this.getVaapiDriver(),
          disableHardwareDecoding:
            this.transcodeConfig.disableHardwareDecoder ?? false,
          disableHardwareEncoding:
            this.transcodeConfig.disableHardwareEncoding ?? false,
          disableHardwareFilters:
            this.transcodeConfig.disableHardwareFilters ?? false,
        };

    const pipeline = builder.build(
      FfmpegState.create({
        version: await this.ffmpegInfo.getVersion(),
        start: startTime,
        duration,
        ptsOffset,
        isFirstTranscode,
        subtitleSegmentStartNumber,
        emitEndList: emitEndList ?? false,
        threadCount: isPassthrough ? 0 : this.transcodeConfig.threadCount,
        copyAllStreams: isPassthrough,
        audioCodecOverrides,
        outputFormat,
        softwareDeinterlaceFilter: isPassthrough
          ? undefined
          : this.ffmpegSettings.deinterlaceFilter,
        softwareScalingAlgorithm: isPassthrough
          ? undefined
          : this.ffmpegSettings.scalingAlgorithm,
        tonemapAlgorithm: isPassthrough
          ? undefined
          : this.ffmpegSettings.tonemapAlgorithm,
        vaapiDevice: isPassthrough ? null : this.getVaapiDevice(),
        vaapiDriver: isPassthrough ? null : this.getVaapiDriver(),
        logLevel: this.ffmpegSettings.logLevel,
      }),
      new FrameState({
        isAnamorphic: false,
        scaledSize,
        paddedSize,
        videoBitrate: isPassthrough ? undefined : playbackParams!.videoBitrate,
        videoBufferSize: isPassthrough
          ? undefined
          : playbackParams!.videoBufferSize,
        pixelFormat: isPassthrough
          ? new PixelFormatYuv420P()
          : (playbackParams!.pixelFormat ?? new PixelFormatYuv420P()),
        bitDepth: 8,
        frameRate: isPassthrough ? undefined : playbackParams!.frameRate,
        videoTrackTimescale: isPassthrough
          ? 90000
          : playbackParams!.videoTrackTimeScale,
        realtime,
        videoFormat: isPassthrough
          ? VideoFormats.Copy
          : playbackParams!.videoFormat,
        videoPreset: isPassthrough ? undefined : playbackParams!.videoPreset,
        videoProfile: null,
        deinterlace: isPassthrough ? false : playbackParams!.deinterlace,
        infiniteLoop: lineupItem.infiniteLoop,
      }),
      pipelineOptions,
    );

    const transcodeSession = this.wrapInSession(
      pipeline,
      `channel-${this.channel.number}-transcode`,
      duration,
    );

    return {
      session: transcodeSession,
      renditions: {
        ...this.buildRenditions(
          streamDetails,
          subtitleRendition,
          isPassthrough,
        ),
        captions:
          captions === undefined
            ? undefined
            : {
                ...captions,
                frameRate: pipeline.outputFrameRate ?? captions.frameRate,
              },
      },
    };
  }

  /**
   * Builds audio, subtitle, and watermark inputs for transcode mode.
   * In this mode, audio is selected via stream profiles and subtitles are
   * burned in.
   */
  private async buildTranscodeInputs(
    streamSource: HttpStreamSource | FileStreamSource,
    streamDetails: StreamDetails,
    lineupItem: ContentBackedStreamLineupItem,
    playbackParams: FfmpegPlaybackParams,
    options: {
      duration: Duration;
      startTime: Duration;
      streamMode: ChannelStreamMode;
      watermark?: Watermark;
      // This program gets HDHomeRun closed captions (see `captionsOn`)
      captionsOn: boolean;
    },
  ): Promise<{
    audioInput: Nullable<AudioInputSource>;
    subtitleSource: Nullable<SubtitlesInputSource>;
    subtitleRendition: SubtitleRenditionInfo | undefined;
    watermarkSource: Nullable<WatermarkInputSource>;
    captions: ProgramCaptions | undefined;
  }> {
    const { duration, startTime, streamMode, watermark, captionsOn } = options;

    const audioState = this.createAudioState(
      playbackParams,
      streamMode === ChannelStreamModes.HlsDirect
        ? null
        : duration.asMilliseconds(),
      this.transcodeConfig.audioLoudnormConfig,
    );

    let audioInput: Nullable<AudioInputSource> = null;
    let selectedSubtitle: SubtitleStreamDetails | undefined;

    // Stream selection via profiles (handles both audio and subtitles)
    if (isDefined(streamDetails.audioDetails)) {
      const { audioStream, subtitleStream } =
        await this.streamSelector.selectAudioAndSubtitleStreams({
          channel: this.channel,
          lineupItem,
          audioStreams: streamDetails.audioDetails,
          subtitleStreams: streamDetails.subtitleDetails ?? [],
        });

      selectedSubtitle = subtitleStream ?? undefined;

      // With the channel's audio track layout: the program's track for each
      // slot (its main track where it has none), tagged with the slot language
      const slots = this.audioSlots;
      const outputStreams =
        slots.length > 0
          ? pickSlotAudioStreams(
              slots,
              streamDetails.audioDetails,
              audioStream,
            ).map((stream, i) => {
              const language = slots[i];
              if (language && !streamMatchesLanguage(stream, language)) {
                this.logger.info(
                  {
                    channelId: this.channel.uuid,
                    requestedLanguage: language,
                    sourceLanguage: stream.languageCodeISO6392,
                    sourceIndex: stream.index,
                  },
                  'Audio language unavailable; repeating the main track to preserve the channel track layout',
                );
              }
              return AudioStream.create({
                index: stream.index,
                codec: stream.codec ?? 'unknown',
                channels: stream.channels ?? -2,
                language,
              });
            })
          : [
              AudioStream.create({
                index: audioStream.index,
                codec: audioStream.codec ?? 'unknown',
                channels: audioStream.channels ?? -2,
                language: audioStream.languageCodeISO6392,
              }),
            ];
      audioInput = new AudioInputSource(
        streamSource,
        outputStreams,
        audioState,
      );
    } else {
      audioInput = this.withAudioSlots(
        new NullAudioInputSource({
          ...audioState,
          audioDuration: duration.asMilliseconds(),
        }),
      );
    }

    const { subtitleSource, subtitleRendition, captions } =
      await this.buildTranscodeSubtitles(
        streamSource,
        streamDetails,
        lineupItem,
        selectedSubtitle,
        playbackParams.frameRate,
        { startTime, duration, captionsOn },
      );

    let watermarkSource: Nullable<WatermarkInputSource> = null;
    if (watermark?.enabled) {
      const watermarkUrl = watermark.url ?? makeLocalUrl('/images/tunarr.png');
      watermarkSource = new WatermarkInputSource(
        new HttpStreamSource(watermarkUrl),
        StillImageStream.create({
          frameSize: FrameSize.fromResolution({
            widthPx: watermark.width,
            heightPx: -1,
          }),
          index: 0,
        }),
        { ...watermark, url: watermarkUrl },
      );
    }

    return {
      audioInput,
      subtitleSource,
      subtitleRendition,
      watermarkSource,
      captions,
    };
  }

  private async buildTranscodeSubtitles(
    streamSource: HttpStreamSource | FileStreamSource,
    streamDetails: StreamDetails,
    lineupItem: ContentBackedStreamLineupItem,
    subtitleStream: SubtitleStreamDetails | undefined,
    frameRate: number | undefined,
    options: { startTime: Duration; duration: Duration; captionsOn: boolean },
  ): Promise<{
    subtitleSource: Nullable<SubtitlesInputSource>;
    subtitleRendition: SubtitleRenditionInfo | undefined;
    captions: ProgramCaptions | undefined;
  }> {
    const { startTime, duration, captionsOn } = options;
    let subtitleSource: Nullable<SubtitlesInputSource> = null;
    let subtitleRendition: SubtitleRenditionInfo | undefined;
    let captions: ProgramCaptions | undefined;
    const attemptedCaptionPaths = new Set<string>();

    if (subtitleStream && this.channel.subtitlesEnabled) {
      this.logger.trace('Using subtitle stream: %O', subtitleStream);

      const sidecarEnabled = this.featureFlagService.get(
        'webvttSidecarEnabled',
      );
      const canUseSidecar = !isImageBasedSubtitle(subtitleStream.codec);
      // With captions, full text subtitles become switchable captions (and
      // WebVTT for HLS players) instead of being burned in; forced ones stay.
      // If they can't be read as captions, they're burned in as before.
      const captionCandidate =
        captionsOn && canUseSidecar && !subtitleStream.forced;
      // The file as read for captions, so finding its charset for ffmpeg
      // below doesn't read it again
      let subtitleFile: DecodedSubtitleFile | undefined;
      if (captionCandidate) {
        if (subtitleStream.path) attemptedCaptionPaths.add(subtitleStream.path);
        const loaded = await this.loadCaptions(subtitleStream, frameRate, {
          startTime,
          duration,
        });
        captions = loaded.captions;
        subtitleFile = loaded.file;
      }
      // A caption candidate that didn't load as captions (no frame rate, a
      // read error, or more than 10% of its cues beyond CEA-608) is burned in,
      // even with the WebVTT sidecar flag on: as WebVTT alone it would reach
      // Tunarr's own HLS players, but HDHomeRun viewers (Plex) would get no
      // subtitles at all. This is deliberate.
      const useSidecar =
        ((sidecarEnabled && !captionCandidate) || captions !== undefined) &&
        canUseSidecar;
      const method = useSidecar
        ? SubtitleMethods.Convert
        : SubtitleMethods.Burn;

      // External subtitles are always resolved to a local file before they
      // get here -- downloaded during scanning, or read from storage shared
      // with the media source.
      const source = match(subtitleStream.path)
        .with(P.string, (path) => new FileStreamSource(path))
        .otherwise(() => streamSource);

      // If the subtitle source differs from the video source, the
      // subtitle lives in a separate file (e.g. an extracted .srt) and
      // must be treated as external regardless of the declared type.
      const isExternal =
        subtitleStream.type === 'external' || source !== streamSource;

      const stream = isExternal
        ? new ExternalSubtitleStream(subtitleStream.codec, method)
        : new EmbeddedSubtitleStream(
            subtitleStream.codec,
            subtitleStream.index ?? 0,
            method,
          );

      if (stream) {
        subtitleSource = new SubtitlesInputSource(source, [stream], method);
        if (isExternal && canUseSidecar && subtitleStream.path) {
          // Read here only when captions didn't already read it
          subtitleFile ??= await fs
            .readFile(subtitleStream.path)
            .then(decodeSubtitleFile, () => undefined);
          if (subtitleFile) {
            subtitleSource.characterEncoding = subtitleFile.characterEncoding;
          }
        }

        if (useSidecar) {
          subtitleRendition = {
            language: subtitleStream.languageCodeISO6392 ?? 'und',
            languageName: subtitleStream.language,
            default: subtitleStream.default,
            forced: subtitleStream.forced,
            title: subtitleStream.title,
          };
        }
      }
    }

    // Otherwise caption from the program's full text track, if it has one
    // (e.g. English audio whose forced subtitles are burned in)
    if (captionsOn && captions === undefined) {
      for (const candidate of captionTrackCandidates(
        streamDetails.subtitleDetails ?? [],
        this.ffmpegSettings.languagePreferences.preferences,
      )) {
        // Embedded tracks are read from their extracted copy, as burn-in does
        const track =
          candidate.path === undefined && candidate.type === 'embedded'
            ? await SubtitleStreamPicker.getSubtitleDetailsWithExtractedPath(
                lineupItem,
                candidate,
              )
            : candidate;
        if (track?.path === undefined) {
          continue;
        }
        if (attemptedCaptionPaths.has(track.path)) continue;
        attemptedCaptionPaths.add(track.path);
        captions = (
          await this.loadCaptions(track, frameRate, {
            startTime,
            duration,
          })
        ).captions;
        if (captions) {
          break;
        }
      }
    }

    // A program with no subtitles at all gets a short notice instead, so a
    // viewer who turns captions on can tell they work
    if (captionsOn && captions === undefined) {
      captions = noCaptionsNotice(lineupItem, {
        subtitles: streamDetails.subtitleDetails ?? [],
        durationMs: duration.asMilliseconds(),
        frameRate: frameRate,
        // The first preferred language, the .ts stream's caption label
        language:
          this.ffmpegSettings.languagePreferences.preferences[0]?.iso6392 ??
          'eng',
        appearance: channelCaptionAppearance(
          this.ffmpegSettings,
          this.channel.captions,
        ),
      });
    }

    // The caption test pattern replaces what the program would show, to see
    // which appearance features a player honours. Burn-in is left as it is.
    if (
      captionsOn &&
      captions &&
      channelCaptionTestPattern(this.ffmpegSettings, this.channel.captions)
    ) {
      captions = captionTestPattern(captions);
    }

    // A channel with its own caption look: the look this program's captions
    // are laid out in, the global settings with the channel's over them.
    // Without one they use the global settings, as before.
    if (captions && channelHasOwnCaptionLook(this.channel.captions)) {
      captions = {
        ...captions,
        appearance: channelCaptionAppearance(
          this.ffmpegSettings,
          this.channel.captions,
        ),
      };
    }

    return { subtitleSource, subtitleRendition, captions };
  }

  // Captions go into the .ts stream HDHomeRun clients read, which wraps an
  // HLS session; other modes keep today's subtitles. Captions can only be added
  // to H.264 video, so a transcode config with another video format keeps
  // today's subtitles too, rather than losing both them and the captions. The
  // .ts wrapper (ConcatStream) decides with the same rule, and logs once per
  // tune-in when the video format rules captions out. This factory is made per
  // program, so it says nothing.
  private captionsOn(streamMode: ChannelStreamMode | undefined): boolean {
    return hdhrCaptionsEnabled({
      hdhrClosedCaptions: this.ffmpegSettings.hdhrClosedCaptions,
      streamMode,
      subtitlesEnabled: this.channel.subtitlesEnabled,
      // The format an HLS program is encoded in (FfmpegPlaybackParamsCalculator)
      videoFormat: this.transcodeConfig.videoFormat,
    });
  }

  // A subtitle track's cues on the program's clock, for captions laid out at
  // the output's frame rate (pinned whenever captions are on), and the
  // track's file as read and decoded, for the caller to reuse
  private async loadCaptions(
    track: SubtitleStreamDetails | undefined,
    frameRate: number | undefined,
    program: { startTime: Duration; duration: Duration },
  ): Promise<{
    captions: ProgramCaptions | undefined;
    file: DecodedSubtitleFile | undefined;
  }> {
    if (!track) {
      return { captions: undefined, file: undefined };
    }
    if (frameRate === undefined) {
      this.logger.debug('No frame rate for this program; no captions');
      return { captions: undefined, file: undefined };
    }
    // Read and parsed before the program's ffmpeg starts, so a viewer tuning
    // in waits for it
    const readStart = performance.now();
    let file: DecodedSubtitleFile | undefined;
    try {
      if (track.path !== undefined) {
        file = decodeSubtitleFile(await fs.readFile(track.path));
      }
      const captions = await loadProgramCaptions(
        track,
        {
          seekMs: program.startTime.asMilliseconds(),
          durationMs: program.duration.asMilliseconds(),
          frameRate,
        },
        file,
      );
      if (captions && captions.cues.length > 0) {
        const losses = captions.cues.map((cue) =>
          droppedCaptionCharacters(cue.text),
        );
        const damagedCues = losses.filter((count) => count > 0).length;
        if (damagedCues / captions.cues.length > 0.1) {
          this.logger.warn(
            {
              droppedCharacters: losses.reduce(
                (total, count) => total + count,
                0,
              ),
              affectedCues: damagedCues,
              totalCues: captions.cues.length,
            },
            'CEA-608 cannot represent more than 10% of this track’s cues; keeping subtitles for burn-in instead',
          );
          return { captions: undefined, file };
        }
      }
      if (track.path !== undefined) {
        this.logger.debug(
          'Read subtitles %s for captions in %s ms: %d cues in this program',
          basename(track.path),
          (performance.now() - readStart).toFixed(1),
          captions?.cues.length ?? 0,
        );
      }
      return { captions, file };
    } catch (e) {
      this.logger.warn(
        e,
        'Could not read subtitles %s for captions',
        track.path,
      );
      return { captions: undefined, file };
    }
  }

  /**
   * Builds subtitle inputs for passthrough (copy-all) mode.
   * In this mode, only sidecar (Convert) subtitles are available since we're
   * not re-encoding video for burn-in.
   */
  private async buildPassthroughSubtitles(
    streamSource: HttpStreamSource | FileStreamSource,
    streamDetails: StreamDetails,
    lineupItem: ContentBackedStreamLineupItem,
  ): Promise<{
    subtitleSource: Nullable<SubtitlesInputSource>;
    subtitleRendition: SubtitleRenditionInfo | undefined;
  }> {
    let subtitleSource: Nullable<SubtitlesInputSource> = null;
    let subtitleRendition: SubtitleRenditionInfo | undefined;

    if (
      isDefined(streamDetails.subtitleDetails) &&
      this.channel.subtitlesEnabled
    ) {
      const subtitlePreferences =
        await this.channelDB.getChannelSubtitlePreferences(this.channel.uuid);

      const pickedSubtitleStream = await SubtitleStreamPicker.pickSubtitles(
        subtitlePreferences,
        lineupItem,
        streamDetails.subtitleDetails,
        // In passthrough mode, always prefer text-based subs for sidecar
        // since burn-in is not available.
        { preferTextBased: true },
      );

      if (pickedSubtitleStream) {
        this.logger.trace('Using subtitle stream: %O', pickedSubtitleStream);

        // Skip image-based subtitles since they can't be converted to
        // WebVTT and burn-in is not possible without re-encoding.
        if (!isImageBasedSubtitle(pickedSubtitleStream.codec)) {
          const source = match(pickedSubtitleStream.path)
            .with(P.string, (path) => new FileStreamSource(path))
            .otherwise(() => streamSource);

          const stream = match(pickedSubtitleStream.type)
            .with(
              'embedded',
              () =>
                new EmbeddedSubtitleStream(
                  pickedSubtitleStream.codec,
                  pickedSubtitleStream.index ?? 0,
                  SubtitleMethods.Convert,
                ),
            )
            .with(
              'external',
              () =>
                new ExternalSubtitleStream(
                  pickedSubtitleStream.codec,
                  SubtitleMethods.Convert,
                ),
            )
            .otherwise(() => null);

          if (stream) {
            subtitleSource = new SubtitlesInputSource(
              source,
              [stream],
              SubtitleMethods.Convert,
            );

            subtitleRendition = {
              language: pickedSubtitleStream.languageCodeISO6392 ?? 'und',
              languageName: pickedSubtitleStream.language,
              default: pickedSubtitleStream.default,
              forced: pickedSubtitleStream.forced,
              title: pickedSubtitleStream.title,
            };
          }
        }
      }
    }

    return { subtitleSource, subtitleRendition };
  }

  /**
   * Builds per-stream audio codec overrides for passthrough (copy-all) mode.
   * DTS and TrueHD cannot be muxed into MPEG-TS and are unsupported by
   * AVPlayer on Apple devices — transcode those to AC-3.
   */
  private buildAudioCodecOverrides(
    streamDetails: StreamDetails,
  ): AudioCodecOverride[] {
    const overrides: AudioCodecOverride[] = [];
    if (streamDetails.audioDetails) {
      for (let i = 0; i < streamDetails.audioDetails.length; i++) {
        const codec = streamDetails.audioDetails[i]!.codec;
        if (codec === AudioFormats.Dca || codec === AudioFormats.TrueHd) {
          overrides.push({ outputIndex: i, codec: AudioFormats.Ac3 });
        }
      }
    }
    return overrides;
  }

  /**
   * Builds audio and subtitle rendition metadata from source stream details.
   */
  private buildRenditions(
    streamDetails: StreamDetails,
    subtitleRendition: SubtitleRenditionInfo | undefined,
    isPassthrough: boolean,
  ): StreamRenditions {
    // Transcode mode muxes only the selected audio track into the variant,
    // so there are no alternate audio renditions to advertise.
    const audioRenditions: AudioRenditionInfo[] = [];
    if (isPassthrough && streamDetails.audioDetails) {
      const audioDetails = streamDetails.audioDetails;

      // RFC 8216 allows at most one DEFAULT=YES per group. Prefer the first
      // track the source flags as default, else the first track.
      const flaggedDefault = audioDetails.findIndex((audio) => audio.default);
      const defaultIndex = flaggedDefault === -1 ? 0 : flaggedDefault;

      audioDetails.forEach((audio, i) => {
        audioRenditions.push({
          language: audio.languageCodeISO6392 ?? audio.language ?? 'und',
          languageName: audio.language,
          title: audio.title,
          channels: audio.channels,
          default: i === defaultIndex,
        });
      });
    }

    return { audio: audioRenditions, subtitle: subtitleRendition };
  }

  async createPlaceholderSession(
    opts: PlaceholderSessionOpts,
  ): Promise<Maybe<TranscodeSessionResult>> {
    const realtime = opts.realtime ?? true;
    const ptsOffset = opts.ptsOffset ?? 0;

    let session: Maybe<FfmpegTranscodeSession>;
    if (opts.kind === 'error') {
      session = await this.createErrorSession(
        opts.title,
        opts.subtitle,
        opts.duration,
        opts.outputFormat,
        realtime,
        ptsOffset,
        opts.isFirstTranscode,
      );
    } else {
      session = await this.createOfflineSession(
        opts.duration,
        opts.outputFormat,
        ptsOffset,
        realtime,
        opts.backgroundMusic,
        opts.isFirstTranscode,
        opts.picture,
        opts.nowPlaying,
      );
    }

    if (!session) return undefined;

    return { session, renditions: { audio: [] } };
  }

  private async createErrorSession(
    title: string,
    subtitle: Maybe<string>,
    duration: Duration,
    outputFormat: OutputFormat,
    requestedRealtime: boolean,
    ptsOffset?: number,
    isFirstTranscode?: boolean,
  ): Promise<Maybe<FfmpegTranscodeSession>> {
    const realtime =
      this.transcodeConfig.errorScreen === 'pic'
        ? this.paceStillImage(requestedRealtime)
        : requestedRealtime;
    const calculator = new FfmpegPlaybackParamsCalculator(
      this.transcodeConfig,
      this.channel.streamMode,
    );
    const playbackParams = calculator.calculateForErrorStream(
      outputFormat,
      realtime,
    );

    const frameSize = FrameSize.fromResolution(this.transcodeConfig.resolution);

    let scaledSize: Maybe<FrameSize>;
    let errorInput: VideoInputSource;
    switch (this.transcodeConfig.errorScreen) {
      case 'pic': {
        const stream = StillImageStream.create({
          index: 0,
          frameSize: FrameSize.create({ width: 1920, height: 1080 }),
        });
        scaledSize = stream.squarePixelFrameSize(
          FrameSize.fromResolution(this.transcodeConfig.resolution),
        );
        errorInput = VideoInputSource.withStream(
          new HttpStreamSource(
            makeLocalUrl('/images/generic-error-screen.png'),
          ),
          stream,
        );
        break;
      }
      case 'blank':
        throw new Error('');
      case 'testsrc':
        errorInput = LavfiVideoInputSource.testSource(frameSize);
        break;
      case 'static':
        errorInput = LavfiVideoInputSource.createStatic();
        break;
      case 'text':
        errorInput = LavfiVideoInputSource.errorText(
          frameSize,
          title,
          subtitle,
        );
        break;
      case 'kill':
        process.kill(process.pid, 'SIGTERM');
        return;
    }

    const audioState = this.createAudioState(
      playbackParams,
      duration.asMilliseconds(),
    );

    const audioInput = this.withAudioSlots(
      this.createPlaceholderAudioInput(audioState),
    );

    const builder = await this.pipelineBuilderFactory(this.transcodeConfig)
      .setHardwareAccelerationMode(
        this.transcodeConfig.hardwareAccelerationMode,
      )
      .setVideoInputSource(errorInput)
      .setAudioInputSource(audioInput)
      .build();

    const pipeline = builder.build(
      FfmpegState.create({
        version: await this.ffmpegInfo.getVersion(),
        duration,
        ptsOffset,
        isFirstTranscode,
        threadCount: this.transcodeConfig.threadCount,
        outputFormat,
        softwareDeinterlaceFilter: this.ffmpegSettings.deinterlaceFilter,
        softwareScalingAlgorithm: this.ffmpegSettings.scalingAlgorithm,
        vaapiDevice: this.getVaapiDevice(),
        vaapiDriver: this.getVaapiDriver(),
        logLevel: this.ffmpegSettings.logLevel,
      }),
      new FrameState({
        isAnamorphic: false,
        scaledSize:
          scaledSize ??
          FrameSize.fromResolution(this.transcodeConfig.resolution),
        paddedSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
        videoBitrate: playbackParams.videoBitrate,
        videoBufferSize: playbackParams.videoBufferSize,
        pixelFormat: new PixelFormatYuv420P(),
        frameRate: playbackParams.frameRate,
        videoTrackTimescale: playbackParams.videoTrackTimeScale,
        realtime,
        videoFormat: playbackParams.videoFormat,
        videoPreset: playbackParams.videoPreset ?? null,
        videoProfile: null, // TODO:
        deinterlace: false,
      }),
      {
        ...DefaultPipelineOptions,
        encoderThreadCount: this.transcodeConfig.threadCount,
      },
    );

    return this.wrapInSession(
      pipeline,
      `channel-${this.channel.number}-error`,
      duration,
    );
  }

  private async createOfflineSession(
    duration: Duration,
    outputFormat: OutputFormat,
    ptsOffset: number = 0,
    requestedRealtime: boolean = true,
    backgroundMusic?: OfflineBackgroundMusic,
    isFirstTranscode?: boolean,
    picture?: FileStreamSource,
    nowPlaying?: OfflineNowPlaying,
  ): Promise<Maybe<FfmpegTranscodeSession>> {
    const realtime = this.paceStillImage(requestedRealtime);
    const offlineInput = VideoInputSource.withStream(
      picture ??
        new HttpStreamSource(
          isNonEmptyString(this.channel.offline?.picture)
            ? this.channel.offline?.picture
            : makeLocalUrl('/images/generic-offline-screen.png'),
        ),
      VideoStream.create({
        inputKind: 'stillimage',
        codec: 'unknown',
        frameSize: FrameSize.create({ width: 1920, height: 1080 }),
        index: 0,
        providedSampleAspectRatio: '1:1',
        displayAspectRatio: '1:1',
        pixelFormat: PixelFormatUnknown(),
        colorFormat: ColorFormat.unknown,
      }),
    );

    // First in the chain, while the picture is still a software frame at its
    // own size, before any pipeline scales it or uploads it to a GPU
    if (nowPlaying) {
      const ffmpegPath = this.ffmpegSettings.ffmpegExecutablePath;
      if (await this.ffmpegInfo.hasFilter('drawtext')) {
        FfmpegStreamFactory.missingDrawtextWarnedFor = undefined;
        offlineInput.addFilter(
          new NowPlayingTextFilter(nowPlaying.text, nowPlaying.fontFile),
        );
      } else if (FfmpegStreamFactory.missingDrawtextWarnedFor !== ffmpegPath) {
        FfmpegStreamFactory.missingDrawtextWarnedFor = ffmpegPath;
        this.logger.warn(
          'FFmpeg has no drawtext filter; gap music titles cannot be displayed. Use a build with drawtext support.',
        );
      }
    }

    const calculator = new FfmpegPlaybackParamsCalculator(
      this.transcodeConfig,
      this.channel.streamMode,
    );
    const playbackParams = calculator.calculateForErrorStream(
      outputFormat,
      true,
    );

    // Gap music is normalized to its own target (programs are left as they
    // are), fades in, and fades out when the gap ends before the track does.
    const audioState = this.createAudioState(
      playbackParams,
      duration.asMilliseconds(),
      backgroundMusic ? GapMusicLoudnorm : null,
      backgroundMusic
        ? gapMusicFades(
            duration.asMilliseconds(),
            backgroundMusic.trackDurationMs,
          )
        : null,
    );

    const audioInput = this.withAudioSlots(
      backgroundMusic
        ? AudioInputSource.withStream(
            backgroundMusic.source,
            AudioStream.create({
              index: backgroundMusic.audioStream.index,
              codec: backgroundMusic.audioStream.codec ?? 'unknown',
              channels: backgroundMusic.audioStream.channels ?? -2,
            }),
            audioState,
          )
        : this.createPlaceholderAudioInput(audioState),
    );

    const builder = await this.pipelineBuilderFactory(this.transcodeConfig)
      .setHardwareAccelerationMode(
        this.transcodeConfig.hardwareAccelerationMode,
      )
      .setVideoInputSource(offlineInput)
      .setAudioInputSource(audioInput)
      .build();

    const pipeline = builder.build(
      FfmpegState.create({
        version: await this.ffmpegInfo.getVersion(),
        duration,
        ptsOffset,
        isFirstTranscode,
        threadCount: this.transcodeConfig.threadCount,
        outputFormat,
        softwareDeinterlaceFilter: this.ffmpegSettings.deinterlaceFilter,
        softwareScalingAlgorithm: this.ffmpegSettings.scalingAlgorithm,
        vaapiDevice: this.getVaapiDevice(),
        vaapiDriver: this.getVaapiDriver(),
        logLevel: this.ffmpegSettings.logLevel,
      }),
      new FrameState({
        isAnamorphic: false,
        scaledSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
        paddedSize: FrameSize.fromResolution(this.transcodeConfig.resolution),
        videoBitrate: playbackParams.videoBitrate,
        videoBufferSize: playbackParams.videoBufferSize,
        pixelFormat: new PixelFormatYuv420P(),
        frameRate: playbackParams.frameRate,
        videoTrackTimescale: playbackParams.videoTrackTimeScale,
        realtime,
        videoFormat: playbackParams.videoFormat,
        videoPreset: playbackParams.videoPreset ?? null,
        videoProfile: null, // TODO:
        deinterlace: false,
        infiniteLoop: true,
      }),
      {
        ...DefaultPipelineOptions,
        encoderThreadCount: this.transcodeConfig.threadCount,
      },
    );

    return this.wrapInSession(
      pipeline,
      `channel-${this.channel.number}-transcode`,
      duration,
    );
  }

  // Whether a still-image placeholder runs at real time. A first transcode
  // reads ahead (realtime false) through -readrate's initial burst, which
  // paces a still image looped at the input. The CUDA, QSV and VAAPI pipelines
  // loop it with the loop filter instead, which repeats one decoded frame that
  // -readrate can't pace; only the realtime filter can, and it has no burst.
  // There it stays at real time, or the whole gap would encode at full speed.
  private paceStillImage(realtime: boolean): boolean {
    if (realtime) {
      return true;
    }
    switch (this.transcodeConfig.hardwareAccelerationMode) {
      case HardwareAccelerationMode.Cuda:
      case HardwareAccelerationMode.Qsv:
      case HardwareAccelerationMode.Vaapi:
        return true;
      default:
        return false;
    }
  }

  private wrapInSession(
    pipeline: Pipeline,
    label: string,
    duration: Duration,
  ): FfmpegTranscodeSession {
    const endTime =
      duration.asMilliseconds() < 0 ? dayjs(-1) : dayjs().add(duration);
    return new FfmpegTranscodeSession(
      new FfmpegProcess(
        this.ffmpegSettings,
        label,
        pipeline.getCommandArgs(),
        this.settingsDB.systemSettings().logging.logsDirectory,
        pipeline.getCommandEnvironment(),
      ),
      duration,
      endTime,
    );
  }

  // The channel's fixed audio track layout (plans/switchable-audio.md): slot
  // languages in output order; [] = off, one audio track as before
  private get audioSlots(): string[] {
    return audioTrackSlots(this.channel.audioTracks);
  }

  // A single-stream audio input (gap music, silence, tones) repeated into
  // every slot of the channel's layout, so gaps carry the same tracks as
  // programs; unchanged without a layout
  private withAudioSlots<T extends AudioInputSource>(input: T): T {
    const slots = this.audioSlots;
    const [stream] = input.streams;
    if (slots.length === 0 || stream === undefined) {
      return input;
    }
    input.streams = slots.map((language) =>
      AudioStream.create({
        index: stream.index,
        codec: stream.codec,
        channels: stream.channels,
        language,
      }),
    );
    return input;
  }

  private createAudioState(
    playbackParams: FfmpegPlaybackParams,
    audioDuration: number | null,
    loudnormConfig?: LoudnormConfig | null,
    fades?: AudioFades | null,
  ): AudioState {
    return AudioState.create({
      fades: fades ?? null,
      audioEncoder: playbackParams.audioFormat,
      audioChannels: playbackParams.audioChannels,
      audioBitrate: playbackParams.audioBitrate,
      audioBufferSize: playbackParams.audioBufferSize,
      audioSampleRate: playbackParams.audioSampleRate,
      audioVolume: this.transcodeConfig.audioVolumePercent,
      audioDuration,
      loudnormConfig: loudnormConfig ?? null,
    });
  }

  private createPlaceholderAudioInput(
    audioState: AudioState,
  ): AudioInputSource {
    switch (this.transcodeConfig.errorScreenAudio) {
      case 'silent':
        return new NullAudioInputSource(audioState);
      case 'sine':
        return AudioInputFilterSource.sine(audioState);
      case 'whitenoise':
        return AudioInputFilterSource.noise(audioState);
    }
  }

  private buildVideoInput(
    streamSource: PipelineStreamSource,
    streamDetails: StreamDetails,
  ): { videoStream: VideoStream; videoInputSource: VideoInputSource } {
    if (streamDetails.videoDetails) {
      const [videoStreamDetails] = streamDetails.videoDetails;

      const streamIndex = isUndefined(videoStreamDetails.streamIndex)
        ? 0
        : videoStreamDetails.streamIndex;

      let pixelFormat: Maybe<PixelFormat>;
      if (videoStreamDetails.pixelFormat) {
        pixelFormat = KnownPixelFormats.forPixelFormat(
          videoStreamDetails.pixelFormat,
        );
      }

      if (isUndefined(pixelFormat)) {
        switch (videoStreamDetails.bitDepth) {
          case 8: {
            pixelFormat = new PixelFormatYuv420P();
            break;
          }
          case 10: {
            pixelFormat = new PixelFormatYuv420P10Le();
            break;
          }
          default:
            pixelFormat = PixelFormatUnknown(videoStreamDetails.bitDepth);
        }
      }

      const videoStream = VideoStream.create({
        codec: videoStreamDetails.codec ?? 'unknown',
        profile: videoStreamDetails.profile,
        index: isNaN(streamIndex) ? 0 : streamIndex,
        inputKind: 'video',
        providedSampleAspectRatio: videoStreamDetails.sampleAspectRatio ?? null,
        displayAspectRatio: videoStreamDetails.displayAspectRatio,
        pixelFormat,
        frameSize: FrameSize.create({
          height: videoStreamDetails.height,
          width: videoStreamDetails.width,
        }),
        frameRate: videoStreamDetails.framerate?.toString(),
        colorFormat: new ColorFormat({
          colorRange: videoStreamDetails.colorRange ?? null,
          colorSpace: videoStreamDetails.colorSpace ?? null,
          colorTransfer: videoStreamDetails.colorTransfer ?? null,
          colorPrimaries: videoStreamDetails.colorPrimaries ?? null,
        }),
      });

      const videoInputSource = new VideoInputSource(streamSource, [
        videoStream,
      ]);

      this.logger.debug('Video stream input: %O', videoStream);

      return { videoStream, videoInputSource };
    } else if (
      streamDetails.placeholderImage &&
      (streamDetails.placeholderImage.type === 'file' ||
        streamDetails.placeholderImage.type === 'http')
    ) {
      const videoStream = StillImageStream.create({
        frameSize: FrameSize.create({ height: 0, width: 0 }),
        index: 0,
      });
      const videoInputSource = new VideoInputSource(
        streamDetails.placeholderImage,
        [videoStream],
      );
      videoInputSource.addOption(new InfiniteLoopInputOption());
      return { videoStream, videoInputSource };
    } else {
      throw new Error('Streams with no video are not currently supported.');
    }
  }

  private getVaapiDevice() {
    return isNonEmptyString(this.transcodeConfig.vaapiDevice)
      ? this.transcodeConfig.vaapiDevice
      : isLinux()
        ? '/dev/dri/renderD128'
        : null;
  }

  private getVaapiDriver() {
    return libvaDriverName(this.transcodeConfig.vaapiDriver);
  }
}
