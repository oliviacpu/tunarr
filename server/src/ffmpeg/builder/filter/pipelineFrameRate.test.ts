import { describe, expect, test } from 'vitest';
import { FileStreamSource } from '../../../stream/types.ts';
import { EmptyFfmpegCapabilities } from '../capabilities/FfmpegCapabilities.ts';
import { NvidiaHardwareCapabilities } from '../capabilities/NvidiaHardwareCapabilities.ts';
import {
  VaapiEntrypoint,
  VaapiHardwareCapabilities,
  VaapiProfileEntrypoint,
  VaapiProfiles,
} from '../capabilities/VaapiHardwareCapabilities.ts';
import { VideoFormats } from '../constants.ts';
import { ColorFormat } from '../format/ColorFormat.ts';
import { PixelFormatYuv420P } from '../format/PixelFormat.ts';
import { VideoInputSource } from '../input/VideoInputSource.ts';
import { VideoStream } from '../MediaStream.ts';
import { QsvPipelineBuilder } from '../pipeline/hardware/QsvPipelineBuilder.ts';
import { VaapiPipelineBuilder } from '../pipeline/hardware/VaapiPipelineBuilder.ts';
import { NvidiaPipelineBuilder } from '../pipeline/nvidia/NvidiaPipelineBuilder.ts';
import type { PipelineBuilder } from '../pipeline/PipelineBuilder.ts';
import { SoftwarePipelineBuilder } from '../pipeline/software/SoftwarePipelineBuilder.ts';
import { DefaultPipelineOptions, FfmpegState } from '../state/FfmpegState.ts';
import { FrameState } from '../state/FrameState.ts';
import { FrameSize } from '../types.ts';

describe('resolved pipeline frame rate', () => {
  const h264Vaapi = new VaapiHardwareCapabilities([
    new VaapiProfileEntrypoint(VaapiProfiles.H264Main, VaapiEntrypoint.Encode),
    new VaapiProfileEntrypoint(VaapiProfiles.H264Main, VaapiEntrypoint.Decode),
  ]);
  const builders: [string, (video: VideoInputSource) => PipelineBuilder][] = [
    [
      'software',
      (video) =>
        new SoftwarePipelineBuilder(
          video,
          null,
          null,
          null,
          null,
          EmptyFfmpegCapabilities,
        ),
    ],
    [
      'nvidia',
      (video) =>
        new NvidiaPipelineBuilder(
          new NvidiaHardwareCapabilities('RTX 2080 Ti', 75),
          EmptyFfmpegCapabilities,
          video,
          null,
          null,
          null,
          null,
        ),
    ],
    [
      'vaapi',
      (video) =>
        new VaapiPipelineBuilder(
          h264Vaapi,
          EmptyFfmpegCapabilities,
          video,
          null,
          null,
          null,
          null,
        ),
    ],
    [
      'qsv',
      (video) =>
        new QsvPipelineBuilder(
          h264Vaapi,
          EmptyFfmpegCapabilities,
          video,
          null,
          null,
          null,
          null,
        ),
    ],
  ];

  test.each(
    builders.flatMap(([name, builder]) =>
      [true, false].map((fallback) => ({
        name,
        makeBuilder: builder,
        fallback,
      })),
    ),
  )(
    '$name reports its selected filter rate (software fallback: $fallback)',
    ({ name, makeBuilder, fallback }) => {
      const stream = VideoStream.create({
        codec: fallback ? 'vc1' : 'h264',
        profile: 'main',
        displayAspectRatio: '16:9',
        frameSize: FrameSize.FHD,
        frameRate: '30000/1001',
        index: 0,
        pixelFormat: new PixelFormatYuv420P(),
        providedSampleAspectRatio: null,
        colorFormat: ColorFormat.unknown,
      });
      const input = VideoInputSource.withStream(
        new FileStreamSource('/video.mkv'),
        stream,
      );
      const pipeline = makeBuilder(input).build(
        FfmpegState.create({
          softwareDeinterlaceFilter: 'yadif=1',
          version: {
            versionString: '7.1.1',
            majorVersion: 7,
            minorVersion: 1,
            patchVersion: 1,
            isUnknown: false,
          },
        }),
        new FrameState({
          isAnamorphic: false,
          scaledSize: FrameSize.FHD,
          paddedSize: FrameSize.FHD,
          pixelFormat: new PixelFormatYuv420P(),
          videoFormat: VideoFormats.H264,
          frameRate: 30000 / 1001,
          deinterlace: true,
        }),
        {
          ...DefaultPipelineOptions,
          disableHardwareDecoding: fallback,
          disableHardwareFilters: fallback,
        },
      );
      const doubled = fallback || name === 'software' || name === 'qsv';
      expect(pipeline.outputFrameRate).toBe((doubled ? 60000 : 30000) / 1001);
      expect(pipeline.getCommandArgs().join(' ')).toContain(
        `-r ${doubled ? 60000 : 30000}/1001 -fps_mode cfr`,
      );
    },
  );
});
