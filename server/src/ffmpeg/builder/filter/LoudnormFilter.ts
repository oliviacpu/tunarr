import type { LoudnormConfig } from '@tunarr/types';
import { isDefined } from '../../../util/index.ts';
import { FilterOption } from './FilterOption.ts';

// Target for music played under the offline picture during gaps: a TV-like integrated loudness, so tracks mastered
// loud or quiet sit at the same level next to programs.
export const GapMusicLoudnorm: LoudnormConfig = { i: -24, lra: 11, tp: -2 };

export class LoudnormFilter extends FilterOption {
  constructor(
    private loudnormConfig: LoudnormConfig,
    private sampleRate: number,
  ) {
    super();
  }

  public get filter(): string {
    const gain = isDefined(this.loudnormConfig.offsetGain)
      ? `:offset=${this.loudnormConfig.offsetGain}`
      : '';
    return `loudnorm=I=${this.loudnormConfig.i}:LRA=${this.loudnormConfig.lra}:TP=${this.loudnormConfig.tp}${gain},aresample=${this.sampleRate * 1000}`;
  }
}
