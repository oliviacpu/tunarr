import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import type { StreamDetails } from '@/stream/types.js';
import { VideoPresets } from './builder/constants.ts';
import {
  FfmpegPlaybackParamsCalculator,
  type FfmpegPlaybackParams,
} from './FfmpegPlaybackParamsCalculator.ts';

dayjs.extend(duration);

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

function makeStreamDetails(
  overrides: Partial<NonNullable<StreamDetails['videoDetails']>[number]> = {},
): StreamDetails {
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
        ...overrides,
      },
    ],
  };
}

describe('FfmpegPlaybackParamsCalculator', () => {
  describe('calculateForStream', () => {
    test('sets videoPreset to veryfast for software h264 encoding', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBe(VideoPresets.VeryFast);
    });

    test('sets videoPreset to veryfast for software hevc encoding', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'hevc',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBe(VideoPresets.VeryFast);
    });

    test.each(['h264', 'hevc'] as const)(
      "uses the transcode config's preset for software %s encoding",
      (videoFormat) => {
        const config = makeTranscodeConfig({
          hardwareAccelerationMode: 'none',
          videoFormat,
          videoPreset: 'superfast',
        });

        const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
        const params = calculator.calculateForStream(makeStreamDetails());

        expect(params.videoPreset).toBe(VideoPresets.SuperFast);
      },
    );

    test.each(['', 'turbo', null])(
      'falls back to veryfast when the configured preset is %j',
      (videoPreset) => {
        const config = makeTranscodeConfig({
          hardwareAccelerationMode: 'none',
          videoFormat: 'h264',
          videoPreset,
        });

        const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
        const params = calculator.calculateForStream(makeStreamDetails());

        expect(params.videoPreset).toBe(VideoPresets.VeryFast);
      },
    );

    test('ignores the configured preset for hardware-accelerated encoding', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'cuda',
        videoFormat: 'h264',
        videoPreset: 'superfast',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBeUndefined();
    });

    test('does not set videoPreset for hardware-accelerated encoding', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'cuda',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBeUndefined();
    });

    test('does not set videoPreset for mpeg2video format', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'mpeg2video',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBeUndefined();
    });

    test('does not set videoPreset for HLS direct mode', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(
        config,
        'hls_direct',
      );
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBeUndefined();
    });

    test('does not set videoPreset for HLS direct v2 mode', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(
        config,
        'hls_direct_v2',
      );
      const params = calculator.calculateForStream(makeStreamDetails());

      expect(params.videoPreset).toBeUndefined();
    });

    test('does not clobber videoProfile with the preset value', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const params = calculator.calculateForStream(makeStreamDetails());

      // videoProfile should NOT contain a preset value
      expect(params.videoProfile).not.toBe(VideoPresets.VeryFast);
    });

    test('does not set videoPreset when there are no video details', () => {
      const config = makeTranscodeConfig({
        hardwareAccelerationMode: 'none',
        videoFormat: 'h264',
      });

      const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
      const streamDetails: StreamDetails = {
        duration: dayjs.duration({ seconds: 30 }),
        // No videoDetails
      };

      const params = calculator.calculateForStream(streamDetails);

      expect(params.videoPreset).toBeUndefined();
    });

    describe('normalizeFrameRate', () => {
      // "Normalize Frame Rate" means a constant output frame rate at the source's own rate (as the pipeline before #1349
      // did with an fps filter), which turns variable-frame-rate sources into constant ones. NTSC rates are exact.
      test.each([
        [24, 24],
        [23.976, 24000 / 1001],
        ['24000/1001', 24000 / 1001],
        ['30000/1001', 30000 / 1001],
        ['25', 25],
        ['59.94', 60000 / 1001],
      ])('outputs the source rate %j as %d fps', (framerate, expected) => {
        const config = makeTranscodeConfig({ normalizeFrameRate: true });
        const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate }),
        );

        expect(params.frameRate).toBe(expected);
      });

      test('leaves a standard frame rate alone when the setting is off', () => {
        const config = makeTranscodeConfig({ normalizeFrameRate: false });
        const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate: '24000/1001' }),
        );

        expect(params.frameRate).toBeUndefined();
      });

      test.each([undefined, '', 'abc', '0/0', 0, -5])(
        'sets no frame rate when the source rate %j is unusable',
        (framerate) => {
          const config = makeTranscodeConfig({ normalizeFrameRate: true });
          const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
          const params = calculator.calculateForStream(
            makeStreamDetails({ framerate }),
          );

          expect(params.frameRate).toBeUndefined();
        },
      );
    });

    describe('a source whose reported frame rate is not standard', () => {
      // A DVD rip whose frames alternate 1/24 s and 1/30 s apart reported 20 fps; ffmpeg's HLS output kept 20 and
      // dropped about one frame in six (with the caption pairs they carried)
      test.each([
        [20, 30000 / 1001],
        ['20/1', 30000 / 1001],
        [15, 30000 / 1001],
        [14.26, 30000 / 1001],
        [48, 60000 / 1001],
      ])(
        'outputs the reported rate %j as %d fps, setting or not',
        (framerate, expected) => {
          for (const normalizeFrameRate of [false, true]) {
            const calculator = new FfmpegPlaybackParamsCalculator(
              makeTranscodeConfig({ normalizeFrameRate }),
              'hls',
            );
            const params = calculator.calculateForStream(
              makeStreamDetails({ framerate }),
            );
            expect(params.frameRate).toBe(expected);
          }
        },
      );

      test('applies in MPEG-TS mode too', () => {
        const calculator = new FfmpegPlaybackParamsCalculator(
          makeTranscodeConfig(),
          'mpegts',
        );
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate: 20 }),
        );
        expect(params.frameRate).toBe(30000 / 1001);
      });

      test.each([
        [23.81, 24000 / 1001],
        ['23.98', 24000 / 1001],
        // a little above 30: snapping down to it would drop frames
        [30.3, 60000 / 1001],
      ])(
        'outputs %j, near a standard rate, as %d fps',
        (framerate, expected) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({ normalizeFrameRate: true }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({ framerate }),
          );
          expect(params.frameRate).toBe(expected);
        },
      );
    });

    test('pins a rate snapped up to a standard one with the setting and captions off', () => {
      // ffmpeg's HLS output would keep 23.81 and drop frames from 23.976 video
      const calculator = new FfmpegPlaybackParamsCalculator(
        makeTranscodeConfig({ normalizeFrameRate: false }),
        'hls',
      );
      const params = calculator.calculateForStream(
        makeStreamDetails({ framerate: 23.81 }),
      );
      expect(params.frameRate).toBe(24000 / 1001);
    });

    describe('pinFrameRate (captions)', () => {
      test('pins a standard source rate exactly', () => {
        const calculator = new FfmpegPlaybackParamsCalculator(
          makeTranscodeConfig(),
          'hls',
        );
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate: 23.976 }),
          { pinFrameRate: true },
        );
        expect(params.frameRate).toBe(24000 / 1001);
      });

      test.each(['none', 'yadif=1', 'bwdif=1', 'w3fdif'])(
        'doubles the rate of an interlaced source the software %s filter deinterlaces a frame per field',
        (deinterlaceFilter) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({ deinterlaceVideo: true }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({
              framerate: '30000/1001',
              scanType: 'interlaced',
            }),
            { pinFrameRate: true, deinterlaceFilter },
          );
          expect(params.deinterlace).toBe(true);
          expect(params.frameRate).toBe(60000 / 1001);
        },
      );

      test.each(['yadif=0', 'bwdif=0'])(
        'keeps the rate with the frame-rate %s filter',
        (deinterlaceFilter) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({ deinterlaceVideo: true }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({
              framerate: '30000/1001',
              scanType: 'interlaced',
            }),
            { pinFrameRate: true, deinterlaceFilter },
          );
          expect(params.frameRate).toBe(30000 / 1001);
        },
      );

      test.each([
        ['vaapi', {}],
        ['cuda', {}],
      ] as const)(
        'keeps the rate when %s deinterlaces on the GPU',
        (hardwareAccelerationMode, overrides) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({
              deinterlaceVideo: true,
              hardwareAccelerationMode,
              ...overrides,
            }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({
              framerate: '30000/1001',
              scanType: 'interlaced',
            }),
            { pinFrameRate: true, deinterlaceFilter: 'yadif=1' },
          );
          expect(params.frameRate).toBe(30000 / 1001);
        },
      );

      test.each(['yadif=0', 'yadif=1'])(
        'doubles the rate when QSV deinterlaces on the GPU, whose deinterlace_qsv outputs a frame per field (%s set for software)',
        (deinterlaceFilter) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({
              deinterlaceVideo: true,
              hardwareAccelerationMode: 'qsv',
            }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({
              framerate: '30000/1001',
              scanType: 'interlaced',
            }),
            { pinFrameRate: true, deinterlaceFilter },
          );
          expect(params.frameRate).toBe(60000 / 1001);
        },
      );

      test('keeps the rate when QSV deinterlaces in software with a frame-rate filter', () => {
        const calculator = new FfmpegPlaybackParamsCalculator(
          makeTranscodeConfig({
            deinterlaceVideo: true,
            hardwareAccelerationMode: 'qsv',
            disableHardwareFilters: true,
          }),
          'hls',
        );
        const params = calculator.calculateForStream(
          makeStreamDetails({
            framerate: '30000/1001',
            scanType: 'interlaced',
          }),
          { pinFrameRate: true, deinterlaceFilter: 'bwdif=0' },
        );
        expect(params.frameRate).toBe(30000 / 1001);
      });

      // These pipelines use the software filter then
      test.each([
        ['videotoolbox', {}, 'h264'],
        ['qsv', { disableHardwareFilters: true }, 'h264'],
        ['vaapi', { disableHardwareDecoder: true }, 'h264'],
        ['cuda', { disableHardwareDecoder: true }, 'h264'],
        // CUDA decodes interlaced MPEG-2 and looping items in software
        ['cuda', {}, 'mpeg2video'],
        ['cuda', {}, 'h264', true],
      ] as const)(
        'doubles the rate when %s deinterlaces in software (%j, %s, loops: %s)',
        (hardwareAccelerationMode, overrides, codec, infiniteLoop = false) => {
          const calculator = new FfmpegPlaybackParamsCalculator(
            makeTranscodeConfig({
              deinterlaceVideo: true,
              hardwareAccelerationMode,
              ...overrides,
            }),
            'hls',
          );
          const params = calculator.calculateForStream(
            makeStreamDetails({
              codec,
              framerate: '30000/1001',
              scanType: 'interlaced',
            }),
            { pinFrameRate: true, deinterlaceFilter: 'yadif=1', infiniteLoop },
          );
          expect(params.frameRate).toBe(60000 / 1001);
        },
      );

      test('keeps the rate of a progressive source', () => {
        const calculator = new FfmpegPlaybackParamsCalculator(
          makeTranscodeConfig({ deinterlaceVideo: true }),
          'hls',
        );
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate: 25, scanType: 'progressive' }),
          { pinFrameRate: true, deinterlaceFilter: 'yadif=1' },
        );
        expect(params.frameRate).toBe(25);
      });
    });
  });
});
