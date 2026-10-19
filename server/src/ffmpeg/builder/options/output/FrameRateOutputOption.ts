import { ffmpegFrameRate } from '../../../outputFrameRate.ts';
import { OutputOption } from '../OutputOption.ts';

export class FrameRateOutputOption extends OutputOption {
  constructor(readonly frameRate: number) {
    super();
  }

  options(): string[] {
    return ['-r', ffmpegFrameRate(this.frameRate), '-fps_mode', 'cfr'];
  }
}
