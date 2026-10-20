import type { DeepRequired } from 'ts-essentials';
import type { Nullable } from '../../types/util.ts';

export type HlsOptions = {
  hlsTime: number; // Duration of each clip in seconds,
  hlsListSize: number; // Segments ffmpeg's media playlist lists, 0 for all of them
  hlsDeleteThreshold: number;
  segmentBaseDirectory: string;
  streamBasePath: string;
  streamBaseUrl: string;
  segmentNameFormat: string;
  streamNameFormat: string;
  subtitleStreamNameFormat: string;
  deleteThreshold: Nullable<number>;
  appendSegments: boolean;
};

// How much of an HLS session ffmpeg's media playlist (stream.m3u8) lists.
// With append_list, ffmpeg rewrites the whole list after every segment and
// reads it back in when each program's ffmpeg starts. A list that kept every
// segment (-hls_list_size 0) grew for the session's whole life: about 136 GB
// of rewrites in a day of 2 s segments, about 585 MB per ffmpeg after 24
// hours on FFmpeg 8.x, and program starts that slow down quadratically on
// FFmpeg 7.1.x (54-76 s after 24 hours). See
// plans/hls-playlist-growth-2026-10-19.md. Tunarr runs at most about 90 s
// ahead of what viewers watch and ends a session nobody has asked for in two
// minutes, so it reads the file far more often than every 15 minutes.
// MediaPlaylistReader keeps the session's history itself.
export const HlsPlaylistWindowSeconds = 15 * 60;

// A session nobody asks for lives until its staleness runs out, then until
// the cleanup task's next run a minute later, while ffmpeg keeps up to 90 s
// ahead. With a staleness raised past 10 minutes
// (TUNARR_SESSION_STALENESS_MS), the window covers that much plus this, so
// ffmpeg never drops a segment the reader hasn't seen.
const UnreadSessionMarginSeconds = 5 * 60;

/**
 * The -hls_list_size that keeps HlsPlaylistWindowSeconds of segments of
 * `segmentSeconds` each (450 at 2 s, 225 at 4 s), or more when the session's
 * `stalenessMs` lets it go unread for longer
 */
export function hlsPlaylistWindowSize(
  segmentSeconds: number,
  stalenessMs?: number,
) {
  const unreadSeconds =
    stalenessMs !== undefined && Number.isFinite(stalenessMs)
      ? stalenessMs / 1000 + UnreadSessionMarginSeconds
      : 0;
  return Math.ceil(
    Math.max(HlsPlaylistWindowSeconds, unreadSeconds) / segmentSeconds,
  );
}

export const defaultHlsOptions: DeepRequired<HlsOptions> = {
  hlsTime: 4,
  hlsListSize: hlsPlaylistWindowSize(4),
  hlsDeleteThreshold: 3,
  segmentBaseDirectory: 'streams', // Relative to cwd
  streamBasePath: 'stream_%v',
  segmentNameFormat: 'data%06d.ts',
  streamNameFormat: 'stream.m3u8',
  subtitleStreamNameFormat: 'subs.m3u8',
  streamBaseUrl: 'hls/',
  deleteThreshold: 3,
  appendSegments: false,
};

export type MpegDashOptions = {
  windowSize: number; // number of segments kept in the manifest
  segmentDuration: number; // segment duration in secodns
  segmentType: 'auto' | 'mp4' | 'webm';
  fragType: 'auto' | 'every_frame' | 'duration' | 'pframes';
};

export const VideoFormats = {
  Hevc: 'hevc',
  H264: 'h264',
  Dvhe: 'dvhe',
  Dvh1: 'dvh1',
  Mpeg1Video: 'mpeg1video',
  Mpeg2Video: 'mpeg2video',
  MsMpeg4V2: 'msmpeg4v2',
  MsMpeg4V3: 'msmpeg4v3',
  Vc1: 'vc1',
  Mpeg4: 'mpeg4',
  Vp9: 'vp9',
  Av1: 'av1',
  MpegTs: 'mpegts',
  Copy: 'copy',
  Raw: 'raw',
  Undetermined: '',
} as const;

export type VideoFormat = (typeof VideoFormats)[keyof typeof VideoFormats];

// libx264/libx265 presets, fastest first. Software H.264/HEVC uses the transcode config's preset when it is one of
// these, otherwise veryfast.
export const VideoPresets = {
  UltraFast: 'ultrafast',
  SuperFast: 'superfast',
  VeryFast: 'veryfast',
  Faster: 'faster',
  Fast: 'fast',
  Medium: 'medium',
  Slow: 'slow',
  Slower: 'slower',
  VerySlow: 'veryslow',
} as const;

export type VideoPreset = (typeof VideoPresets)[keyof typeof VideoPresets];

export const AudioFormats = {
  Aac: 'aac',
  Ac3: 'ac3',
  Copy: 'copy',
  PCMS16LE: 'pcm_s16le',
  Flac: 'flac',
  Dca: 'dca',
  TrueHd: 'truehd',
  Opus: 'libopus',
  Eac3: 'eac3',
} as const;

export type StdoutOutputLocation = {
  type: 'stdout';
};

export const StdoutOutputLocation: StdoutOutputLocation = {
  type: 'stdout',
};

export type FileOutputLocation = {
  type: 'file';
  path: string;
  overwrite: boolean;
};

export function FileOutputLocation(
  path: string,
  overwrite: boolean = false,
): FileOutputLocation {
  return {
    type: 'file',
    path,
    overwrite,
  };
}

export const OutputLocations = {
  Stdout: 'stdout',
  File: 'file',
} satisfies Record<Capitalize<OutputLocation['type']>, OutputLocation['type']>;

export type OutputLocation = FileOutputLocation | StdoutOutputLocation;

export const OutputFormatTypes = {
  None: 'none',
  Mkv: 'mkv',
  MpegTs: 'mpegts',
  Mp4: 'mp4',
  Hls: 'hls',
  HlsDirect: 'hls_direct',
  HlsDirectV2: 'hls_direct_v2',
  Nut: 'nut',
  Dash: 'dash',
} as const;

export const ColorRanges = {
  Tv: 'tv',
};

// https://trac.ffmpeg.org/wiki/colorspace#color_primaries
export const ColorSpaces = {
  Rgb: 'rgb',
  Bt709: 'bt709',
  Bt709bg: 'bt709bg',
  Smpte170m: 'smpte170m',
  Smpte240m: 'smpte240m',
  Bt2020nc: 'bt2020nc',
  Bt2020c: 'bt2020c',
  Smpte2085: 'smpte2085',
};

export const ColorPrimaries = {
  Bt709: 'bt709',
  Bt709m: 'bt709m',
  Bt709bg: 'bt709bg',
  Smpte170m: 'smpte170m',
  Smpte240m: 'smpte240m',
  Bt2020: 'bt2020',
};

export const ColorTransferFormats = {
  Bt709: 'bt709',
  Unknown: 'unknown',
  Gamma22: 'gamma22',
  Gamma28: 'gamma28',
  Smpte170m: 'smpte170m',
  Smpte240m: 'smpte240m',
  Smpte2084: 'smpte2084',
  AribStdB67: 'arib-std-b67',
} as const;

export type ColorTransferFormat =
  (typeof ColorTransferFormats)[keyof typeof ColorTransferFormats];

export type HlsOutputFormat = {
  type: typeof OutputFormatTypes.Hls;
  hlsOptions: HlsOptions;
};

export type HlsDirectOutputFormat = {
  type: typeof OutputFormatTypes.HlsDirectV2;
  hlsOptions: HlsOptions;
};

export type MpegDashOutputFormat = {
  type: 'dash';
  options?: Partial<MpegDashOptions>;
};

export type MpegTsOutputFormat = {
  type: typeof OutputFormatTypes.MpegTs;
};

export const MpegTsOutputFormat = {
  type: OutputFormatTypes.MpegTs,
} as const satisfies MpegTsOutputFormat;

export type MkvOutputFormat = {
  type: typeof OutputFormatTypes.Mkv;
};

export const MkvOutputFormat = {
  type: OutputFormatTypes.Mkv,
} as const satisfies MkvOutputFormat;

export type Mp4OutputFormat = {
  type: typeof OutputFormatTypes.Mp4;
};

export const Mp4OutputFormat = {
  type: OutputFormatTypes.Mp4,
} satisfies Mp4OutputFormat;

export type NutOutputFormat = {
  type: typeof OutputFormatTypes.Nut;
};

export const NutOutputFormat = {
  type: OutputFormatTypes.Nut,
} as const satisfies NutOutputFormat;

export function HlsOutputFormat(opts: HlsOptions): HlsOutputFormat {
  return {
    type: OutputFormatTypes.Hls,
    hlsOptions: opts,
  };
}

export function HlsDirectOutputFormat(opts: HlsOptions): HlsDirectOutputFormat {
  return {
    type: OutputFormatTypes.HlsDirectV2,
    hlsOptions: opts,
  };
}

export function MpegDashOutputFormat(
  opts?: Partial<MpegDashOptions>,
): MpegDashOutputFormat {
  return {
    type: 'dash',
    options: opts,
  };
}

export type OutputFormat =
  | HlsOutputFormat
  | HlsDirectOutputFormat
  | NutOutputFormat
  | MkvOutputFormat
  | MpegDashOutputFormat
  | Mp4OutputFormat
  | MpegTsOutputFormat;

export const OneWeekMillis = 7 * 24 * 60 * 60 * 1000;
