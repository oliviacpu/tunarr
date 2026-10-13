import { FileStreamSource } from '../../../../stream/types.ts';
import {
  EmptyFfmpegCapabilities,
  FfmpegCapabilities,
} from '../../capabilities/FfmpegCapabilities.ts';
import { VideoFormats } from '../../constants.ts';
import type { PixelFormat } from '../../format/PixelFormat.ts';
import {
  PixelFormatYuv420P,
  PixelFormatYuv420P10Le,
} from '../../format/PixelFormat.ts';
import { VideoInputSource } from '../../input/VideoInputSource.ts';
import { VideoStream } from '../../MediaStream.ts';
import { PixelFormatOutputOption } from '../../options/OutputOption.ts';
import type { PipelineOptions } from '../../state/FfmpegState.ts';
import {
  DefaultPipelineOptions,
  FfmpegState,
} from '../../state/FfmpegState.ts';
import { FrameState } from '../../state/FrameState.ts';
import { FrameSize } from '../../types.ts';
import { SoftwarePipelineBuilder } from './SoftwarePipelineBuilder.ts';

describe('SoftwarePipelineBuilder', () => {
  const state = FfmpegState.create({
    version: {
      versionString: 'n7.1.1',
      majorVersion: 7,
      minorVersion: 1,
      patchVersion: 1,
      isUnknown: false,
    },
  });

  const desiredState = new FrameState({
    isAnamorphic: false,
    scaledSize: FrameSize.FHD,
    paddedSize: FrameSize.FHD,
    pixelFormat: new PixelFormatYuv420P(),
    videoFormat: VideoFormats.H264,
  });

  function build(
    pixelFormat: PixelFormat,
    options: PipelineOptions = DefaultPipelineOptions,
    capabilities: FfmpegCapabilities = EmptyFfmpegCapabilities,
  ) {
    const video = VideoInputSource.withStream(
      new FileStreamSource('/path/to/video.mkv'),
      VideoStream.create({
        codec: 'hevc',
        displayAspectRatio: '16:9',
        frameSize: FrameSize.FHD,
        index: 0,
        pixelFormat,
        providedSampleAspectRatio: null,
      }),
    );
    return new SoftwarePipelineBuilder(
      video,
      null,
      null,
      null,
      null,
      capabilities,
    ).build(state, desiredState, options);
  }

  test('converts a 10-bit source to the desired 8-bit pixel format', () => {
    // Without -pix_fmt, libx264 keeps the decoder's yuv420p10le and writes H.264 High 10, which most clients can't
    // decode. The starting state must carry the source's pixel format so setPixelFormat sees the mismatch.
    const out = build(new PixelFormatYuv420P10Le());

    expect(
      out.steps.some((step) => step instanceof PixelFormatOutputOption),
    ).toBe(true);
    expect(out.getCommandArgs().join(' ')).toContain('-pix_fmt yuv420p');
  });

  test('adds no pixel format conversion for an 8-bit source', () => {
    const out = build(new PixelFormatYuv420P());

    expect(
      out.steps.some((step) => step instanceof PixelFormatOutputOption),
    ).toBe(false);
  });

  describe('encoder thread count', () => {
    const withLibx264 = new FfmpegCapabilities(
      new Set(),
      new Map([['libx264', { ffmpegName: 'libx264', name: 'libx264' }]]),
      new Set(),
      new Set(),
    );

    test('reaches libx264 as an output option, after the inputs', () => {
      // The transcode config's thread count used to be written only as a global -threads before the inputs, which
      // ffmpeg applies to the first input's decoder; libx264 picked its own (about 1.5x the visible cores).
      const args = build(
        new PixelFormatYuv420P(),
        { ...DefaultPipelineOptions, encoderThreadCount: 4 },
        withLibx264,
      ).getCommandArgs();

      const threadsIdx = args.indexOf('-threads:v');
      expect(threadsIdx).toBeGreaterThan(args.lastIndexOf('-i'));
      expect(args[threadsIdx + 1]).toBe('4');
      expect(args).toContain('libx264');
    });

    test('leaves libx264 on its own default without a thread count', () => {
      const args = build(
        new PixelFormatYuv420P(),
        DefaultPipelineOptions,
        withLibx264,
      ).getCommandArgs();

      expect(args).not.toContain('-threads:v');
    });
  });
});
