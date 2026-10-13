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
      // did with an fps filter), which turns variable-frame-rate sources into constant ones.
      test.each([
        [24, 24],
        [23.976, 23.976],
        ['24000/1001', 23.976],
        ['30000/1001', 29.97],
        ['25', 25],
        ['59.94', 59.94],
      ])('outputs the source rate %j as %j fps', (framerate, expected) => {
        const config = makeTranscodeConfig({ normalizeFrameRate: true });
        const calculator = new FfmpegPlaybackParamsCalculator(config, 'hls');
        const params = calculator.calculateForStream(
          makeStreamDetails({ framerate }),
        );

        expect(params.frameRate).toBe(expected);
      });

      test('leaves the frame rate alone when the setting is off', () => {
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
  });
});
