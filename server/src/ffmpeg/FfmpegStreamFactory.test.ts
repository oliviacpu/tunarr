import type { ContentBackedStreamLineupItem } from '@/db/derived_types/StreamLineup.ts';
import type { IChannelDB } from '@/db/interfaces/IChannelDB.ts';
import type {
  ISettingsDB,
  ReadableFfmpegSettings,
} from '@/db/interfaces/ISettingsDB.ts';
import type { ChannelOrm } from '@/db/schema/Channel.ts';
import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.ts';
import type { OutputFormat } from '@/ffmpeg/builder/constants.ts';
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
import type {
  AudioStreamDetails,
  StreamDetails,
  SubtitleStreamDetails,
} from '@/stream/types.ts';
import { FileStreamSource, HttpStreamSource } from '@/stream/types.ts';
import type { Logger } from '@/util/logging/LoggerFactory.ts';
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
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import type { NonEmptyArray } from 'ts-essentials';
import { describe, expect, test, vi } from 'vitest';
import { GapMusicLoudnorm } from './builder/filter/LoudnormFilter.ts';
import { NowPlayingTextFilter } from './builder/filter/NowPlayingTextFilter.ts';
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
    subtitlePreferenceMode: 'inherit',
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
function createCapturingPipelineBuilderFactory(outputFrameRate?: number): {
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

    const pipelineStub = () => ({
      outputFrameRate,
      getCommandArgs: () => [],
      getCommandEnvironment: () => ({}),
      inputs: {},
      steps: [],
      setInputs: vi.fn(),
    });
    builderProxy.build = vi.fn().mockResolvedValue({
      build: (ffmpegState: FfmpegState, frameState: FrameState) => {
        capturedFfmpegState = ffmpegState;
        capturedFrameState = frameState;
        return pipelineStub();
      },
      concat: (_input: unknown, ffmpegState: FfmpegState) => {
        capturedFfmpegState = ffmpegState;
        return pipelineStub();
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

function makeMockFfmpegInfo(filters: string[] = []): FfmpegInfo {
  return {
    getVersion: vi.fn().mockResolvedValue(mockFfmpegVersion),
    hasFilter: vi.fn((filter: string) =>
      Promise.resolve(filters.includes(filter)),
    ),
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

  // A session's first program starts at SessionStartPts, not 0, so the
  // pipeline can't infer a first transcode from the offset; without the flag
  // its HLS output would open with a discontinuity
  describe("a session's first transcode", () => {
    test.each(['offline', 'error'] as const)(
      'reaches the pipeline for an %s placeholder',
      async (kind) => {
        const { factory, getCapturedFfmpegState } =
          createCapturingPipelineBuilderFactory();
        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB(makeFfmpegSettings()),
          factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService(),
          makeMockStreamSelector(),
          makeTranscodeConfig({
            hardwareAccelerationMode: 'none',
            videoFormat: 'h264',
            errorScreen: 'testsrc',
          }),
          makeChannel(),
        );
        const common = {
          duration: dayjs.duration({ seconds: 10 }),
          outputFormat: MpegTsOutputFormat,
          ptsOffset: 90_000,
          isFirstTranscode: true,
        };

        await sut.createPlaceholderSession(
          kind === 'error'
            ? { ...common, kind, title: 'Error' }
            : { ...common, kind },
        );

        expect(getCapturedFfmpegState()?.isFirstTranscode).toBe(true);
        expect(getCapturedFfmpegState()?.ptsOffset).toBe(90_000);
      },
    );
  });

  describe('the offline picture', () => {
    function makeSut(picture?: string) {
      const capture = createCapturingPipelineBuilderFactory();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        capture.factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        makeTranscodeConfig({
          hardwareAccelerationMode: 'none',
          videoFormat: 'h264',
        }),
        makeChannel({ offline: { mode: 'pic', picture } }),
      );
      return { sut, ...capture };
    }

    test('reads the file the caller found on disk', async () => {
      const { sut, getCapturedVideoInput } = makeSut(
        'https://tv.example/images/uploads/card.png?v=1',
      );
      const picture = new FileStreamSource('/data/images/uploads/card.png');

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 30 }),
        outputFormat: MpegTsOutputFormat,
        picture,
      });

      expect(getCapturedVideoInput()?.source).toBe(picture);
    });

    test("otherwise fetches the channel's picture URL", async () => {
      const { sut, getCapturedVideoInput } = makeSut(
        'https://cdn.example/card.png',
      );

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 30 }),
        outputFormat: MpegTsOutputFormat,
      });

      const source = getCapturedVideoInput()?.source;
      expect(source).toBeInstanceOf(HttpStreamSource);
      expect(source?.path).toBe('https://cdn.example/card.png');
    });
  });

  // A first transcode reads ahead (realtime false). A still image looped at
  // the input can, through -readrate's burst; the CUDA, QSV and VAAPI
  // pipelines loop it with the loop filter, which only the realtime filter
  // paces, so there a still-image placeholder stays at real time.
  describe('a placeholder that a first transcode would read ahead', () => {
    function makeSut(
      hardwareAccelerationMode: TranscodeConfigOrm['hardwareAccelerationMode'],
      errorScreen: TranscodeConfigOrm['errorScreen'] = 'pic',
    ) {
      const capture = createCapturingPipelineBuilderFactory();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        capture.factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        makeMockStreamSelector(),
        makeTranscodeConfig({
          hardwareAccelerationMode,
          videoFormat: 'h264',
          errorScreen,
        }),
        makeChannel(),
      );
      return { sut, ...capture };
    }

    const common = {
      duration: dayjs.duration({ minutes: 30 }),
      outputFormat: MpegTsOutputFormat,
      realtime: false,
    };

    test.each([
      ['none', false],
      ['videotoolbox', false],
      ['cuda', true],
      ['qsv', true],
      ['vaapi', true],
    ] as const)(
      'with %s, a still picture runs at real time: %s',
      async (mode, realtime) => {
        for (const kind of ['offline', 'error'] as const) {
          const { sut, getCapturedFrameState } = makeSut(mode);

          await sut.createPlaceholderSession(
            kind === 'error'
              ? { ...common, kind, title: 'Error' }
              : { ...common, kind },
          );

          expect(getCapturedFrameState()?.realtime).toBe(realtime);
        }
      },
    );

    test('an error screen ffmpeg draws reads ahead on any pipeline', async () => {
      const { sut, getCapturedFrameState } = makeSut('vaapi', 'testsrc');

      await sut.createPlaceholderSession({
        ...common,
        kind: 'error',
        title: 'Error',
      });

      expect(getCapturedFrameState()?.realtime).toBe(false);
    });
  });

  describe('gap music under the offline picture', () => {
    // The missing-drawtext warning is given once per ffmpeg for the whole
    // process; each test starts as if none had been given
    beforeEach(() => {
      FfmpegStreamFactory.resetMissingDrawtextWarning();
    });

    function makeSut(
      ffmpegFilters: string[] = [],
      ffmpegExecutablePath = '/usr/bin/ffmpeg',
    ) {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });
      const capture = createCapturingPipelineBuilderFactory();
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(ffmpegFilters),
        makeMockSettingsDB({ ...makeFfmpegSettings(), ffmpegExecutablePath }),
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

    const nowPlaying = {
      text: '♪  Les Exemples — Le matin à Paris',
      fontFile: '/data/fonts/MPLUSRounded1c-Bold.ttf',
    };

    test("draws the track's artist and title on the picture, first", async () => {
      const { sut, getCapturedVideoInput } = makeSut(['drawtext']);

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
        nowPlaying,
      });

      const [first] = getCapturedVideoInput()?.filterSteps ?? [];
      expect(first).toBeInstanceOf(NowPlayingTextFilter);
      expect(first?.filter).toContain(
        'text=♪  Les Exemples — Le matin à Paris',
      );
      expect(first?.filter).toContain(
        'fontfile=/data/fonts/MPLUSRounded1c-Bold.ttf',
      );
    });

    test('leaves the picture alone with an ffmpeg that has no drawtext filter', async () => {
      const { sut, getCapturedVideoInput } = makeSut([]);
      const warn = vi.fn();
      (sut as unknown as { logger: Logger }).logger = {
        warn,
      } as unknown as Logger;

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
        nowPlaying,
      });

      expect(getCapturedVideoInput()?.filterSteps).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();
      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
        nowPlaying,
      });
      expect(warn).toHaveBeenCalledOnce();
    });

    test('warns again after switching to an ffmpeg with drawtext and back', async () => {
      const warn = vi.fn();
      const placeholder = async (filters: string[], ffmpegPath: string) => {
        const { sut } = makeSut(filters, ffmpegPath);
        (sut as unknown as { logger: Logger }).logger = {
          warn,
        } as unknown as Logger;
        await sut.createPlaceholderSession({
          kind: 'offline',
          duration: dayjs.duration({ seconds: 90 }),
          outputFormat: MpegTsOutputFormat,
          nowPlaying,
        });
      };

      await placeholder([], '/opt/ffmpeg-without-drawtext');
      await placeholder(['drawtext'], '/usr/lib/jellyfin-ffmpeg/ffmpeg');
      await placeholder([], '/opt/ffmpeg-without-drawtext');

      expect(warn).toHaveBeenCalledTimes(2);
    });

    test('leaves the picture alone without a title to draw', async () => {
      const { sut, getCapturedVideoInput } = makeSut(['drawtext']);

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
      });

      expect(getCapturedVideoInput()?.filterSteps).toEqual([]);
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

    async function runSession(outputFormat: OutputFormat) {
      const session = createPassthroughSut();
      await session.sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: session.streamDetails,
        },
        options: {
          startTime: dayjs.duration(0),
          duration: dayjs.duration({ seconds: 30 }),
          outputFormat,
          ptsOffset: 0,
          realtime: true,
          streamMode: 'hls',
        },
        lineupItem: makeLineupItem(),
      });
      return session;
    }

    test.each([
      { name: 'HLS', earlierFormat: HlsOutputFormat(defaultHlsOptions) },
      { name: 'HLS Direct v2', earlierFormat: hlsDirectV2Format },
    ])(
      'an $name session leaves a later MPEG-TS session transcoding',
      async ({ earlierFormat }) => {
        // The earlier session's FfmpegState used to rewrite the shared
        // MpegTsOutputFormat, so a later .ts program stream inherited its
        // format: the HLS muxer, or a passthrough copy
        await runSession(earlierFormat);
        const transcode = await runSession(MpegTsOutputFormat);

        expect(transcode.getCapturedFfmpegState()?.outputFormat).toEqual({
          type: 'mpegts',
        });
        expect(transcode.getCapturedFfmpegState()?.copyAllStreams).toBe(false);
        expect(transcode.getCapturedFrameState()?.videoPreset).toBe(
          VideoPresets.VeryFast,
        );
      },
    );

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

  describe('audio track layout (switchable audio in Plex Live TV)', () => {
    const eng = {
      codec: 'ac3',
      channels: 6,
      index: 1,
      language: 'English',
      languageCodeISO6392: 'eng',
    };
    const jpn = {
      codec: 'aac',
      channels: 2,
      index: 2,
      language: 'Japanese',
      languageCodeISO6392: 'jpn',
    };

    function makeSut(
      channel: Partial<ChannelOrm>,
      main: AudioStreamDetails = eng,
    ) {
      const capture = createCapturingPipelineBuilderFactory();
      const selector = {
        selectAudioAndSubtitleStreams: vi
          .fn()
          .mockResolvedValue({ audioStream: main, subtitleStream: null }),
      } as unknown as StreamSelector;
      const sut = new FfmpegStreamFactory(
        makeMockFfmpegInfo(),
        makeMockSettingsDB(makeFfmpegSettings()),
        capture.factory,
        makeMockChannelDB(),
        makeMockFeatureFlagService(),
        selector,
        makeTranscodeConfig(),
        makeChannel(channel),
      );
      return { sut, ...capture };
    }

    async function streamSession(
      sut: FfmpegStreamFactory,
      audioDetails: StreamDetails['audioDetails'],
    ) {
      await sut.createStreamSession({
        stream: {
          source: new HttpStreamSource('http://example.com/video.ts'),
          details: { ...makeStreamDetails(), audioDetails },
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
    }

    test('identifies an unavailable language when repeating the main track', async () => {
      const { sut } = makeSut({ audioTracks: ['eng', 'jpn'] });
      const info = vi.fn();
      (sut as unknown as { logger: Logger }).logger = {
        info,
        debug: vi.fn(),
        trace: vi.fn(),
      } as unknown as Logger;
      await streamSession(sut, [eng]);
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedLanguage: 'jpn',
          sourceLanguage: 'eng',
          sourceIndex: 1,
        }),
        expect.stringContaining('Audio language unavailable'),
      );
    });

    function tracks(input: AudioInputSource | null | undefined) {
      return input?.streams.map((s) => [s.index, s.language]);
    }

    test("a program with every slot's language gets its own track in each", async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['eng', 'jpn'],
      });

      await streamSession(sut, [eng, jpn]);

      expect(tracks(getCapturedAudioInput())).toEqual([
        [1, 'eng'],
        [2, 'jpn'],
      ]);
    });

    test('a program without a slot language repeats its main track there', async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['eng', 'jpn'],
      });

      await streamSession(sut, [eng]);

      expect(tracks(getCapturedAudioInput())).toEqual([
        [1, 'eng'],
        [1, 'jpn'],
      ]);
    });

    test("the layout's order wins over the program's main track", async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['jpn', 'eng'],
      });

      await streamSession(sut, [eng, jpn]);

      expect(tracks(getCapturedAudioInput())).toEqual([
        [2, 'jpn'],
        [1, 'eng'],
      ]);
    });

    test.each([[null], [[] as string[]]])(
      'without a layout (%j) a program keeps one track in its own language',
      async (audioTracks) => {
        const { sut, getCapturedAudioInput } = makeSut({ audioTracks });

        await streamSession(sut, [eng, jpn]);

        expect(tracks(getCapturedAudioInput())).toEqual([[1, 'eng']]);
      },
    );

    test('a program without audio has silence in every slot', async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['eng', 'jpn'],
      });

      await streamSession(sut, undefined);

      const input = getCapturedAudioInput();
      expect(input).toBeInstanceOf(NullAudioInputSource);
      expect(tracks(input)).toEqual([
        [0, 'eng'],
        [0, 'jpn'],
      ]);
    });

    test('gap music plays in every slot', async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['eng', 'jpn'],
      });

      await sut.createPlaceholderSession({
        kind: 'offline',
        duration: dayjs.duration({ seconds: 90 }),
        outputFormat: MpegTsOutputFormat,
        backgroundMusic: {
          source: new FileStreamSource('/media/music/01.flac'),
          audioStream: { index: 0, codec: 'flac', channels: 2 },
          trackDurationMs: 240_000,
        },
      });

      expect(tracks(getCapturedAudioInput())).toEqual([
        [0, 'eng'],
        [0, 'jpn'],
      ]);
    });

    test.each(['offline', 'error'] as const)(
      'the %s placeholder has its audio in every slot',
      async (kind) => {
        const { sut, getCapturedAudioInput } = makeSut({
          audioTracks: ['eng', 'jpn', 'spa'],
        });

        await sut.createPlaceholderSession(
          kind === 'offline'
            ? {
                kind,
                duration: dayjs.duration({ seconds: 90 }),
                outputFormat: MpegTsOutputFormat,
              }
            : {
                kind,
                title: 'Error',
                duration: dayjs.duration({ seconds: 90 }),
                outputFormat: MpegTsOutputFormat,
              },
        );

        expect(tracks(getCapturedAudioInput())).toEqual([
          [0, 'eng'],
          [0, 'jpn'],
          [0, 'spa'],
        ]);
      },
    );

    test.each([
      [['eng', 'jpn'], true],
      [null, false],
    ])(
      'the MPEG-TS concat maps every stream with a layout (%j: %s)',
      async (audioTracks, mapAll) => {
        const { sut, getCapturedFfmpegState } = makeSut({ audioTracks });

        await sut.createConcatSession('http://localhost/stream.ts', {
          mode: 'mpegts_concat',
          outputFormat: MpegTsOutputFormat,
        });

        expect(getCapturedFfmpegState()?.mapAllStreams).toBe(mapAll);
      },
    );

    test('the HLS-slower concat re-encodes the audio streams after the video, tagged', async () => {
      const { sut, getCapturedAudioInput } = makeSut({
        audioTracks: ['eng', 'jpn'],
      });

      await sut.createConcatSession('http://localhost/stream.nut', {
        mode: 'hls_slower_concat',
        outputFormat: MpegTsOutputFormat,
      });

      expect(tracks(getCapturedAudioInput())).toEqual([
        [1, 'eng'],
        [2, 'jpn'],
      ]);
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
        pipelineOutputFrameRate?: number;
        sessionCaptionsEnabled?: boolean;
        noAudio?: boolean;
        streamMode?: 'hls' | 'mpegts';
        // The program's subtitle tracks, both files by default; null for
        // none, which the stream details leave undefined
        subtitles?: NonEmptyArray<SubtitleStreamDetails> | null;
        lineupItem?: ContentBackedStreamLineupItem;
        settings?: Partial<ReturnType<typeof makeFfmpegSettings>>;
        channel?: Partial<ChannelOrm>;
        // The channel's transcode config (H.264 by default)
        transcodeConfig?: Partial<TranscodeConfigOrm>;
        // The source's reported frame rate (24 by default)
        framerate?: number | string;
        // Stands in for the factory's own logger
        logger?: Logger;
      }) {
        const capturing = createCapturingPipelineBuilderFactory(
          opts.pipelineOutputFrameRate,
        );
        const details = makeStreamDetails();
        if (opts.noAudio) details.audioDetails = undefined;
        const [video] = details.videoDetails ?? [];
        if (video && opts.framerate !== undefined) {
          video.framerate = opts.framerate;
        }
        details.subtitleDetails =
          opts.subtitles === null
            ? undefined
            : (opts.subtitles ?? [fullTrack(), forcedTrack()]);
        const sut = new FfmpegStreamFactory(
          makeMockFfmpegInfo(),
          makeMockSettingsDB({
            ...makeFfmpegSettings(),
            hdhrClosedCaptions: opts.hdhrClosedCaptions ?? true,
            ...opts.settings,
          }),
          capturing.factory,
          makeMockChannelDB(),
          makeMockFeatureFlagService({ webvttSidecarEnabled: false }),
          makeMockStreamSelector(opts.selected),
          makeTranscodeConfig(opts.transcodeConfig),
          makeChannel({ subtitlesEnabled: true, ...opts.channel }),
        );
        if (opts.logger !== undefined) {
          (sut as unknown as { logger: Logger }).logger = opts.logger;
        }
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
            captionsEnabled: opts.sessionCaptionsEnabled,
          },
          lineupItem: opts.lineupItem ?? makeLineupItem(),
        });
        return {
          method: capturing.getCapturedSubtitleInput()?.method,
          characterEncoding:
            capturing.getCapturedSubtitleInput()?.characterEncoding,
          captions: result?.renditions.captions,
          outputFrameRate: capturing.getCapturedFrameState()?.frameRate,
        };
      }

      test.each([true, false])(
        'keeps the session caption decision %s after a settings change',
        async (enabled) => {
          const { captions } = await run({
            selected: fullTrack(),
            hdhrClosedCaptions: !enabled,
            sessionCaptionsEnabled: enabled,
          });
          expect(captions !== undefined).toBe(enabled);
        },
      );

      describe('frame rate', () => {
        test('lays captions out at the final pipeline rate after deinterlacing', async () => {
          const { captions, outputFrameRate } = await run({
            selected: fullTrack(),
            framerate: 30,
            pipelineOutputFrameRate: 60,
          });
          expect(outputFrameRate).toBe(30);
          expect(captions?.frameRate).toBe(60);
        });

        test('pins the output to the source rate, and lays captions out at it', async () => {
          const { captions, outputFrameRate } = await run({
            selected: fullTrack(),
            framerate: '24000/1001',
          });
          expect(outputFrameRate).toBe(24000 / 1001);
          expect(captions?.frameRate).toBe(24000 / 1001);
        });

        test('gives a source reporting a rate that is not standard 29.97, captions too', async () => {
          // A DVD rip reporting 20 fps whose frames come about 24 a second: the
          // output kept 20, dropping frames and the caption pairs on them
          const { captions, outputFrameRate } = await run({
            selected: fullTrack(),
            framerate: 20,
          });
          expect(outputFrameRate).toBe(30000 / 1001);
          expect(captions?.frameRate).toBe(30000 / 1001);
        });

        test('lays the notice out at the output rate too', async () => {
          const { captions, outputFrameRate } = await run({
            selected: null,
            subtitles: null,
            framerate: 20,
          });
          expect(outputFrameRate).toBe(30000 / 1001);
          expect(captions?.frameRate).toBe(30000 / 1001);
        });

        test('leaves a standard rate unpinned when captions are off', async () => {
          const { outputFrameRate } = await run({
            selected: fullTrack(),
            hdhrClosedCaptions: false,
            framerate: '24000/1001',
          });
          expect(outputFrameRate).toBeNull();
        });
      });

      test('burns Japanese subtitles instead of sending empty CEA-608 captions', async () => {
        fs.writeFileSync(
          fullSubs,
          '1\n00:00:11,000 --> 00:00:20,000\nこんにちは世界\n',
        );
        const track = fullTrack();
        const warn = vi.fn();
        const { method, captions } = await run({
          selected: track,
          subtitles: [track],
          logger: { warn, debug: vi.fn(), trace: vi.fn() } as unknown as Logger,
        });
        expect(method).toBe(SubtitleMethods.Burn);
        expect(captions).toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
      });

      test.each([
        { damagedCues: 1, method: SubtitleMethods.Convert },
        { damagedCues: 2, method: SubtitleMethods.Burn },
      ])(
        'uses $method with $damagedCues unsupported cues out of ten',
        async ({ damagedCues, method }) => {
          fs.writeFileSync(
            fullSubs,
            Array.from({ length: 10 }, (_, i) => {
              const second = 11 + i * 2;
              const text = i < damagedCues ? 'こんにちは' : 'Hello';
              return `${i + 1}\n00:00:${second},000 --> 00:00:${second + 1},000\n${text}\n`;
            }).join('\n'),
          );
          const track = fullTrack();
          const result = await run({ selected: track, subtitles: [track] });
          expect(result.method).toBe(method);
          expect(result.captions !== undefined).toBe(damagedCues === 1);
        },
      );

      test('loads fallback captions without selecting a subtitle input when audio is absent', async () => {
        const { method, captions } = await run({
          selected: fullTrack(),
          noAudio: true,
        });
        expect(method).toBeUndefined();
        expect(captions?.cues).toEqual([
          { startMs: 2000, endMs: 4500, text: 'Hello there' },
        ]);
      });

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

      // Read before the program's ffmpeg starts, so on the tune-in path
      test('logs how long reading the subtitles took, with the file name and cue count', async () => {
        const logger = {
          debug: vi.fn(),
          trace: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };
        await run({
          selected: fullTrack(),
          logger: logger as unknown as Logger,
        });

        const lines = logger.debug.mock.calls.filter(
          ([message]) =>
            typeof message === 'string' && message.startsWith('Read subtitles'),
        );
        expect(lines).toHaveLength(1);
        const [, file, readMs, cues] = lines[0] ?? [];
        // The file's name only, not where it lives
        expect(file).toBe('full.srt');
        expect(Number(readMs)).toBeGreaterThanOrEqual(0);
        // The cue before the 10 s seek is not in this program
        expect(cues).toBe(1);
      });

      // Also on the tune-in path: the file gives both the captions and the
      // charset ffmpeg reads it in
      describe('reads the selected subtitle file once', () => {
        async function readsOf(file: string, run: () => Promise<unknown>) {
          const readFile = vi.spyOn(fsPromises, 'readFile');
          try {
            await run();
            return readFile.mock.calls.filter(([path]) => path === file).length;
          } finally {
            readFile.mockRestore();
          }
        }

        test('when it becomes captions', async () => {
          expect(
            await readsOf(fullSubs, () => run({ selected: fullTrack() })),
          ).toBe(1);
        });

        test('when it is burned in instead, with captions off', async () => {
          expect(
            await readsOf(fullSubs, () =>
              run({ selected: fullTrack(), hdhrClosedCaptions: false }),
            ),
          ).toBe(1);
        });

        test('telling ffmpeg the charset of a Windows-1252 file', async () => {
          const legacy = path.join(dir.name, 'legacy.srt');
          fs.writeFileSync(
            legacy,
            Buffer.from(
              '1\n00:00:12,000 --> 00:00:14,500\nUn caf\u00e9\n',
              'latin1',
            ),
          );
          const track = { ...textSubtitleStream, path: legacy };
          let result: Awaited<ReturnType<typeof run>> | undefined;
          const reads = await readsOf(legacy, async () => {
            result = await run({ selected: track, subtitles: [track] });
          });

          expect(reads).toBe(1);
          expect(result?.characterEncoding).toBe('WINDOWS-1252');
          expect(result?.captions?.cues).toEqual([
            { startMs: 2000, endMs: 4500, text: 'Un caf\u00e9' },
          ]);
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

      // Captions can only be added to H.264 video: with HEVC the segments went
      // out with neither captions nor the burned-in subtitles they replaced
      describe.each(['hevc', 'mpeg2video'] as const)(
        'with %s output video',
        (videoFormat) => {
          const transcodeConfig = { videoFormat };

          test('burns full text subtitles in, as with captions off', async () => {
            const { method, captions } = await run({
              selected: fullTrack(),
              transcodeConfig,
            });

            expect(method).toBe(SubtitleMethods.Burn);
            expect(captions).toBeUndefined();
          });

          test('adds no notice to a program without subtitles', async () => {
            const { captions } = await run({
              selected: null,
              subtitles: null,
              transcodeConfig,
            });

            expect(captions).toBeUndefined();
          });

          test('sends no test pattern', async () => {
            const { captions } = await run({
              selected: null,
              settings: { hdhrCaptionTestPattern: true },
              transcodeConfig,
            });

            expect(captions).toBeUndefined();
          });

          test('leaves a standard rate unpinned', async () => {
            const { outputFrameRate } = await run({
              selected: fullTrack(),
              framerate: '24000/1001',
              transcodeConfig,
            });

            expect(outputFrameRate).toBeNull();
          });

          test('still pins the rate for Normalize Frame Rate', async () => {
            const { outputFrameRate } = await run({
              selected: fullTrack(),
              framerate: '24000/1001',
              transcodeConfig: { ...transcodeConfig, normalizeFrameRate: true },
            });

            expect(outputFrameRate).toBe(24000 / 1001);
          });

          // A session makes a factory per program (ProgramStream), as `run`
          // does, so a line here came once per program. The .ts wrapper says
          // it once when its stream starts instead (ConcatStream).
          test('says nothing about captions, program after program', async () => {
            const logger = {
              debug: vi.fn(),
              trace: vi.fn(),
              info: vi.fn(),
              warn: vi.fn(),
              error: vi.fn(),
            };
            for (const _program of [1, 2]) {
              const { method, captions } = await run({
                selected: fullTrack(),
                transcodeConfig,
                logger: logger as unknown as Logger,
              });
              expect(method).toBe(SubtitleMethods.Burn);
              expect(captions).toBeUndefined();
            }

            const captionLines = logger.info.mock.calls.filter(
              ([message]) =>
                typeof message === 'string' && message.includes('captions'),
            );
            expect(captionLines).toEqual([]);
          });
        },
      );

      test('sends captions with H.264 output video', async () => {
        const { method, captions, outputFrameRate } = await run({
          selected: fullTrack(),
          framerate: '24000/1001',
          transcodeConfig: { videoFormat: 'h264' },
        });

        expect(method).toBe(SubtitleMethods.Convert);
        expect(captions?.cues).toHaveLength(1);
        expect(outputFrameRate).toBe(24000 / 1001);
      });

      describe('the caption test pattern', () => {
        test("replaces a program's captions", async () => {
          const { captions } = await run({
            selected: null,
            settings: { hdhrCaptionTestPattern: true },
          });
          expect(captions?.cues[0]?.text).toBe('1 WHITE TEXT');
          expect(captions?.frameRate).toBe(24);
        });

        test('replaces the notice for a program without subtitles', async () => {
          const { captions } = await run({
            selected: null,
            subtitles: null,
            settings: { hdhrCaptionTestPattern: true },
          });
          expect(captions?.cues[0]?.text).toBe('1 WHITE TEXT');
        });

        test('sends nothing when captions are off', async () => {
          const { captions } = await run({
            selected: null,
            hdhrClosedCaptions: false,
            settings: { hdhrCaptionTestPattern: true },
          });
          expect(captions).toBeUndefined();
        });

        // A test channel shows the samples while every other channel keeps
        // its programs' captions
        test("replaces a program's captions on a channel that turns it on for itself", async () => {
          const { captions } = await run({
            selected: null,
            channel: { captions: { testPattern: true } },
          });
          expect(captions?.cues[0]?.text).toBe('1 WHITE TEXT');
        });

        test('leaves other channels as they are', async () => {
          const { captions } = await run({ selected: null });
          expect(captions?.cues[0]?.text).toBe('Hello there');
        });

        test('needs the global closed-captions switch, like the global test pattern', async () => {
          const { captions } = await run({
            selected: null,
            hdhrClosedCaptions: false,
            channel: { captions: { testPattern: true } },
          });
          expect(captions).toBeUndefined();
        });
      });

      describe("a channel's own caption look", () => {
        test("comes with the program's captions, over the global look", async () => {
          const { captions } = await run({
            selected: fullTrack(),
            settings: {
              hdhrCaptionAppearance: {
                ...makeFfmpegSettings().hdhrCaptionAppearance,
                textColor: 'yellow',
              },
            },
            channel: {
              captions: {
                alignment: 'left',
                appearance: { backgroundColor: 'magenta' },
              },
            },
          });

          // The channel's fields win; the rest is the global look
          expect(captions?.appearance).toMatchObject({
            backgroundColor: 'magenta',
            textColor: 'yellow',
            alignment: 'left',
          });
        });

        test('is absent for a channel without one, which uses the global look', async () => {
          const { captions } = await run({
            selected: fullTrack(),
            channel: { captions: { testPattern: false } },
          });
          expect(captions?.cues).toHaveLength(1);
          expect(captions?.appearance).toBeUndefined();
        });

        test('times the notice for a program without subtitles', async () => {
          // A box takes longer to load, so the notice waits for it
          const plain = await run({ selected: null, subtitles: null });
          const boxed = await run({
            selected: null,
            subtitles: null,
            channel: {
              captions: {
                appearance: { backgroundColor: 'blue', textColor: 'red' },
              },
            },
          });

          expect(plain.captions?.cues[0]?.startMs).toBe(1000);
          expect(boxed.captions?.cues[0]?.startMs).toBeGreaterThan(1000);
        });
      });

      describe('the notice for a program without subtitles', () => {
        test('captions a program without subtitles with a short notice', async () => {
          const { method, captions } = await run({
            selected: null,
            subtitles: null,
          });

          expect(method).toBeUndefined();
          // Near the start of the program's stream (the 10 s seek is its time 0)
          expect(captions).toEqual({
            cues: [
              {
                startMs: 1000,
                endMs: 5000,
                text: 'No captions for this program',
              },
            ],
            frameRate: 24,
            durationMs: 30000,
            language: 'eng',
          });
        });

        // A box and a colour take longer to load, so the notice waits for them
        test('starts the notice later when the appearance takes longer to load', async () => {
          const { captions } = await run({
            selected: null,
            subtitles: null,
            settings: {
              hdhrCaptionAppearance: {
                ...makeFfmpegSettings().hdhrCaptionAppearance,
                backgroundColor: 'blue',
                textColor: 'red',
                lineWidth: 20,
              },
            },
          });

          expect(captions?.cues[0]?.startMs).toBeGreaterThan(1000);
        });

        test('leaves a program whose subtitles cannot become captions as it is', async () => {
          // Image-based subtitles stay burned in, and are no reason for a notice
          const { method, captions } = await run({
            selected: imageSubtitleStream,
            subtitles: [imageSubtitleStream],
          });

          expect(method).toBe(SubtitleMethods.Burn);
          expect(captions).toBeUndefined();
        });

        test('adds no notice to filler', async () => {
          const program = makeLineupItem();
          for (const lineupItem of [
            { ...program, type: 'commercial', fillerListId: 'filler-list' },
            { ...program, type: 'fallback' },
          ] satisfies ContentBackedStreamLineupItem[]) {
            const { captions } = await run({
              selected: null,
              subtitles: null,
              lineupItem,
            });

            expect(captions).toBeUndefined();
          }
        });

        test('adds no notice when captions are off', async () => {
          for (const opts of [
            { hdhrClosedCaptions: false },
            { streamMode: 'mpegts' as const },
          ]) {
            const { captions } = await run({
              selected: null,
              subtitles: null,
              ...opts,
            });

            expect(captions).toBeUndefined();
          }
        });

        test('adds no notice to an offline gap', async () => {
          const sut = new FfmpegStreamFactory(
            makeMockFfmpegInfo(),
            makeMockSettingsDB({
              ...makeFfmpegSettings(),
              hdhrClosedCaptions: true,
            }),
            createCapturingPipelineBuilderFactory().factory,
            makeMockChannelDB(),
            makeMockFeatureFlagService(),
            makeMockStreamSelector(),
            makeTranscodeConfig(),
            makeChannel({ subtitlesEnabled: true }),
          );

          const result = await sut.createPlaceholderSession({
            kind: 'offline',
            duration: dayjs.duration({ seconds: 30 }),
            outputFormat: HlsOutputFormat(defaultHlsOptions),
          });

          expect(result).toBeDefined();
          expect(result?.renditions.captions).toBeUndefined();
        });
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
