import type { ChannelStreamMode, Watermark } from '@tunarr/types';
import type { ChannelConcatStreamMode } from '@tunarr/types/schemas';
import type { Duration } from 'dayjs/plugin/duration.js';
import type { ContentBackedStreamLineupItem } from '../db/derived_types/StreamLineup.ts';
import type {
  AudioStreamDetails,
  FileStreamSource,
  HttpStreamSource,
  StreamDetails,
  StreamRenditions,
  StreamSource,
} from '../stream/types.ts';
import type { OutputFormat } from './builder/constants.ts';
import type { FfmpegTranscodeSession } from './FfmpegTrancodeSession.ts';

export type TranscodeSessionResult = {
  session: FfmpegTranscodeSession;
  renditions: StreamRenditions;
};

export type ConcatOptions = {
  mode: ChannelConcatStreamMode;
  outputFormat: OutputFormat;
};

// A music track to play under the offline picture instead of the placeholder audio
export type OfflineBackgroundMusic = {
  source: FileStreamSource | HttpStreamSource;
  audioStream: AudioStreamDetails;
  trackDurationMs: number;
};

// Gap music's artist and title, drawn along the bottom of the offline picture
export type OfflineNowPlaying = {
  // the line to draw, already cut to fit
  text: string;
  // a font file ffmpeg can read, with a glyph for every character of text
  fontFile: string;
};

export type PlaceholderSessionOpts = {
  duration: Duration;
  outputFormat: OutputFormat;
  realtime?: boolean;
  ptsOffset?: number;
  // See StreamOptions.isFirstTranscode. A session's first program no longer
  // starts at ptsOffset 0, so the fallback can't tell.
  isFirstTranscode?: boolean;
} & (
  | { kind: 'error'; title: string; subtitle?: string }
  | {
      kind: 'offline';
      backgroundMusic?: OfflineBackgroundMusic;
      // The offline picture, when the caller found it on disk (an upload).
      // Otherwise the channel's offline picture URL, or the generic screen, is
      // fetched over HTTP.
      picture?: FileStreamSource;
      nowPlaying?: OfflineNowPlaying;
    }
);

export const ConcatStreamModeToChildMode: Record<
  ChannelConcatStreamMode,
  ChannelStreamMode
> = {
  hls_concat: 'hls',
  hls_slower_concat: 'hls_slower',
  mpegts_concat: 'mpegts',
  hls_direct_concat: 'hls_direct',
  hls_direct_v2_concat: 'hls_direct_v2',
} as const;

export type StreamSessionCreateArgs = {
  stream: {
    source: StreamSource;
    details: StreamDetails;
  };
  options: StreamOptions;
  lineupItem: ContentBackedStreamLineupItem;
};

/**
 * Describes how the ffmpeg pipeline should encode a stream.
 *
 * - `transcode`: honour the channel's transcode config (default behaviour).
 * - `remux`: copy video and audio streams directly into the output container
 *   without re-encoding. Audio codecs that are incompatible with the target
 *   container (e.g. DTS / TrueHD in MPEG-TS) are transcoded to AC-3.
 *
 * Future modes (e.g. `adaptive` with per-client capability negotiation) can
 * be added here without touching call sites.
 */
export type StreamEncoding = { mode: 'transcode' } | { mode: 'remux' };

export type StreamOptions = {
  /** Eligibility fixed by the owning HLS session until it restarts. */
  captionsEnabled?: boolean;
  startTime: Duration;
  duration: Duration;
  watermark?: Watermark;
  realtime?: boolean; // = true,
  extraInputHeaders?: Record<string, string>;
  outputFormat: OutputFormat;
  ptsOffset?: number;
  /**
   * Segment/file number to continue the WebVTT subtitle sidecar's `segment`
   * muxer output from across an HLS session's ffmpeg process restarts.
   */
  subtitleSegmentStartNumber?: number;
  streamMode: ChannelStreamMode;
  /** How the pipeline should encode this stream. Defaults to 'transcode'. */
  encoding?: StreamEncoding;
  /**
   * Whether this is the first transcode in the HLS session. Used to determine
   * whether to include `discont_start` in the HLS flags. When undefined, the
   * pipeline falls back to inferring from ptsOffset (legacy behaviour).
   */
  isFirstTranscode?: boolean;
  /** When true, FFmpeg writes `#EXT-X-ENDLIST` on exit (for finite HLS streams). */
  emitEndList?: boolean;
  disableErrorStream?: boolean;
};
