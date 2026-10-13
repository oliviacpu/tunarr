import { VideoFormats } from '@/ffmpeg/builder/constants.js';
import type { Nullable } from '@/types/util.js';
import { isNonEmptyString } from '@/util/index.js';
import { VideoEncoder } from './BaseEncoder.js';

export class Libx264Encoder extends VideoEncoder {
  protected readonly videoFormat = VideoFormats.H264;

  constructor(
    private videoProfile: Nullable<string>,
    private videoPreset: Nullable<string>,
    // The transcode config's thread count. Without it libx264 picks its own, about 1.5x the visible cores.
    private threads: Nullable<number> = null,
  ) {
    super('libx264');
  }

  options(): string[] {
    const opts = [...super.options()];
    if (isNonEmptyString(this.videoPreset)) {
      opts.push('-preset:v', this.videoPreset);
    }
    if (isNonEmptyString(this.videoProfile)) {
      opts.push('-profile:v', this.videoProfile);
    }
    if (this.threads !== null && this.threads > 0) {
      opts.push('-threads:v', this.threads.toString(10));
    }
    return opts;
  }
}
