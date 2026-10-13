import type { ContentBackedStreamLineupItem } from '@/db/derived_types/StreamLineup.ts';
import type { IChannelDB } from '@/db/interfaces/IChannelDB.ts';
import type {
  ISettingsDB,
  ReadableFfmpegSettings,
} from '@/db/interfaces/ISettingsDB.ts';
import type { ChannelOrm } from '@/db/schema/Channel.ts';
import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.ts';
import {
  AudioFormats,
  HlsDirectOutputFormat,
  HlsOutputFormat,
  MpegTsOutputFormat,
  VideoFormats,
  VideoPresets,
  defaultHlsOptions,
} from '@/ffmpeg/builder/constants.ts';
import type { PipelineBuilder } from '@/ffmpeg/builder/pipeline/PipelineBuilder.ts';
import type { PipelineBuilderFactory } from '@/ffmpeg/builder/pipeline/PipelineBuilderFactory.ts';
import { FrameState } from '@/ffmpeg/builder/state/FrameState.ts';
import { FfmpegState } from '@/ffmpeg/builder/state/FfmpegState.ts';
import type { FfmpegInfo, FfmpegVersionResult } from '@/ffmpeg/ffmpegInfo.ts';
import type { StreamSelector } from '@/ffmpeg/StreamSelector.ts';
import type { FeatureFlagService } from '@/services/FeatureFlagService.ts';
import type { StreamDetails, SubtitleStreamDetails } from '@/stream/types.ts';
import { FileStreamSource, HttpStreamSource } from '@/stream/types.ts';
import type { SubtitlesInputSource } from '@/ffmpeg/builder/input/SubtitlesInputSource.ts';
import type { VideoInputSource } from '@/ffmpeg/builder/input/VideoInputSource.ts';
import {
  StillImageStream,
  SubtitleMethods,
} from '@/ffmpeg/builder/MediaStream.ts';
import { InfiniteLoopInputOption } from '@/ffmpeg/builder/options/input/InfiniteLoopInputOption.ts';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { describe, expect, test, vi } from 'vitest';
import { GapMusicLoudnorm } from './builder/filter/LoudnormFilter.ts';
import {
  AudioInputSource,
  NullAudioInputSource,
} from './builder/input/AudioInputSource.ts';
import { FfmpegStreamFactory, gapMusicFades } from './FfmpegStreamFactory.ts';
import { SubtitleStreamPicker } from './SubtitleStreamPicker.ts';

vi.mock('@/util/serverUtil.ts', () => ({
  makeLocalUrl: (path: string) => `http://localhost:8000${path}`,
}));

dayjs.extend(duration);

const mockFfmpegVersion: FfmpegVersionResult = {
  versionString: '7.0',
  majorVersion: 7,
  minorVersion: 0,
  patchVersion: 0,
  isUnknown: false,
};

function makeTranscodeConfig(
  overrides: Partial<TranscodeConfigOrm> = {},
): TranscodeConfigOrm {
  return {
    uuid: 'test-uuid',
    name: 'Test',
    threadCount: 0,
    hardwareAccelerationMode: 'none',
    vaapiDriver: 'system',
    vaapiDevice: null,
    resolution: { widthPx: 1920, heightPx: 1080 },
    videoFormat: 'h264',
    videoProfile: null,
    videoPreset: null,
    videoBitDepth: 8,
    videoBitRate: 2000,
    videoBufferSize: 4000,
    audioChannels: 2,
    audioFormat: 'aac',
    audioBitRate: 192,
    audioBufferSize: 384,
    audioSampleRate: 48,
    audioVolumePercent: 100,
    audioLoudnormConfig: null,
    normalizeFrameRate: false,
    deinterlaceVideo: true,
    disableChannelOverlay: false,
    errorScreen: 'pic',
    errorScreenAudio: 'silent',
    isDefault: true,
    disableHardwareDecoder: false,
    disableHardwareEncoding: false,
    disableHardwareFilters: false,
    ...overrides,
  } as TranscodeConfigOrm;
}

function makeChannel(overrides: Partial<ChannelOrm> = {}): ChannelOrm {
  return {
    uuid: 'channel-uuid',
    name: 'Test Channel',
    number: 1,
    streamMode: 'hls',
    subtitlesEnabled: false,
    offline: { mode: 'pic' },
    duration: 0,
    groupTitle: null,
    stealth: false,
    fillerCollections: [],
    fillerRepeatCooldownMs: 0,
    transcodeConfigId: null,
    icon: null,
    startTime: 0,
    ...overrides,
  } as ChannelOrm;
}

function makeFfmpegSettings(): ReadableFfmpegSettings {
  return {
    configVersion: 5,
    ffmpegExecutablePath: '/usr/bin/ffmpeg',
    ffprobeExecutablePath: '/usr/bin/ffprobe',
    enableLogging: false,
    enableFileLogging: false,
    logLevel: 'warning',
    languagePreferences: {
      preferences: [{ iso6391: 'en', iso6392: 'eng', displayName: 'English' }],
    },
    scalingAlgorithm: 'bicubic',
    deinterlaceFilter: 'none',
    hlsDirectOutputFormat: 'mpegts',
    enableSubtitleExtraction: false,
  } as ReadableFfmpegSettings;
}

function makeStreamDetails(): StreamDetails {
  return {
    duration: dayjs.duration({ seconds: 30 }),
    videoDetails: [
      {
        codec: 'h264',
        profile: 'Main',
        width: 1920,
        height: 1080,
        framerate: 24,
        pixelFormat: 'yuv420p',
        bitDepth: 8,
        streamIndex: 0,
        sampleAspectRatio: '1:1',
        displayAspectRatio: '16:9',
        anamorphic: false,
        bitrate: 5000,
        isAttachedPic: false,
        colorRange: null,
        colorSpace: null,
        colorTransfer: null,
        colorPrimaries: null,
      },
    ],
    audioDetails: [
      {
        codec: 'aac',
        channels: 2,
        index: 1,
      },
    ],
  };
}

function makeLineupItem(): ContentBackedStreamLineupItem {
  return {
    type: 'program',
    streamDuration: 30000,
    programBeginMs: 0,
    duration: 30000,
    infiniteLoop: false,
    program: {
      uuid: 'program-uuid',
      mediaSourceId: 'source-id',
      externalIds: [],
    },
  } as ContentBackedStreamLineupItem;
}

/**
 * Creates a mock PipelineBuilderFactory that intercepts PipelineBuilder.build()
 * to capture the FrameState for assertion.
 */
function createCapturingPipelineBuilderFactory(): {
  factory: PipelineBuilderFactory;
  getCapturedFrameState: () => FrameState | undefined;
  getCapturedFfmpegState: () => FfmpegState | undefined;
  getCapturedHwAccel: () => string | undefined;
  getCapturedSubtitleInput: () => SubtitlesInputSource | null | undefined;
  getCapturedVideoInput: () => VideoInputSource | undefined;
  getCapturedAudioInput: () => AudioInputSource | null | undefined;
} {
  let capturedFrameState: FrameState | undefined;
  let capturedFfmpegState: FfmpegState | undefined;
  let capturedHwAccel: string | undefined;
  let capturedSubtitleInput: SubtitlesInputSource | null | undefined;
  let capturedVideoInput: VideoInputSource | undefined;
  let capturedAudioInput: AudioInputSource | null | undefined;

  const factory: PipelineBuilderFactory = () => {
    const builderProxy: Record<string, unknown> = {};
    for (const method of ['setWatermarkInputSource', 'setConcatInputSource']) {
      builderProxy[method] = vi.fn().mockReturnValue(builderProxy);
    }

    builderProxy.setAudioInputSource = vi.fn(
      (input: AudioInputSource | null) => {
        capturedAudioInput = input;
        return builderProxy;
      },
    );

    builderProxy.setVideoInputSource = vi.fn((input: VideoInputSource) => {
      capturedVideoInput = input;
      return builderProxy;
    });

    builderProxy.setSubtitleInputSource = vi.fn(
      (input: SubtitlesInputSource | null) => {
        capturedSubtitleInput = input;
        return builderProxy;
      },
    );

    builderProxy.setHardwareAccelerationMode = vi.fn((mode: string) => {
      capturedHwAccel = mode;
      return builderProxy;
    });

    builderProxy.build = vi.fn().mockResolvedValue({
      build: (ffmpegState: FfmpegState, frameState: FrameState) => {
        capturedFfmpegState = ffmpegState;
        capturedFrameState = frameState;
        return {
          getCommandArgs: () => [],
          getCommandEnvironment: () => ({}),
          inputs: {},
          steps: [],
          setInputs: vi.fn(),
        };
      },
    } as unknown as PipelineBuilder);

    return builderProxy as ReturnType<PipelineBuilderFactory>;
  };

  return {
    factory,
    getCapturedFrameState: () => capturedFrameState,
    getCapturedAudioInput: () => capturedAudioInput,
    getCapturedFfmpegState: () => capturedFfmpegState,
    getCapturedHwAccel: () => capturedHwAccel,
    getCapturedSubtitleInput: () => capturedSubtitleInput,
    getCapturedVideoInput: () => capturedVideoInput,
  };
}

function makeMockFfmpegInfo(): FfmpegInfo {
  return {
    getVersion: vi.fn().mockResolvedValue(mockFfmpegVersion),
  } as unknown as FfmpegInfo;
}

function makeMockSettingsDB(
  ffmpegSettings: ReadableFfmpegSettings,
): ISettingsDB {
  return {
    systemSettings: vi.fn().mockReturnValue({
      logging: { logsDirectory: null },
    }),
    ffmpegSettings: vi.fn().mockReturnValue(ffmpegSettings),
  } as unknown as ISettingsDB;
}

function makeMockChannelDB(): IChannelDB {
  return {
    getChannelSubtitlePreferences: vi.fn().mockResolvedValue([]),
  } as unknown as IChannelDB;
}

function makeMockFeatureFlagService(
  flags: Record<string, boolean> = {},
): FeatureFlagService {
  return {
    get: vi.fn((flag: string) => flags[flag] ?? false),
    getAll: vi.fn().mockReturnValue(flags),
  } as unknown as FeatureFlagService;
}

function makeMockStreamSelector(
  subtitleStream: SubtitleStreamDetails | null = null,
): StreamSelector {
  return {
    selectAudioAndSubtitleStreams: vi.fn().mockImplementation(async () => ({
      audioStream: { index: 1, codec: 'aac', channels: 2 },
      subtitleStream,
    })),
  } as unknown as StreamSelector;
}

describe('FfmpegStreamFactory', () => {
  describe('videoPreset wiring into FrameState', () => {
    test('createStreamSession passes videoPreset=veryfast for software h264', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });
      const { factory, getCapturedFrameState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = makeFfmpegSettings();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: makeStreamDetails(),
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: MpegTsOutputFormat,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const frameState = getCapturedFrameState();
      expect(frameState).toBeDefined();
      expect(frameState!.videoPreset).toBe(VideoPresets.VeryFast);
    });

    test('createStreamSession passes videoPreset=veryfast for software hevc', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'hevc',
      });
      const { factory, getCapturedFrameState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = makeFfmpegSettings();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: makeStreamDetails(),
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: MpegTsOutputFormat,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const frameState = getCapturedFrameState();
      expect(frameState).toBeDefined();
      expect(frameState!.videoPreset).toBe(VideoPresets.VeryFast);
    });

    test('createStreamSession does not set videoPreset for hardware-accelerated encoding', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'cuda',
        videoFormat: 'h264',
      });
      const { factory, getCapturedFrameState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = makeFfmpegSettings();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: makeStreamDetails(),
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: MpegTsOutputFormat,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const frameState = getCapturedFrameState();
      expect(frameState).toBeDefined();
      expect(frameState!.videoPreset).toBeNull();
    });

    test('createPlaceholderSession (error) wires videoPreset into FrameState', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
        errorScreen: 'testsrc',
      });
      const { factory, getCapturedFrameState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = makeFfmpegSettings();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createPlaceholderSession({
        kind: 'error',
        title: 'Test Error',
        duration: dayjs.duration({ seconds: 10 }),
        outputFormat: MpegTsOutputFormat,
        realtime: true,
      });

      const frameState = getCapturedFrameState();
      expect(frameState).toBeDefined();
      // calculateForErrorStream doesn't compute a videoPreset, so it should be null
      expect(frameState!.videoPreset).toBeNull();
    });

    test('createPlaceholderSession (offline) wires videoPreset into FrameState', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });
      const { factory, getCapturedFrameState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = makeFfmpegSettings();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 10 }),
        outputFormat: MpegTsOutputFormat,
      });

      const frameState = getCapturedFrameState();
      expect(frameState).toBeDefined();
      // calculateForErrorStream (used by offline) doesn't set videoPreset
      expect(frameState!.videoPreset).toBeNull();
    });

    test('createPlaceholderSession (offline) applies software deinterlace + scaling filters', async () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });
      const { factory, getCapturedFfmpegState } =
        createCapturingPipelineBuilderFactory();

      const ffmpegSettings = {
        ...makeFfmpegSettings(),
        deinterlaceFilter: 'yadif=0',
        scalingAlgorithm: 'lanczos',
      };
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(ffmpegSettings),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 10 }),
        outputFormat: MpegTsOutputFormat,
      });

      const ffmpegState = getCapturedFfmpegState();
      expect(ffmpegState).toBeDefined();
      // Mirrors the error session: reuse the configured ffmpegSettings,
      // not the FfmpegState class defaults.
      expect(ffmpegState!.softwareDeinterlaceFilter).toBe('yadif=0');
      expect(ffmpegState!.softwareScalingAlgorithm).toBe('lanczos');
    });
  });

  describe('gap music under the offline picture', () => {
    function makeSut() {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });
      const capture = createCapturingPipelineBuilderFactory();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        capture.factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );
      return { sut, ...capture };
    }

    test('plays the track, normalized, with fades, instead of the placeholder audio', async () => {
      const { sut, getCapturedAudioInput } = makeSut();
      const source = new FileStreamSource('/media/music/Artist/Album/01.flac');

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
        backgroundMusic: {
          source,
          audioStream: { index: 0, codec: 'flac', channels: 2 },
          trackDurationMs: 240_000,
        },
      });

      const audioInput = getCapturedAudioInput();
      expect(audioInput).toBeInstanceOf(AudioInputSource);
      expect(audioInput).not.toBeInstanceOf(NullAudioInputSource);
      expect(audioInput?.source).toBe(source);
      expect(audioInput?.streams[0]).toMatchObject({
        index: 0,
        codec: 'flac',
        channels: 2,
      });
      expect(audioInput?.desiredState.loudnormConfig).toEqual(GapMusicLoudnorm);
      expect(audioInput?.desiredState.fades).toEqual({
        fadeInMs: 1000,
        fadeOut: { startMs: 87_000, durationMs: 3000 },
      });
    });

    test('keeps the placeholder audio without gap music', async () => {
      const { sut, getCapturedAudioInput } = makeSut();

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
      });

      const audioInput = getCapturedAudioInput();
      expect(audioInput).toBeInstanceOf(NullAudioInputSource);
      expect(audioInput?.desiredState.loudnormConfig).toBeNull();
      expect(audioInput?.desiredState.fades).toBeNull();
    });

    test('gapMusicFades fades out only when the gap cuts the track short', () => {
      expect(gapMusicFades(240_000, 240_000)).toEqual({
        fadeInMs: 1000,
        fadeOut: null,
      });
      expect(gapMusicFades(60_000, 240_000)).toEqual({
        fadeInMs: 1000,
        fadeOut: { startMs: 57_000, durationMs: 3000 },
      });
      // a 2-second remainder still fades, over its whole length
      expect(gapMusicFades(2_000, 240_000)).toEqual({
        fadeInMs: 1000,
        fadeOut: { startMs: 0, durationMs: 2000 },
      });
    });
  });

  describe('passthrough mode (HlsDirectV2 / remux)', () => {
    const hlsDirectV2Format = HlsDirectOutputFormat(defaultHlsOptions);

    function createPassthroughSut(
      configOverrides: Partial<TranscodeConfigOrm> = {},
      streamDetails?: StreamDetails,
    ) {
      const config = makeTranscodeConfig(configOverrides);
      const capturing = createCapturingPipelineBuilderFactory();

      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        capturing.factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        config,
        makeChannel(),
      );

      return {
        sut,
        ...capturing,
        streamDetails: streamDetails ?? makeStreamDetails(),
      };
    }

    test('HlsDirectV2 does not crash (playbackParams is null)', async () => {
      const { sut, getCapturedFrameState, streamDetails } =
        createPassthroughSut();

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      expect(getCapturedFrameState()).toBeDefined();
    });

    test('remux mode does not crash (playbackParams is null)', async () => {
      const { sut, getCapturedFrameState, streamDetails } =
        createPassthroughSut();

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: MpegTsOutputFormat,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
          encoding: { mode: 'remux' },
        },
        lineupItem: makeLineupItem(),
      });

      expect(getCapturedFrameState()).toBeDefined();
    });

    test('HlsDirectV2 sets passthrough defaults in FrameState', async () => {
      const { sut, getCapturedFrameState, streamDetails } =
        createPassthroughSut();

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const frameState = getCapturedFrameState()!;
      expect(frameState.videoFormat).toBe(VideoFormats.Copy);
      // videoPreset falls back to DefaultFrameState (null) because lodash
      // merge skips the undefined value passed in passthrough mode.
      expect(frameState.videoPreset).toBeNull();
      expect(frameState.deinterlace).toBe(false);
      expect(frameState.videoBitrate).toBeNull();
      expect(frameState.videoBufferSize).toBeNull();
      expect(frameState.frameRate).toBeNull();
      expect(frameState.videoTrackTimescale).toBe(90000);
    });

    test('passthrough forces hardware acceleration to none', async () => {
      const { sut, getCapturedHwAccel, streamDetails } = createPassthroughSut({
        hardwareAccelerationMode: 'cuda',
      });

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      expect(getCapturedHwAccel()).toBe('none');
    });

    test('passthrough sets copyAllStreams and zeroes threadCount in FfmpegState', async () => {
      const { sut, getCapturedFfmpegState, streamDetails } =
        createPassthroughSut({ threadCount: 4 });

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const ffmpegState = getCapturedFfmpegState()!;
      expect(ffmpegState.copyAllStreams).toBe(true);
      expect(ffmpegState.threadCount).toBe(0);
      expect(ffmpegState.vaapiDevice).toBeNull();
      expect(ffmpegState.vaapiDriver).toBeNull();
      // lodash merge skips undefined, so FfmpegState class defaults are kept.
      expect(ffmpegState.softwareDeinterlaceFilter).toBe('yadif=1');
      expect(ffmpegState.softwareScalingAlgorithm).toBe('fast_bilinear');
    });

    test('passthrough builds audio codec overrides for DTS/TrueHD', async () => {
      const details = makeStreamDetails();
      details.audioDetails = [
        { codec: AudioFormats.Aac, channels: 2, index: 1 },
        { codec: AudioFormats.Dca, channels: 6, index: 2 },
        { codec: AudioFormats.TrueHd, channels: 8, index: 3 },
      ];

      const { sut, getCapturedFfmpegState } = createPassthroughSut({}, details);

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const ffmpegState = getCapturedFfmpegState()!;
      expect(ffmpegState.audioCodecOverrides).toEqual([
        { outputIndex: 1, codec: AudioFormats.Ac3 },
        { outputIndex: 2, codec: AudioFormats.Ac3 },
      ]);
    });

    test('passthrough uses source video dimensions for FrameState sizes', async () => {
      const details = makeStreamDetails();
      details.videoDetails = [
        {
          ...details.videoDetails![0],
          width: 3840,
          height: 2160,
        },
      ];

      const { sut, getCapturedFrameState } = createPassthroughSut(
        { resolution: { widthPx: 1920, heightPx: 1080 } },
        details,
      );

      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: hlsDirectV2Format,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      const frameState = getCapturedFrameState()!;
      // In passthrough, scaled/padded sizes come from the source, not the
      // transcode config resolution (1920x1080).
      expect(frameState.scaledSize.width).toBe(3840);
      expect(frameState.scaledSize.height).toBe(2160);
      expect(frameState.paddedSize.width).toBe(3840);
      expect(frameState.paddedSize.height).toBe(2160);
    });
  });

  describe('audio renditions', () => {
    function makeMultiAudioStreamDetails(
      defaults: [boolean, boolean] = [false, false],
    ): StreamDetails {
      return {
        ...makeStreamDetails(),
        audioDetails: [
          {
            codec: 'aac',
            channels: 2,
            index: 1,
            language: 'Japanese',
            languageCodeISO6392: 'jpn',
            default: defaults[0],
          },
          {
            codec: 'aac',
            channels: 2,
            index: 2,
            language: 'English',
            languageCodeISO6392: 'eng',
            default: defaults[1],
          },
        ],
      };
    }

    function makeSut() {
      return new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        createCapturingPipelineBuilderFactory().factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        makeTranscodeConfig(),
        makeChannel(),
      );
    }

    test('transcode mode advertises no audio renditions', async () => {
      const result = await makeSut().createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: makeMultiAudioStreamDetails(),
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: HlsOutputFormat(defaultHlsOptions),
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });

      expect(result?.renditions.audio).toEqual([]);
    });

    test('passthrough mode advertises every source audio track', async () => {
      const result = await makeSut().createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: makeMultiAudioStreamDetails(),
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: HlsDirectOutputFormat(defaultHlsOptions),
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls_direct_v2',
        },
        lineupItem: makeLineupItem(),
      });

      expect(result?.renditions.audio.map((r) => r.language)).toEqual([
        'jpn',
        'eng',
      ]);
    });

    function createPassthroughSession(details: StreamDetails) {
      return makeSut().createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat: HlsDirectOutputFormat(defaultHlsOptions),
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls_direct_v2',
        },
        lineupItem: makeLineupItem(),
      });
    }

    test('passthrough mode defaults to the first track when none is flagged', async () => {
      const result = await createPassthroughSession(
        makeMultiAudioStreamDetails(),
      );

      expect(result?.renditions.audio.map((r) => r.default)).toEqual([
        true,
        false,
      ]);
    });

    test('passthrough mode defaults only to the source-flagged track', async () => {
      const result = await createPassthroughSession(
        makeMultiAudioStreamDetails([false, true]),
      );

      expect(result?.renditions.audio.map((r) => r.default)).toEqual([
        false,
        true,
      ]);
    });

    test('passthrough mode marks one default when several tracks are flagged', async () => {
      const result = await createPassthroughSession(
        makeMultiAudioStreamDetails([true, true]),
      );

      expect(result?.renditions.audio.map((r) => r.default)).toEqual([
        true,
        false,
      ]);
    });
  });

  describe('audio-only programs', () => {
    function makeAudioOnlyStreamDetails(
      placeholderImage?: HttpStreamSource,
    ): StreamDetails {
      return {
        ...makeStreamDetails(),
        videoDetails: undefined,
        audioOnly: true,
        placeholderImage,
      };
    }

    function makeSut(factory: PipelineBuilderFactory) {
      return new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        makeTranscodeConfig(),
        makeChannel(),
      );
    }

    const options = {
      startTime: dayjs.duration(0),
      duration: dayjs.duration({ seconds: 30 }),
      outputFormat: HlsOutputFormat(defaultHlsOptions),
      ptsOffset: 0,
      realtime: true,
      streamMode: 'hls',
    } as const;

    test('loops the placeholder image as the video input', async () => {
      const { factory, getCapturedVideoInput } =
        createCapturingPipelineBuilderFactory();
      const placeholder = new HttpStreamSource(
        'http://localhost:8000/images/generic-music-screen.png',
      );

      const result = await makeSut(factory).createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/track.flac'),
          details: makeAudioOnlyStreamDetails(placeholder),
        },
        options,
        lineupItem: makeLineupItem(),
      });

      expect(result).not.toBeNull();
      const videoInput = getCapturedVideoInput();
      expect(videoInput?.source).toBe(placeholder);
      expect(videoInput?.streams[0]).toBeInstanceOf(StillImageStream);
      expect(videoInput?.hasInputOption(InfiniteLoopInputOption)).toBe(true);
    });

    test('rejects an audio-only stream without a placeholder image', async () => {
      const { factory } = createCapturingPipelineBuilderFactory();

      await expect(
        makeSut(factory).createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/track.flac'),
            details: makeAudioOnlyStreamDetails(),
          },
          options,
          lineupItem: makeLineupItem(),
        }),
      ).rejects.toThrow('Streams with no video are not currently supported.');
    });
  });

  describe('subtitle handling', () => {
    const textSubtitleStream: SubtitleStreamDetails = {
      type: 'embedded',
      codec: 'subrip',
      index: 2,
      default: true,
      forced: false,
      sdh: false,
      language: 'English',
      languageCodeISO6392: 'eng',
      title: 'English SRT',
    };

    const imageSubtitleStream: SubtitleStreamDetails = {
      type: 'embedded',
      codec: 'hdmv_pgs_subtitle',
      index: 3,
      default: false,
      forced: false,
      sdh: false,
      language: 'English',
      languageCodeISO6392: 'eng',
      title: 'English PGS',
    };

    const externalSubtitleStream: SubtitleStreamDetails = {
      type: 'external',
      codec: 'subrip',
      default: false,
      forced: false,
      sdh: false,
      language: 'Spanish',
      languageCodeISO6392: 'spa',
      path: 'http://example.com/subs.srt',
      title: 'Spanish SRT',
    };

    describe('non-passthrough modes (HLS, mpegts, etc.)', () => {
      test('uses sidecar (Convert) when webvttSidecarEnabled and text-based subtitle', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(textSubtitleStream),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Convert);
        expect(result!.renditions.subtitle).toEqual({
          language: 'eng',
          languageName: 'English',
          default: true,
          forced: false,
          title: 'English SRT',
        });
      });

      test('uses burn-in when webvttSidecarEnabled is false', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: false }),
          makeMockStreamSelector(textSubtitleStream),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Burn);
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('falls back to burn-in for image-based subtitles even when sidecar enabled', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(imageSubtitleStream),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Burn);
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('skips subtitles when channel.subtitlesEnabled is false', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(textSubtitleStream),
          config,
          makeChannel({ subtitlesEnabled: false }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).toBeNull();
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('skips subtitles when stream selector returns no subtitle', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(null),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).toBeNull();
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('handles external subtitle streams with sidecar', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(externalSubtitleStream),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Convert);
        expect(result!.renditions.subtitle).toEqual({
          language: 'spa',
          languageName: 'Spanish',
          default: false,
          forced: false,
          title: 'Spanish SRT',
        });
      });

      test('extracted embedded subtitle uses stream index 0, not the original container index', async () => {
        // Simulates the bug from issue #1904: an embedded subtitle at index 2
        // in the source MKV is extracted to a standalone .srt file. The stream
        // selector returns it with type still set to 'embedded' and the
        // original container index. The pipeline should treat this as external
        // (index 0) since the .srt only has one stream, but without the fix it
        // creates an EmbeddedSubtitleStream with index 2, producing the wrong
        // ffmpeg map (e.g. -map 2:2 instead of -map 2:0).
        const extractedEmbeddedStream: SubtitleStreamDetails = {
          type: 'embedded',
          codec: 'subrip',
          index: 2,
          default: true,
          forced: false,
          sdh: false,
          language: 'English',
          languageCodeISO6392: 'eng',
          title: 'English SRT',
          // Path is a local file, different from the video source — this means
          // the subtitle has been extracted and is no longer embedded.
          path: '/tmp/cache/subtitles/ab/cd/abcdef1234.srt',
        };

        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: true }),
          makeMockStreamSelector(extractedEmbeddedStream),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details: makeStreamDetails(),
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Convert);
        // The subtitle source path should be the extracted file, not the video
        expect(subtitleInput!.path).toBe(
          '/tmp/cache/subtitles/ab/cd/abcdef1234.srt',
        );
        // Critical: the stream must be treated as external with index 0, since
        // the standalone .srt only has one stream. Using the original container
        // index (2) would produce -map 2:2 which matches nothing.
        const stream = subtitleInput!.streams[0];
        expect(stream.inputKind).toBe('external');
        expect(stream.index).toBe(0);
      });
    });

    describe('HDHomeRun closed captions', () => {
      let dir: tmp.DirResult;
      let fullSubs: string;
      let forcedSubs: string;

      beforeEach(() => {
        dir = tmp.dirSync({ unsafeCleanup: true });
        fullSubs = path.join(dir.name, 'full.srt');
        forcedSubs = path.join(dir.name, 'forced.srt');
        fs.writeFileSync(
          fullSubs,
          '1\n00:00:02,000 --> 00:00:04,000\nBefore the seek\n\n' +
            '2\n00:00:12,000 --> 00:00:14,500\nHello there\n',
        );
        fs.writeFileSync(
          forcedSubs,
          '1\n00:00:20,000 --> 00:00:21,000\nSign\n',
        );
      });

      afterEach(() => {
        dir.removeCallback();
      });

      const fullTrack = (): SubtitleStreamDetails => ({
        ...textSubtitleStream,
        path: fullSubs,
      });
      const forcedTrack = (): SubtitleStreamDetails => ({
        ...textSubtitleStream,
        index: 4,
        forced: true,
        title: 'English Forced',
        path: forcedSubs,
      });

      async function run(opts: {
        selected: SubtitleStreamDetails | null;
        hdhrClosedCaptions?: boolean;
        streamMode?: 'hls' | 'mpegts';
      }) {
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        details.subtitleDetails = [fullTrack(), forcedTrack()];
        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB({
            ...makeFfmpegSettings(),
            hdhrClosedCaptions: opts.hdhrClosedCaptions ?? true,
          }),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: false }),
          makeMockStreamSelector(opts.selected),
          makeTranscodeConfig(),
          makeChannel({ subtitlesEnabled: true }),
        );
        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration({ seconds: 10 }),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: opts.streamMode ?? 'hls',
          },
          lineupItem: makeLineupItem(),
        });
        return {
          method: capturing.getCapturedSubtitleInput()?.method,
          captions: result?.renditions.captions,
        };
      }

      test('sends full text subtitles as captions and WebVTT instead of burning them in', async () => {
        const { method, captions } = await run({ selected: fullTrack() });

        expect(method).toBe(SubtitleMethods.Convert);
        // Cue times on the program's clock: the 10 s seek is taken off, and
        // the cue before it is dropped
        expect(captions).toEqual({
          cues: [{ startMs: 2000, endMs: 4500, text: 'Hello there' }],
          frameRate: 24,
          durationMs: 30000,
          language: 'eng',
        });
      });

      test('keeps forced subtitles burned in and captions the full track', async () => {
        const { method, captions } = await run({ selected: forcedTrack() });

        expect(method).toBe(SubtitleMethods.Burn);
        expect(captions?.cues).toEqual([
          { startMs: 2000, endMs: 4500, text: 'Hello there' },
        ]);
      });

      test('captions the full track when the profile picks no subtitles', async () => {
        const { method, captions } = await run({ selected: null });

        expect(method).toBeUndefined();
        expect(captions?.cues).toHaveLength(1);
      });

      test('captions an embedded track from its extracted copy', async () => {
        // Embedded tracks reach the factory without a path; burn-in finds their
        // extracted file in the subtitle cache, and so must captions
        const embedded: SubtitleStreamDetails = {
          ...textSubtitleStream,
          path: undefined,
        };
        const lookup = vi
          .spyOn(SubtitleStreamPicker, 'getSubtitleDetailsWithExtractedPath')
          .mockResolvedValue({
            ...embedded,
            type: 'external',
            index: 0,
            path: fullSubs,
          });
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        details.subtitleDetails = [embedded];
        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB({
            ...makeFfmpegSettings(),
            hdhrClosedCaptions: true,
          }),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: false }),
          makeMockStreamSelector(null),
          makeTranscodeConfig(),
          makeChannel({ subtitlesEnabled: true }),
        );
        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration({ seconds: 10 }),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: { type: 'mpegts' as const },
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });
        lookup.mockRestore();

        expect(result?.renditions.captions?.cues).toEqual([
          { startMs: 2000, endMs: 4500, text: 'Hello there' },
        ]);
      });

      test('burns subtitles in as before when they cannot be read as captions', async () => {
        const { method, captions } = await run({
          selected: { ...textSubtitleStream, path: '/no/such/file.srt' },
        });

        expect(method).toBe(SubtitleMethods.Burn);
        // The full track on disk still provides captions
        expect(captions?.cues).toHaveLength(1);
      });

      test('changes nothing when the setting is off', async () => {
        const { method, captions } = await run({
          selected: fullTrack(),
          hdhrClosedCaptions: false,
        });

        expect(method).toBe(SubtitleMethods.Burn);
        expect(captions).toBeUndefined();
      });

      test('only applies to the HLS stream mode', async () => {
        const { method, captions } = await run({
          selected: fullTrack(),
          streamMode: 'mpegts',
        });

        expect(method).toBe(SubtitleMethods.Burn);
        expect(captions).toBeUndefined();
      });
    });

    describe('passthrough mode (remux / HlsDirectV2)', () => {
      const hlsDirectV2Format = HlsDirectOutputFormat(defaultHlsOptions);

      test('uses sidecar (Convert) for text-based subtitles', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        details.subtitleDetails = [textSubtitleStream];

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService(),
          makeMockStreamSelector(),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: hlsDirectV2Format,
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).not.toBeNull();
        expect(subtitleInput!.method).toBe(SubtitleMethods.Convert);
        expect(result!.renditions.subtitle).toEqual({
          language: 'eng',
          languageName: 'English',
          default: true,
          forced: false,
          title: 'English SRT',
        });
      });

      test('skips image-based subtitles (cannot sidecar or burn)', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        details.subtitleDetails = [imageSubtitleStream];

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService(),
          makeMockStreamSelector(),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: hlsDirectV2Format,
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).toBeNull();
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('skips subtitles when channel.subtitlesEnabled is false', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        details.subtitleDetails = [textSubtitleStream];

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService(),
          makeMockStreamSelector(),
          config,
          makeChannel({ subtitlesEnabled: false }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: hlsDirectV2Format,
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).toBeNull();
        expect(result!.renditions.subtitle).toBeUndefined();
      });

      test('skips subtitles when no subtitle details in stream', async () => {
        const config = makeTranscodeConfig();
        const capturing = createCapturingPipelineBuilderFactory();
        const details = makeStreamDetails();
        // No subtitleDetails set

        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService(),
          makeMockStreamSelector(),
          config,
          makeChannel({ subtitlesEnabled: true }),
        );

        const result = await sut.createStreamSession({
          stream: {
            source: new HttpStreamSource('http://example.com/video.ts'),
            details,
          },
          options: {
            startTime: dayjs.duration(0),
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: hlsDirectV2Format,
            ptsOffset: 0,
            realtime: true,
            streamMode: 'hls',
          },
          lineupItem: makeLineupItem(),
        });

        const subtitleInput = capturing.getCapturedSubtitleInput();
        expect(subtitleInput).toBeNull();
        expect(result!.renditions.subtitle).toBeUndefined();
      });
    });
  });
});
