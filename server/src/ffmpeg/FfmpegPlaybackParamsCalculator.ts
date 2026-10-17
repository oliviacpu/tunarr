import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import {
  HardwareAccelerationMode,
  TranscodeAudioOutputFormat,
} from '@/db/schema/TranscodeConfig.js';
import type { ChannelStreamMode } from '@/db/schema/base.js';
import type { StreamDetails, VideoStreamDetails } from '@/stream/types.js';
import { gcd } from '@/util/index.js';
import type { Resolution } from '@tunarr/types';
import { ChannelStreamModes } from '@tunarr/types';
import { match, P } from 'ts-pattern';
import type { VideoPreset } from './builder/constants.ts';
import {
  VideoFormats,
  VideoPresets,
  type OutputFormat,
  type VideoFormat,
} from './builder/constants.ts';
import type { PixelFormat } from './builder/format/PixelFormat.ts';
import { PixelFormatYuv420P } from './builder/format/PixelFormat.ts';
import { FrameSize } from './builder/types.ts';
import {
  deinterlacerDoublesFrameRate,
  outputFrameRate,
} from './outputFrameRate.ts';

const KnownVideoPresets: ReadonlySet<string> = new Set(
  Object.values(VideoPresets),
);

function isVideoPreset(preset: string): preset is VideoPreset {
  return KnownVideoPresets.has(preset);
}

// The transcode config's preset for libx264/libx265, if it is one they know; otherwise veryfast, the long-standing
// default (the config field was ignored before, so existing configs keep their behavior).
function softwareVideoPreset(configured: string | null): VideoPreset {
  const preset = configured?.trim().toLowerCase() ?? '';
  return isVideoPreset(preset) ? preset : VideoPresets.VeryFast;
}

export type StreamPlaybackOptions = {
  // The output's frame rate must be known exactly: CEA-608 captions are laid out one pair per frame
  pinFrameRate?: boolean;
  // ffmpeg settings' software deinterlace filter, to tell whether deinterlacing doubles the frame rate
  deinterlaceFilter?: string;
};

export class FfmpegPlaybackParamsCalculator {
  constructor(
    private transcodeConfig: TranscodeConfigOrm,
    private streamMode: ChannelStreamMode,
  ) {}

  calculateForStream(
    streamDetails: StreamDetails,
    options: StreamPlaybackOptions = {},
  ): FfmpegPlaybackParams {
    if (
      this.streamMode === ChannelStreamModes.HlsDirect ||
      this.streamMode === ChannelStreamModes.HlsDirectV2
    ) {
      return {
        hwAccel: HardwareAccelerationMode.None,
        audioFormat: TranscodeAudioOutputFormat.Copy,
        videoFormat: 'copy', // Should be included in DB options
        deinterlace: false,
      } satisfies FfmpegPlaybackParams;
    }

    // TODO: Check channel mode;
    const params: FfmpegPlaybackParams = {
      audioFormat: this.transcodeConfig.audioFormat,
      audioBitrate: this.transcodeConfig.audioBitRate,
      audioBufferSize: this.transcodeConfig.audioBufferSize,
      audioChannels: this.transcodeConfig.audioChannels,
      audioSampleRate: this.transcodeConfig.audioSampleRate,
      hwAccel: this.transcodeConfig.hardwareAccelerationMode,
      videoFormat: this.transcodeConfig.videoFormat,
      videoBitrate: this.transcodeConfig.videoBitRate,
      videoBufferSize: this.transcodeConfig.videoBufferSize,
    };

    if (streamDetails.videoDetails) {
      const [videoStream] = streamDetails.videoDetails;
      if (
        needsToScale(this.transcodeConfig, videoStream) &&
        videoStream.sampleAspectRatio !== '0:0'
      ) {
        const scaledSize = calculateScaledSize(
          this.transcodeConfig,
          videoStream,
        );
        if (
          scaledSize.widthPx !== videoStream.width ||
          scaledSize.heightPx !== videoStream.height
        ) {
          params.scaledSize = FrameSize.fromResolution(scaledSize).ensureEven();
        }
      }

      params.videoPreset = match([
        this.transcodeConfig.hardwareAccelerationMode,
        this.transcodeConfig.videoFormat,
        videoStream.bitDepth,
      ])
        .with(
          ['none', P.union(VideoFormats.H264, VideoFormats.Hevc), P._],
          () => softwareVideoPreset(this.transcodeConfig.videoPreset),
        )
        .otherwise(() => undefined);

      const sizeAfterScaling =
        params.scaledSize ??
        FrameSize.create({
          width: videoStream.width,
          height: videoStream.height,
        });
      if (
        sizeAfterScaling.width !== this.transcodeConfig.resolution.widthPx ||
        sizeAfterScaling.height !== this.transcodeConfig.resolution.heightPx
      ) {
        params.needsPad = true;
      }

      params.deinterlace =
        !!this.transcodeConfig.deinterlaceVideo &&
        videoStream.scanType === 'interlaced';

      // The output frame rate, which the builder turns into -r <rate> -fps_mode cfr:
      // - a source reporting a rate that isn't standard always gets a standard one. Left alone, ffmpeg's HLS output
      //   keeps the reported rate and drops frames to fit it: a DVD rip reporting 20 fps whose frames really come
      //   about 24 a second lost one in six, and the CEA-608 caption pairs they carried.
      // - "Normalize Frame Rate": the source's own rate (the pipeline before #1349 used an fps filter for this).
      // - captions: the source's own rate, so the caption schedule and the video agree frame for frame.
      // A software field-rate deinterlacer outputs a frame per field, so the rate is doubled to keep them all.
      const output = outputFrameRate(videoStream.framerate);
      if (
        output &&
        (!output.standard ||
          this.transcodeConfig.normalizeFrameRate ||
          options.pinFrameRate)
      ) {
        const fieldRate =
          params.deinterlace &&
          this.deinterlacerDoublesRate(videoStream, options.deinterlaceFilter);
        params.frameRate = output.rate * (fieldRate ? 2 : 1);
      }

      params.videoTrackTimeScale = 90000;

      // Filter for attached pic???
      // match([params.hwAccel, videoStream.codec, videoStream.pixelFormat])
      //   .with([HardwareAccelerationMode.Cuda, VideoFormats.H264, P.union(PixelFormats.YUV420P10LE, PixelFormats.YUV444P, PixelFormats.YUV444P10LE)], () => 'h264')
      //   .with([HardwareAccelerationMode.Cuda, VideoFormats.Hevc, P.union(PixelFormats.YUV420P10LE, PixelFormats.YUV444P, PixelFormats.YUV444P10LE)], () => 'h264')
      // TODO ffmpeg options for bit depth!
      params.pixelFormat = new PixelFormatYuv420P();
    }

    return params;
  }

  // Whether the pipeline's deinterlacer outputs a frame per field, doubling the frame rate, as far as the transcode
  // config and source tell. The software filter (DeinterlaceFilter) does with a field-rate setting; the pipelines use
  // it always without hardware acceleration and with VideoToolbox (whose pipeline is the software one's), with QSV when
  // hardware filters are off, and with VAAPI and CUDA when hardware decoding is off, as their frames are then in
  // system memory; CUDA also always decodes interlaced MPEG-2 in software (NvidiaPipelineBuilder). QSV's own
  // deinterlace_qsv always outputs at field rate (FFmpeg sets field_rate in its preinit); deinterlace_vaapi and
  // yadif_cuda output at frame rate by default. VAAPI and CUDA also fall back to software when the GPU can't decode
  // the source, which only the pipeline knows; there a field-rate filter's extra frames are dropped back to the
  // source rate.
  private deinterlacerDoublesRate(
    videoStream: VideoStreamDetails,
    softwareFilter: string | undefined,
  ) {
    const software = deinterlacerDoublesFrameRate(softwareFilter);
    switch (this.transcodeConfig.hardwareAccelerationMode) {
      case HardwareAccelerationMode.None:
      case HardwareAccelerationMode.Videotoolbox:
        return software;
      case HardwareAccelerationMode.Qsv:
        return this.transcodeConfig.disableHardwareFilters ? software : true;
      case HardwareAccelerationMode.Vaapi:
        return !!this.transcodeConfig.disableHardwareDecoder && software;
      case HardwareAccelerationMode.Cuda:
        return (
          (!!this.transcodeConfig.disableHardwareDecoder ||
            videoStream.codec === VideoFormats.Mpeg2Video) &&
          software
        );
      default:
        return false;
    }
  }

  calculateForErrorStream(
    outputFormat: OutputFormat,
    hlsRealtime: boolean,
  ): FfmpegPlaybackParams {
    return {
      audioFormat: this.transcodeConfig.audioFormat,
      audioBitrate: this.transcodeConfig.audioBitRate,
      audioBufferSize: this.transcodeConfig.audioBufferSize,
      audioChannels: this.transcodeConfig.audioChannels,
      audioSampleRate: this.transcodeConfig.audioSampleRate,
      hwAccel: this.transcodeConfig.hardwareAccelerationMode,
      videoFormat: this.transcodeConfig.videoFormat,
      videoBitrate: this.transcodeConfig.videoBitRate,
      videoBufferSize: this.transcodeConfig.videoBufferSize,
      videoTrackTimeScale: 90_000,
      frameRate: 24,
      realtime: outputFormat.type === 'hls' ? hlsRealtime : true,
    };
  }

  calculateForHlsConcat(): FfmpegPlaybackParams {
    return {
      audioFormat: this.transcodeConfig.audioFormat,
      audioBitrate: this.transcodeConfig.audioBitRate,
      audioBufferSize: this.transcodeConfig.audioBufferSize,
      audioChannels: this.transcodeConfig.audioChannels,
      audioSampleRate: this.transcodeConfig.audioSampleRate,
      hwAccel: this.transcodeConfig.hardwareAccelerationMode,
      videoFormat: this.transcodeConfig.videoFormat,
      videoBitrate: this.transcodeConfig.videoBitRate,
      videoBufferSize: this.transcodeConfig.videoBufferSize,
      videoTrackTimeScale: 90_000,
      frameRate: 24,
      realtime: false,
    };
  }
}

export type FfmpegPlaybackParams = {
  hwAccel: HardwareAccelerationMode;
  frameRate?: number;
  scaledSize?: FrameSize;
  needsPad?: boolean;
  videoTrackTimeScale?: number;
  realtime?: boolean;

  // video details
  videoFormat: VideoFormat;
  videoBitrate?: number;
  videoBufferSize?: number;
  videoProfile?: string;
  videoPreset?: VideoPreset;
  pixelFormat?: PixelFormat;
  deinterlace?: boolean;

  // audio details
  audioFormat: TranscodeAudioOutputFormat;
  audioBitrate?: number;
  audioBufferSize?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  audioDuration?: number;
};

function needsToScale(
  transcodeConfig: TranscodeConfigOrm,
  videoStreamDetails: VideoStreamDetails,
) {
  return (
    isAnamorphic(videoStreamDetails) ||
    actualSizeDiffersFromDesired(
      videoStreamDetails,
      transcodeConfig.resolution,
    ) ||
    videoStreamDetails.width % 2 == 1 ||
    videoStreamDetails.height % 2 == 1
  );
}

function actualSizeDiffersFromDesired(
  videoStream: VideoStreamDetails,
  targetResolution: Resolution,
) {
  return (
    videoStream.width !== targetResolution.widthPx ||
    videoStream.height !== targetResolution.heightPx
  );
}

function isAnamorphic(videoStreamDetails: VideoStreamDetails) {
  // Unclear if we can rely on this
  // if (isDefined(videoStreamDetails.anamorphic)) {
  //   return videoStreamDetails.anamorphic;
  // }
  if (videoStreamDetails.sampleAspectRatio === '1:1') {
    return false;
  }

  if (videoStreamDetails.sampleAspectRatio !== '0:1') {
    return true;
  }

  if (videoStreamDetails.displayAspectRatio === '0:1') {
    return false;
  }

  return (
    videoStreamDetails.displayAspectRatio !==
    `${videoStreamDetails.width}:${videoStreamDetails.height}`
  );
}

function calculateScaledSize(
  config: TranscodeConfigOrm,
  videoStream: VideoStreamDetails,
) {
  const { widthPx: targetW, heightPx: targetH } = config.resolution;
  const [width, height] = (videoStream.sampleAspectRatio ?? '1:1')
    .split(':')
    .map((i) => parseInt(i));
  const sarSize: Resolution = { widthPx: width!, heightPx: height! };
  let pixelP = videoStream.width * sarSize.widthPx,
    pixelQ = videoStream.height * sarSize.heightPx;
  const g = gcd(pixelQ, pixelP);
  pixelP /= g;
  pixelQ /= g;

  const h1 = {
    widthPx: targetW,
    heightPx: targetW * (pixelQ / pixelP),
  } satisfies Resolution;
  const h2 = {
    widthPx: targetH * (pixelP / pixelQ),
    heightPx: targetH,
  } satisfies Resolution;

  // TODO implement crop scaling
  return h1.heightPx <= targetH ? h1 : h2;
}
