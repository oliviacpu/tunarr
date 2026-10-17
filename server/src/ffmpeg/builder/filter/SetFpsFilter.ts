import { ffmpegFrameRate } from '../../outputFrameRate.ts';
import type { FrameState } from '../state/FrameState.ts';
import { FilterOption } from './FilterOption.ts';

export class SetFpsFilter extends FilterOption {
  constructor(private frameRate: number) {
    super();
  }

  get filter(): string {
    return `fps=${ffmpegFrameRate(this.frameRate)}`;
  }

  nextState(currentState: FrameState): FrameState {
    return currentState.update({
      frameRate: this.frameRate,
    });
  }
}
