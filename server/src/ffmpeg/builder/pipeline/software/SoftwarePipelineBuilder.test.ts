import { FileStreamSource } from '../../../../stream/types.ts';
import { EmptyFfmpegCapabilities } from '../../capabilities/FfmpegCapabilities.ts';
import { VideoFormats } from '../../constants.ts';
import type { PixelFormat } from '../../format/PixelFormat.ts';
import {
  PixelFormatYuv420P,
  PixelFormatYuv420P10Le,
} from '../../format/PixelFormat.ts';
import { VideoInputSource } from '../../input/VideoInputSource.ts';
import { VideoStream } from '../../MediaStream.ts';
import { PixelFormatOutputOption } from '../../options/OutputOption.ts';
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

  function build(pixelFormat: PixelFormat) {
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
      EmptyFfmpegCapabilities,
    ).build(state, desiredState, DefaultPipelineOptions);
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
});
