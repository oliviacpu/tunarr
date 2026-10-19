import type { TranscodeVideoOutputFormat } from '@/db/schema/TranscodeConfig.js';
import { VideoFormats } from '@/ffmpeg/builder/constants.js';
import type { ChannelStreamMode } from '@tunarr/types';
import { ChannelStreamModes } from '@tunarr/types';

export type HdhrCaptionsInput = {
  // The global "Closed captions for HDHomeRun clients" switch
  hdhrClosedCaptions: boolean;
  // The mode of the HLS session the .ts stream wraps
  streamMode: ChannelStreamMode | undefined;
  // The channel's subtitles switch; null when it was never set
  subtitlesEnabled: boolean | null;
  // The video format the channel's transcode config outputs
  videoFormat: TranscodeVideoOutputFormat;
};

// The switch, the stream mode and the channel ask for captions. Whether the
// channel gets them also depends on its video format (hdhrCaptionsEnabled).
export function hdhrCaptionsWanted(
  input: Omit<HdhrCaptionsInput, 'videoFormat'>,
): boolean {
  return (
    input.hdhrClosedCaptions &&
    input.streamMode === ChannelStreamModes.Hls &&
    input.subtitlesEnabled === true
  );
}

/**
 * Whether a channel's .ts stream for HDHomeRun clients carries CEA-608
 * closed captions. The transcode (FfmpegStreamFactory) and the .ts wrapper
 * (ConcatStream) both decide with this, so given the same settings and
 * channel they agree: a channel either gets captions on both sides, or its
 * subtitles as with captions off and a .ts stream with no caption track. They
 * read the inputs at different times (the wrapper when its stream starts, the
 * transcode partly per program, partly when its HLS session starts), so a
 * change made while a channel plays can still split them until both restart.
 *
 * Captions can only be written into H.264 video (MpegTsCaptionInserter), so
 * HEVC or MPEG-2 output rules them out.
 */
export function hdhrCaptionsEnabled(input: HdhrCaptionsInput): boolean {
  return hdhrCaptionsWanted(input) && input.videoFormat === VideoFormats.H264;
}
