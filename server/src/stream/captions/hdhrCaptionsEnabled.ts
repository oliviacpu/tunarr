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
 * HLS sessions and their transport-stream wrappers share this decision for
 * the session lifetime. CEA-608 insertion requires H.264 output.
 */
export function hdhrCaptionsEnabled(input: HdhrCaptionsInput): boolean {
  return hdhrCaptionsWanted(input) && input.videoFormat === VideoFormats.H264;
}
