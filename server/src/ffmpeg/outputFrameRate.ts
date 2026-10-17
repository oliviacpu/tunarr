// Frame rates players and TV equipment expect, exactly (24000/1001, not 23.976)
export const StandardFrameRates: readonly number[] = [
  24000 / 1001,
  24,
  25,
  30000 / 1001,
  30,
  50,
  60000 / 1001,
  60,
];

// A reported rate this far below a standard one is that rate, measured loosely: an average over a few missing frames
// (23.81 for a 23.976 film). Snapping up to it repeats a frame now and then and never drops one. Further off, the
// header doesn't describe the video at all: a DVD rip whose frames alternate 1/24 s and 1/30 s apart can report 20.
const BelowStandardTolerance = 0.02;
// A reported rate this close to a standard one, either side, is that rate, rounded ("23.98" for 24000/1001). Under
// the 0.1% between 23.976 and 24. Any further above, snapping down would drop frames.
const RoundingTolerance = 0.0005;

export type OutputFrameRate = {
  // Frames per second, exact for the NTSC rates
  rate: number;
  // Whether the source reported this rate (a standard one, rounding aside, or a high frame rate): ffmpeg keeps it
  // anyway. Otherwise the rate is a correction the transcode must be given.
  standard: boolean;
};

// A reported frame rate (24, 23.976, "24000/1001", "25") as frames per second; undefined when missing or implausible
function parseRate(framerate: number | string | null | undefined) {
  let rate: number;
  if (typeof framerate === 'number') {
    rate = framerate;
  } else if (typeof framerate === 'string' && framerate.includes('/')) {
    const [num, den] = framerate.split('/').map(Number);
    rate = num !== undefined && den !== undefined ? num / den : NaN;
  } else {
    rate = parseFloat(framerate ?? '');
  }
  return Number.isFinite(rate) && rate > 0 && rate <= 240 ? rate : undefined;
}

/**
 * The constant frame rate to give a transcode of a source that reports `framerate`, never fewer frames a second than
 * it reports:
 * - a standard rate, a rounded label for one, or a rate up to 2% below one: that standard rate, exactly
 * - above every standard rate (120): kept as reported, high-frame-rate video
 * - any other rate can't be trusted, and outputting it would make ffmpeg drop (or repeat) frames to fit it: 29.97,
 *   which holds any video up to 30 frames a second, or 59.94 above that
 * Undefined when the rate is missing or implausible.
 */
export function outputFrameRate(
  framerate: number | string | null | undefined,
): OutputFrameRate | undefined {
  const reported = parseRate(framerate);
  if (reported === undefined) {
    return;
  }
  const rounded = StandardFrameRates.find(
    (standard) => Math.abs(reported - standard) / standard <= RoundingTolerance,
  );
  if (rounded !== undefined) {
    return { rate: rounded, standard: true };
  }
  const atOrAbove = StandardFrameRates.find((standard) => standard > reported);
  if (atOrAbove === undefined) {
    // High-frame-rate video, exact for an NTSC multiple (119.88 as 120000/1001)
    const ntsc = (Math.round((reported * 1001) / 1000) * 1000) / 1001;
    return {
      rate:
        Math.abs(reported - ntsc) < 0.005 && !Number.isInteger(reported)
          ? ntsc
          : reported,
      standard: true,
    };
  }
  if (reported >= atOrAbove * (1 - BelowStandardTolerance)) {
    return { rate: atOrAbove, standard: false };
  }
  return {
    rate: reported < 30 ? 30000 / 1001 : 60000 / 1001,
    standard: false,
  };
}

/**
 * Whether the software deinterlace filter outputs a frame per field, twice the source's frame rate. "none" is the
 * DeinterlaceFilter's own default, yadif=1.
 */
export function deinterlacerDoublesFrameRate(
  filter: string | null | undefined,
): boolean {
  return ['none', 'yadif=1', 'bwdif=1', 'w3fdif'].includes(filter ?? 'none');
}

/**
 * A frame rate as ffmpeg's -r and fps filter take it: an NTSC rate as its exact fraction (30000/1001), so neither
 * side rounds it, and any other rate as a number.
 */
export function ffmpegFrameRate(rate: number): string {
  const numerator = Math.round(rate * 1001);
  if (
    Math.abs(rate * 1001 - numerator) < 1e-6 &&
    numerator % 1000 === 0 &&
    !Number.isInteger(rate)
  ) {
    return `${numerator}/1001`;
  }
  return rate.toString(10);
}
