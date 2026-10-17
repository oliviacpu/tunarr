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

// A reported rate this close to a standard one is that rate, measured or rounded loosely: an average over a few
// stray or missing frames (23.81 for a 23.976 film), or a rounded label ("23.98"). Further off, the header doesn't
// describe the video at all: a DVD rip whose frames alternate 1/24 s and 1/30 s apart can report 20.
const StandardRateTolerance = 0.02;

export type OutputFrameRate = {
  // Frames per second, exact for the NTSC rates
  rate: number;
  // Whether the source reported a standard rate (or one within the tolerance of it)
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
 * The constant frame rate to give a transcode of a source that reports `framerate`. A standard rate, or one close to
 * it, is that standard rate exactly, and a rate above them all (120) is kept. Any other reported rate can't be
 * trusted: outputting it would make ffmpeg drop (or repeat) frames to fit it. Such a source gets 29.97, which holds
 * any video up to 30 frames a second without dropping one, or 59.94 when it reports more than that. Undefined when
 * the rate is missing or implausible.
 */
export function outputFrameRate(
  framerate: number | string | null | undefined,
): OutputFrameRate | undefined {
  const reported = parseRate(framerate);
  if (reported === undefined) {
    return;
  }
  let nearest = StandardFrameRates[0] ?? 30000 / 1001;
  for (const standard of StandardFrameRates) {
    if (Math.abs(reported - standard) < Math.abs(reported - nearest)) {
      nearest = standard;
    }
  }
  if (Math.abs(reported - nearest) / nearest <= StandardRateTolerance) {
    return { rate: nearest, standard: true };
  }
  // Above every standard rate: high-frame-rate video, kept as reported (exactly
  // for an NTSC multiple, 119.88 as 120000/1001)
  if (reported > 60 * (1 + StandardRateTolerance)) {
    const ntsc = (Math.round((reported * 1001) / 1000) * 1000) / 1001;
    return {
      rate:
        Math.abs(reported - ntsc) < 0.005 && !Number.isInteger(reported)
          ? ntsc
          : reported,
      standard: true,
    };
  }
  return {
    rate: reported <= 31 ? 30000 / 1001 : 60000 / 1001,
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
