import type { LoudnormConfig } from '@tunarr/types';
import type { AudioStreamDetails, MeasuredLoudness } from '../stream/types.ts';

/**
 * A fixed gain that takes a stream whose loudness was measured to a loudness
 * target, in place of live loudnorm (plans/loudness-measured-once.md). Live
 * loudnorm looks about 3 s ahead, and the first segments of every tune-in wait
 * for it; a fixed gain doesn't.
 */
export type LoudnessGain = {
  gainDb: number;
  // A sample-peak ceiling (linear), when the gain would lift peaks above the
  // target's true peak
  limit?: number;
};

// Integrated loudness at or below which a stream counts as silent, as EBU R128
// gates it: nothing to level, so no gain
const SilenceLufs = -70;
// The most a stream is raised or lowered. Live loudnorm has no such bound,
// but past ±30 dB a "measurement" is mostly noise or near-silence.
const MaxBoostDb = 30;
const MaxCutDb = -30;

export function loudnessGain(
  target: LoudnormConfig,
  measured: MeasuredLoudness,
): LoudnessGain {
  if (!Number.isFinite(measured.integrated) || measured.integrated <= SilenceLufs) {
    return { gainDb: 0 };
  }
  const wanted = target.i - measured.integrated + (target.offsetGain ?? 0);
  const gainDb = round2(Math.min(MaxBoostDb, Math.max(MaxCutDb, wanted)));
  if (
    Number.isFinite(measured.truePeak) &&
    measured.truePeak + gainDb > target.tp
  ) {
    return { gainDb, limit: round4(Math.pow(10, target.tp / 20)) };
  }
  return { gainDb };
}

// How far a stream's loudness range may exceed the target's for a fixed gain
// to stand in for live loudnorm. Live loudnorm also compresses a program's
// range to the target's; a fixed gain doesn't. Music and commercials sit near
// or under a target's range, so they sound the same either way; episodes and
// films measured 12-21 LU against a target of 7, so they keep live loudnorm.
export const RangeToleranceLu = 3;

/**
 * Fixed gains for the source streams a transcode plays (by stream index), or
 * undefined when any of them lacks a measurement or is too dynamic for a fixed
 * gain to sound like live loudnorm: the transcode then levels them with live
 * loudnorm, as before.
 */
export function measuredLoudnessGains(
  target: LoudnormConfig,
  streams: readonly AudioStreamDetails[],
): Map<number, LoudnessGain> | undefined {
  if (streams.length === 0) {
    return;
  }
  const gains = new Map<number, LoudnessGain>();
  for (const stream of streams) {
    if (
      !stream.loudness ||
      stream.loudness.range > target.lra + RangeToleranceLu
    ) {
      return;
    }
    gains.set(stream.index, loudnessGain(target, stream.loudness));
  }
  return gains;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
