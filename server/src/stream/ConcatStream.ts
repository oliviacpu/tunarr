import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { FFmpegAssistedFactory } from '@/ffmpeg/FFmpegModule.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import { MpegTsOutputFormat } from '@/ffmpeg/builder/constants.js';
import { ConcatStreamModeToChildMode } from '@/ffmpeg/types.js';
import { makeFfmpegPlaylistUrl, makeLocalUrl } from '@/util/serverUtil.js';
import type { ChannelConcatStreamMode } from '@tunarr/types/schemas';
import type { PassThrough } from 'node:stream';
import { CaptionLanguageStream } from './captions/CaptionLanguageStream.ts';

export type ConcatStreamFactory = (
  channel: ChannelOrmWithTranscodeConfig,
  streamMode: ChannelConcatStreamMode,
) => ConcatStream;
export class ConcatStream {
  constructor(
    private channel: ChannelOrmWithTranscodeConfig,
    private streamMode: ChannelConcatStreamMode,
    private ffmpegFactory: FFmpegAssistedFactory,
    // Read when the stream starts; a change applies from the next tune-in
    private hdhrClosedCaptions: boolean = false,
    // ISO 639-2 language the .ts stream names for its captions
    private captionLanguage: string = 'eng',
  ) {}

  private get captioned() {
    return this.streamMode === 'hls_concat' && this.hdhrClosedCaptions;
  }

  /**
   * Where the session's output goes on its way to viewers. With captions,
   * ffmpeg's PMT is relabelled with the captions' language, which the remux
   * would otherwise drop.
   */
  outputSink(): PassThrough | undefined {
    return this.captioned
      ? new CaptionLanguageStream(this.captionLanguage)
      : undefined;
  }

  async createSession(): Promise<FfmpegTranscodeSession> {
    const ffmpeg = this.ffmpegFactory(
      this.channel.transcodeConfig,
      this.channel,
    );

    const childStreamMode = ConcatStreamModeToChildMode[this.streamMode];

    const streamUrl =
      this.streamMode === 'mpegts_concat'
        ? makeFfmpegPlaylistUrl({
            channel: this.channel.uuid,
            audioOnly: false, // TODO
            mode: 'mpegts',
          })
        : makeLocalUrl(`/stream/channels/${this.channel.uuid}.m3u8`, {
            mode: childStreamMode,
            // The master playlist can list renditions that point back at the
            // same variant, which makes ffmpeg read the muxed streams twice.
            variant: true,
            // CEA-608 captions go into this .ts stream, which HDHomeRun
            // clients such as Plex read, not into Tunarr's own HLS
            captions: this.captioned ? true : undefined,
          });

    return ffmpeg.createConcatSession(streamUrl, {
      outputFormat: MpegTsOutputFormat,
      mode: this.streamMode,
    });
  }
}
