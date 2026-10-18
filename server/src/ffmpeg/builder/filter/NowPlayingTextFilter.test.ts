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
import {
  PixelFormatUnknown,
  PixelFormatYuv420P,
} from '../format/PixelFormat.ts';
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
import {
  escapeDrawtextValue,
  NowPlayingTextFilter,
} from './NowPlayingTextFilter.ts';

describe('escapeDrawtextValue', () => {
  test('leaves plain text, including non-Latin text, as is', () => {
    expect(escapeDrawtextValue('♪  Neon 82–99 — 新宿区 Night Drive')).toBe(
      '♪  Neon 82–99 — 新宿区 Night Drive',
    );
  });

  // Checked against ffmpeg 8.1's drawtext: each of these draws literally
  test.each([
    ["It's", "It\\\\\\'s"],
    ['Time: A Song', 'Time\\\\: A Song'],
    ['a\\b', 'a\\\\\\\\b'],
    ['[weird]', '\\[weird\\]'],
    ['a,b;c', 'a\\,b\\;c'],
    ['100% =', '100% ='],
  ])('escapes %j for both of the parsers ffmpeg runs', (text, escaped) => {
    expect(escapeDrawtextValue(text)).toBe(escaped);
  });

  test('escapes a Windows font path', () => {
    expect(escapeDrawtextValue('C:\\Tunarr\\fonts\\a.ttf')).toBe(
      'C\\\\:\\\\\\\\Tunarr\\\\\\\\fonts\\\\\\\\a.ttf',
    );
  });
});

describe('NowPlayingTextFilter', () => {
  test('draws the text, unexpanded, in a strip along the bottom of the picture', () => {
    const filter = new NowPlayingTextFilter(
      "♪  It's — 100%",
      '/data/fonts/MPLUSRounded1c-Bold.ttf',
    ).filter;

    expect(filter).toBe(
      [
        'drawtext=fontfile=/data/fonts/MPLUSRounded1c-Bold.ttf',
        'expansion=none',
        "text=♪  It\\\\\\'s — 100%",
        'fontsize=h/30',
        'fontcolor=0xF5F0E4',
        'box=1',
        'boxcolor=black@0.6',
        'boxborderw=14|26',
        'x=(w-text_w)/2',
        'y_align=font',
        'y=h*0.946-font_a/2-font_d/2',
      ].join(':'),
    );
  });
});

// The offline picture as FfmpegStreamFactory sets it up, with the text on it
function offlinePicture() {
  return VideoInputSource.withStream(
    new FileStreamSource('/data/images/uploads/card.png'),
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
  ).addFilter(
    new NowPlayingTextFilter(
      '♪  Les Exemples — Le matin à Paris',
      '/data/fonts/a.ttf',
    ),
  );
}

describe('NowPlayingTextFilter in each pipeline', () => {
  const h264Vaapi = new VaapiHardwareCapabilities([
    new VaapiProfileEntrypoint(VaapiProfiles.H264Main, VaapiEntrypoint.Encode),
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

  test.each(builders)(
    '%s: draws on the picture before it is scaled or uploaded to a GPU',
    (_, makeBuilder) => {
      const args = makeBuilder(offlinePicture())
        .build(
          FfmpegState.create({
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
            scaledSize: FrameSize.fromResolution({
              widthPx: 1280,
              heightPx: 720,
            }),
            paddedSize: FrameSize.fromResolution({
              widthPx: 1280,
              heightPx: 720,
            }),
            pixelFormat: new PixelFormatYuv420P(),
            videoFormat: VideoFormats.H264,
            realtime: true,
            infiniteLoop: true,
          }),
          DefaultPipelineOptions,
        )
        .getCommandArgs();

      const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
      expect(graph.startsWith('[0:0]drawtext=')).toBe(true);
      for (const later of ['scale', 'hwupload']) {
        const at = graph.indexOf(later);
        if (at !== -1) {
          expect(at).toBeGreaterThan(graph.indexOf('drawtext'));
        }
      }
    },
  );
});
