import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import { FileStreamSource, HttpStreamSource } from '../../../stream/types.ts';
import {
  EmptyFfmpegCapabilities,
  FfmpegCapabilities,
} from '../capabilities/FfmpegCapabilities.ts';
import {
  defaultHlsOptions,
  HlsDirectOutputFormat,
  HlsOutputFormat,
} from '../constants.ts';
import { AudioFadeFilter } from '../filter/AudioFadeFilter.ts';
import { AudioVolumeFilter } from '../filter/AudioVolumeFilter.ts';
import { LoudnormFilter } from '../filter/LoudnormFilter.ts';
import { PixelFormatYuv420P } from '../format/PixelFormat.ts';
import { AudioInputSource } from '../input/AudioInputSource.ts';
import { ConcatInputSource } from '../input/ConcatInputSource.ts';
import { SubtitlesInputSource } from '../input/SubtitlesInputSource.ts';
import { VideoInputSource } from '../input/VideoInputSource.ts';
import {
  AudioStream,
  ExternalSubtitleStream,
  SubtitleMethods,
  VideoStream,
} from '../MediaStream.ts';
import { AudioState } from '../state/AudioState.ts';
import { DefaultPipelineOptions, FfmpegState } from '../state/FfmpegState.ts';
import { FrameState } from '../state/FrameState.ts';
import { FrameSize } from '../types.ts';
import { BasePipelineBuilder } from './BasePipelineBuilder.ts';

dayjs.extend(duration);

class NoopPipelineBuilder extends BasePipelineBuilder {
  protected setupVideoFilters(): void {}
}

describe('BasePipelineBuilder', () => {
  const audio = AudioInputSource.withStream(
    new FileStreamSource('/path/to/song.flac'),
    AudioStream.create({
      channels: 2,
      codec: 'flac',
      index: 0,
    }),
    AudioState.create({
      audioBitrate: 192,
      audioBufferSize: 192 * 2,
      audioChannels: 2,
      audioVolume: 150,
    }),
  );

  const video = VideoInputSource.withStream(
    new FileStreamSource('/path/to/video.mkv'),
    VideoStream.create({
      codec: 'h264',
      displayAspectRatio: '16:9',
      frameSize: FrameSize.withDimensions(1920, 900),
      index: 0,
      pixelFormat: new PixelFormatYuv420P(),
      providedSampleAspectRatio: null,
    }),
  );

  const state = FfmpegState.create({
    version: {
      versionString: 'n7.0.2-15-g0458a86656-20240904',
      majorVersion: 7,
      minorVersion: 0,
      patchVersion: 2,
      isUnknown: false,
    },
  });

  const frameState = new FrameState({
    isAnamorphic: false,
    paddedSize: FrameSize.FHD,
    scaledSize: FrameSize.FHD,
  });

  test('set audio volume filter', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        audioVolume: 150,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const volumeFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof AudioVolumeFilter,
    );

    expect(volumeFilter).toBeDefined();
    expect(volumeFilter?.filter).toEqual(`volume=1.500`);
  });

  test('ignore invalid audio volume filter', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        audioVolume: -100,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const volumeFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof AudioVolumeFilter,
    );

    expect(volumeFilter).toBeUndefined();
  });

  test('add loudnorm filter when loudnormConfig is set', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        loudnormConfig: { i: -24, lra: 7, tp: -2 },
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeDefined();
    expect(loudnormFilter?.filter).toEqual(
      'loudnorm=I=-24:LRA=7:TP=-2,aresample=48000',
    );
  });

  test('add loudnorm filter with custom offset gain', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        loudnormConfig: { i: -16, lra: 11, tp: -1, offsetGain: 3 },
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeDefined();
    expect(loudnormFilter?.filter).toEqual(
      'loudnorm=I=-16:LRA=11:TP=-1:offset=3,aresample=48000',
    );
  });

  test('use custom sample rate in loudnorm filter when audioSampleRate is set', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        audioSampleRate: 44.1,
        loudnormConfig: { i: -24, lra: 7, tp: -2 },
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeDefined();
    expect(loudnormFilter?.filter).toEqual(
      'loudnorm=I=-24:LRA=7:TP=-2,aresample=44100',
    );
  });

  test('do not add loudnorm filter when audio encoder is copy', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioEncoder: 'copy',
        loudnormConfig: { i: -24, lra: 7, tp: -2 },
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeUndefined();
  });

  test.each([
    { desc: 'i too low', config: { i: -70.1, lra: 7, tp: -2 } },
    { desc: 'i too high', config: { i: -4.9, lra: 7, tp: -2 } },
    { desc: 'lra too low', config: { i: -24, lra: 0.9, tp: -2 } },
    { desc: 'lra too high', config: { i: -24, lra: 50.1, tp: -2 } },
    { desc: 'tp too low', config: { i: -24, lra: 7, tp: -9.1 } },
    { desc: 'tp too high', config: { i: -24, lra: 7, tp: 0.1 } },
  ])('do not add loudnorm filter when $desc', ({ config }) => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        loudnormConfig: config,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeUndefined();
  });

  test.each([
    { desc: 'i at lower bound', config: { i: -70, lra: 7, tp: -2 } },
    { desc: 'i at upper bound', config: { i: -5, lra: 7, tp: -2 } },
    { desc: 'lra at lower bound', config: { i: -24, lra: 1, tp: -2 } },
    { desc: 'lra at upper bound', config: { i: -24, lra: 50, tp: -2 } },
    { desc: 'tp at lower bound', config: { i: -24, lra: 7, tp: -9 } },
    { desc: 'tp at upper bound', config: { i: -24, lra: 7, tp: 0 } },
  ])('add loudnorm filter when $desc', ({ config }) => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        loudnormConfig: config,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeDefined();
  });

  test('do not add loudnorm filter when loudnormConfig is not set', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);

    const loudnormFilter = result.inputs.audioInput?.filterSteps.find(
      (step) => step instanceof LoudnormFilter,
    );

    expect(loudnormFilter).toBeUndefined();
  });

  test('adds gap music fades after loudness normalization', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/track.flac'),
      AudioStream.create({ channels: 2, codec: 'flac', index: 0 }),
      AudioState.create({
        audioEncoder: 'ac3',
        audioChannels: 6,
        audioDuration: 90_000,
        loudnormConfig: { i: -24, lra: 11, tp: -2 },
        fades: {
          fadeInMs: 1000,
          fadeOut: { startMs: 87_000, durationMs: 3000 },
        },
      }),
    );

    const steps =
      new NoopPipelineBuilder(
        video,
        audio,
        null,
        null,
        null,
        EmptyFfmpegCapabilities,
      ).build(state, frameState, DefaultPipelineOptions).inputs.audioInput
        ?.filterSteps ?? [];

    const loudnormIdx = steps.findIndex((s) => s instanceof LoudnormFilter);
    const fades = steps
      .filter((s) => s instanceof AudioFadeFilter)
      .map((s) => s.filter);
    expect(loudnormIdx).toBeGreaterThan(-1);
    expect(
      steps.findIndex((s) => s instanceof AudioFadeFilter),
    ).toBeGreaterThan(loudnormIdx);
    expect(fades).toEqual([
      'afade=t=in:st=0.000:d=1.000',
      'afade=t=out:st=87.000:d=3.000',
    ]);
  });

  describe('audio language tag', () => {
    function argsForAudioLanguage(language: string | undefined) {
      const audio = AudioInputSource.withStream(
        new FileStreamSource('/path/to/movie.mkv'),
        AudioStream.create({
          channels: 6,
          codec: 'ac3',
          index: 1,
          language,
        }),
        AudioState.create({
          audioEncoder: 'ac3',
          audioBitrate: 640,
          audioBufferSize: 1280,
          audioChannels: 6,
        }),
      );

      return new NoopPipelineBuilder(
        video,
        audio,
        null,
        null,
        null,
        EmptyFfmpegCapabilities,
      )
        .build(state, frameState, DefaultPipelineOptions)
        .getCommandArgs();
    }

    test("tags the output audio with the source track's language", () => {
      // Without it clients like Plex treat every program as foreign-language audio
      const args = argsForAudioLanguage('eng');
      const idx = args.indexOf('-metadata:s:a:0');
      expect(idx).toBeGreaterThan(args.lastIndexOf('-i'));
      expect(args[idx + 1]).toBe('language=eng');
    });

    test.each([undefined, '', 'english', 'EN'])(
      'adds no language tag for %j (not an ISO 639-2 code)',
      (language) => {
        expect(argsForAudioLanguage(language)).not.toContain('-metadata:s:a:0');
      },
    );
  });

  describe('several output audio tracks (a fixed audio track layout)', () => {
    function argsForTracks(
      streams: { index: number; channels: number; language: string }[],
      audioVolume = 100,
    ) {
      const audio = new AudioInputSource(
        new FileStreamSource('/path/to/movie.mkv'),
        streams.map((s) => AudioStream.create({ codec: 'ac3', ...s })),
        AudioState.create({
          audioEncoder: 'aac',
          audioBitrate: 192,
          audioBufferSize: 384,
          audioChannels: 2,
          audioVolume,
        }),
      );

      return new NoopPipelineBuilder(
        video,
        audio,
        null,
        null,
        null,
        EmptyFfmpegCapabilities,
      )
        .build(state, frameState, DefaultPipelineOptions)
        .getCommandArgs();
    }

    function maps(args: string[]) {
      return args.flatMap((a, i) => (a === '-map' ? [args[i + 1]] : []));
    }

    test('maps one filtered chain per track, in order', () => {
      const args = argsForTracks([
        { index: 1, channels: 2, language: 'eng' },
        { index: 2, channels: 2, language: 'jpn' },
      ]);
      const graph = args[args.indexOf('-filter_complex') + 1] ?? '';

      expect(maps(args)).toEqual(['0:0', '[a0]', '[a1]']);
      // the audio file is the second input
      expect(graph).toMatch(/\[1:1\]aresample=async=1[^;]*\[a0\]/);
      expect(graph).toMatch(/\[1:2\]aresample=async=1[^;]*\[a1\]/);
    });

    test('a source track repeated into a second slot gets its own chain', () => {
      // A program without the second language repeats its main track there
      const args = argsForTracks([
        { index: 1, channels: 2, language: 'eng' },
        { index: 1, channels: 2, language: 'jpn' },
      ]);
      const graph = args[args.indexOf('-filter_complex') + 1] ?? '';

      expect(maps(args)).toEqual(['0:0', '[a0]', '[a1]']);
      expect(graph.match(/\[1:1\]/g)).toHaveLength(2);
    });

    test('tags each track with its own language', () => {
      const args = argsForTracks([
        { index: 1, channels: 2, language: 'eng' },
        { index: 2, channels: 2, language: 'jpn' },
      ]);

      expect(args[args.indexOf('-metadata:s:a:0') + 1]).toBe('language=eng');
      expect(args[args.indexOf('-metadata:s:a:1') + 1]).toBe('language=jpn');
    });

    test('sets the channel count when any track differs from it', () => {
      const args = argsForTracks([
        { index: 1, channels: 2, language: 'eng' },
        { index: 2, channels: 6, language: 'jpn' },
      ]);

      expect(args[args.indexOf('-ac') + 1]).toBe('2');
    });

    test('one track keeps the single-track labels', () => {
      const args = argsForTracks([{ index: 1, channels: 2, language: 'eng' }]);

      expect(maps(args)).toEqual(['0:0', '[a]']);
      expect(args).not.toContain('-metadata:s:a:1');
      expect(args).not.toContain('-ac');
    });
  });

  test('always add channel count for Opus', () => {
    const audio = AudioInputSource.withStream(
      new FileStreamSource('/path/to/movie.mkv'),
      AudioStream.create({
        channels: 6,
        codec: 'ac3',
        index: 0,
      }),
      AudioState.create({
        audioEncoder: 'libopus',
        audioChannels: 6,
      }),
    );

    const pipeline = new NoopPipelineBuilder(
      video,
      audio,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(state, frameState, DefaultPipelineOptions);
    const commandArgs = result.getCommandArgs();
    const channelIdx = commandArgs?.indexOf('-ac');
    expect(channelIdx).toBeDefined();
    expect(commandArgs?.at(channelIdx + 1)).toBe('6');
  });

  // Fresh video/audio input sources per seek test: BasePipelineBuilder
  // mutates the input sources it's given (addOptions), so reusing the
  // describe-level `video`/`audio` here would leak `-ss` flags added by
  // one test's build() into another test's assertions.
  function makeVideo() {
    return VideoInputSource.withStream(
      new FileStreamSource('/path/to/video.mkv'),
      VideoStream.create({
        codec: 'h264',
        displayAspectRatio: '16:9',
        frameSize: FrameSize.withDimensions(1920, 900),
        index: 0,
        pixelFormat: new PixelFormatYuv420P(),
        providedSampleAspectRatio: null,
      }),
    );
  }

  function makeAudio() {
    return AudioInputSource.withStream(
      new FileStreamSource('/path/to/song.flac'),
      AudioStream.create({
        channels: 2,
        codec: 'flac',
        index: 0,
      }),
      AudioState.create({
        audioBitrate: 192,
        audioBufferSize: 192 * 2,
        audioChannels: 2,
        audioVolume: 150,
      }),
    );
  }

  test('apply the stream seek offset to an external sidecar subtitle input on the hls (transcode) output', () => {
    const seekState = FfmpegState.create({
      version: state.version,
      start: dayjs.duration(90_000),
      outputFormat: HlsOutputFormat(defaultHlsOptions),
    });

    const subtitle = new SubtitlesInputSource(
      new FileStreamSource('/path/to/movie.srt'),
      [new ExternalSubtitleStream('subrip', SubtitleMethods.Convert)],
      SubtitleMethods.Convert,
    );

    const pipeline = new NoopPipelineBuilder(
      makeVideo(),
      makeAudio(),
      null,
      subtitle,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(
      seekState,
      frameState,
      DefaultPipelineOptions,
    );
    const commandArgs = result.getCommandArgs();

    const subtitleInputIdx = commandArgs.indexOf('/path/to/movie.srt');
    expect(subtitleInputIdx).toBeGreaterThan(0);
    expect(commandArgs[subtitleInputIdx - 1]).toBe('-i');
    expect(commandArgs[subtitleInputIdx - 2]).toBe('90000ms');
    expect(commandArgs[subtitleInputIdx - 3]).toBe('-ss');
    expect(commandArgs[subtitleInputIdx - 4]).toBe('1');
    expect(commandArgs[subtitleInputIdx - 5]).toBe('-seek_timestamp');
  });

  test('do not seek the external sidecar subtitle input on the hls_direct_v2 output', () => {
    const seekState = FfmpegState.create({
      version: state.version,
      start: dayjs.duration(90_000),
      outputFormat: HlsDirectOutputFormat(defaultHlsOptions),
    });

    const subtitle = new SubtitlesInputSource(
      new FileStreamSource('/path/to/movie.srt'),
      [new ExternalSubtitleStream('subrip', SubtitleMethods.Convert)],
      SubtitleMethods.Convert,
    );

    const pipeline = new NoopPipelineBuilder(
      makeVideo(),
      makeAudio(),
      null,
      subtitle,
      null,
      EmptyFfmpegCapabilities,
    );

    const result = pipeline.build(
      seekState,
      frameState,
      DefaultPipelineOptions,
    );
    const commandArgs = result.getCommandArgs();

    const subtitleInputIdx = commandArgs.indexOf('/path/to/movie.srt');
    expect(subtitleInputIdx).toBeGreaterThan(0);
    expect(commandArgs[subtitleInputIdx - 1]).toBe('-i');
    expect(commandArgs).not.toContain('-seek_timestamp');
    expect(commandArgs[subtitleInputIdx - 2]).not.toBe('-ss');

    // video/audio are still seeked (subtitle is not, so only 2 -ss flags)
    const seekCount = commandArgs.filter((arg) => arg === '-ss').length;
    expect(seekCount).toBe(2);
  });
});

describe('BasePipelineBuilder HLS stream timing', () => {
  const version = {
    versionString: 'n7.1.1',
    majorVersion: 7,
    minorVersion: 1,
    patchVersion: 1,
    isUnknown: false,
  };

  test("writes the HLS options' segment length", () => {
    const video = VideoInputSource.withStream(
      new FileStreamSource('/path/to/video.mkv'),
      VideoStream.create({
        codec: 'h264',
        displayAspectRatio: '16:9',
        frameSize: FrameSize.FHD,
        index: 0,
        pixelFormat: new PixelFormatYuv420P(),
        providedSampleAspectRatio: null,
      }),
    );
    const hlsState = FfmpegState.create({
      version,
      outputFormat: HlsOutputFormat({ ...defaultHlsOptions, hlsTime: 2 }),
    });

    const args = new NoopPipelineBuilder(
      video,
      null,
      null,
      null,
      null,
      EmptyFfmpegCapabilities,
    )
      .build(
        hlsState,
        new FrameState({
          isAnamorphic: false,
          paddedSize: FrameSize.FHD,
          scaledSize: FrameSize.FHD,
        }),
        DefaultPipelineOptions,
      )
      .getCommandArgs();

    expect(args[args.indexOf('-hls_time') + 1]).toBe('2');
    expect(args).toContain('expr:gte(t,n_forced*2)');
  });

  describe('HLS wrapper start-up burst', () => {
    const withBurstOption = new FfmpegCapabilities(
      new Set(['readrate_initial_burst']),
      new Map(),
      new Set(),
      new Set(),
    );

    function wrapArgs(burstSeconds: number) {
      const input = new ConcatInputSource(
        new HttpStreamSource(
          'http://localhost:8000/stream/channels/test-uuid.m3u8',
        ),
        FrameSize.FHD,
      );
      const wrapState = FfmpegState.forConcat(version, 'Test');
      wrapState.readrateInitialBurstSeconds = burstSeconds;
      return new NoopPipelineBuilder(
        null,
        null,
        null,
        null,
        input,
        withBurstOption,
      )
        .hlsWrap(input, wrapState)
        .getCommandArgs();
    }

    test.each([
      [true, ['-map', '0']],
      [false, []],
    ])(
      'the MPEG-TS concat maps every stream only when asked (%s)',
      (mapAllStreams, expected) => {
        const input = new ConcatInputSource(
          new HttpStreamSource('http://localhost:8000/stream/channels/x.ts'),
          FrameSize.FHD,
        );
        const concatState = FfmpegState.forConcat(version, 'Test');
        concatState.mapAllStreams = mapAllStreams;
        const args = new NoopPipelineBuilder(
          null,
          null,
          null,
          null,
          input,
          withBurstOption,
        )
          .concat(input, concatState)
          .getCommandArgs();

        // without it ffmpeg keeps one audio track of a fixed layout
        expect(
          args.filter((a, i) => a === '-map' || args[i - 1] === '-map'),
        ).toEqual(expected);
      },
    );

    test('reads the playlist at real-time pace by default', () => {
      const args = wrapArgs(0);

      expect(args[args.indexOf('-readrate') + 1]).toBe('1');
      expect(args).not.toContain('-readrate_initial_burst');
    });

    test('bursts the configured seconds at start', () => {
      const args = wrapArgs(10);

      expect(args[args.indexOf('-readrate_initial_burst') + 1]).toBe('10');
    });
  });
});
