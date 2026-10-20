import { hlsPlaylistWindowSize } from '../constants.ts';
import { OutputOption } from './OutputOption.ts';

/**
 * HLS output format for direct stream copy mode (no transcoding).
 * Unlike HlsOutputFormat, this does NOT include keyframe-forcing options
 * (-g, -keyint_min, -force_key_frames) which are incompatible with -c:v copy.
 * Segments will be created at source keyframe boundaries.
 */
export class HlsDirectOutputFormat extends OutputOption {
  public static SegmentSeconds = 4;

  constructor(
    private playlistPath: string,
    private segmentTemplate: string,
    private baseStreamUrl: string,
    private isFirstTranscode: boolean,
    private emitEndList: boolean = false,
    // The newest segments the playlist lists (see HlsOutputFormat)
    private listSize: number = hlsPlaylistWindowSize(
      HlsDirectOutputFormat.SegmentSeconds,
    ),
  ) {
    super();
  }

  options(): string[] {
    const opts = [
      '-f',
      'hls',
      '-hls_time',
      `${HlsDirectOutputFormat.SegmentSeconds}`,
      '-hls_list_size',
      `${this.listSize}`,
      '-segment_list_flags',
      '+live',
      '-hls_segment_type',
      'mpegts',
      '-hls_segment_filename',
      this.segmentTemplate,
      '-hls_base_url',
      this.baseStreamUrl,
      '-copyts', // Preserve original timestamps
      '-master_pl_name',
      'playlist.m3u8',
    ];

    // No delete_segments, as in HlsOutputFormat
    const flags = ['program_date_time', 'append_list', 'independent_segments'];
    if (!this.emitEndList) flags.push('omit_endlist');
    if (!this.isFirstTranscode) flags.push('discont_start');

    opts.push('-hls_flags', flags.join('+'));

    // Through the HLS muxer to its segment muxer (see HlsOutputFormat)
    if (!this.isFirstTranscode) {
      opts.push('-hls_segment_options', 'mpegts_flags=+initial_discontinuity');
    }

    opts.push(this.playlistPath);

    return opts;
  }
}
