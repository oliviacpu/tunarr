import type { InputSource } from '../../input/InputSource.ts';
import { InputOption } from './InputOption.ts';

/**
 * How much of the input ffmpeg reads to learn every stream's parameters before
 * writing the output header. A stream copy can't start without them: an audio
 * track whose first packets come after the window has no sample rate, and the
 * MPEG-TS muxer refuses the header ("sample rate not set"). ffmpeg stops
 * reading as soon as every stream is known, so a longer window only costs time
 * when a stream is late. The HLS demuxer gives its segment demuxer these
 * values, or only 4 s of analysis when none are set.
 */
export class ProbeWindowInputOption extends InputOption {
  constructor(
    private analyzeSeconds: number,
    private probeBytes: number,
  ) {
    super();
  }

  appliesToInput(_input: InputSource): boolean {
    return true;
  }

  options(): string[] {
    return [
      '-analyzeduration',
      `${Math.round(this.analyzeSeconds * 1_000_000)}`,
      '-probesize',
      `${this.probeBytes}`,
    ];
  }
}
