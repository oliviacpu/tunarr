import type { LoudnessGain } from '../../loudness.ts';
import type { HasStreamFilterOption } from '../types/PipelineStep.ts';
import { FilterOption } from './FilterOption.ts';

/**
 * Levels each audio stream with the fixed gain its measured loudness calls for
 * (plans/loudness-measured-once.md), instead of live loudnorm: no look-ahead,
 * so the first segments of a tune-in don't wait. A stream whose gain would lift
 * its peaks past the target gets a limiter at the target's true peak; its
 * 5 ms look-ahead is compensated, so audio stays in sync.
 */
export class MeasuredLoudnessFilter
  extends FilterOption
  implements HasStreamFilterOption
{
  constructor(private gains: ReadonlyMap<number, LoudnessGain>) {
    super();
  }

  // With one stream, its gain (the chain ComplexFilter builds per stream asks
  // filterForStream)
  public get filter(): string {
    const [first] = this.gains.values();
    return render(first ?? { gainDb: 0 });
  }

  filterForStream(streamIndex: number): string {
    return render(this.gains.get(streamIndex) ?? { gainDb: 0 });
  }
}

function render({ gainDb, limit }: LoudnessGain): string {
  const volume = `volume=${gainDb}dB`;
  return limit === undefined
    ? volume
    : `${volume},alimiter=limit=${limit}:attack=5:release=50:level=0:latency=1`;
}
