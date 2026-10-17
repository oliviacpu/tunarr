import { describe, expect, test } from 'vitest';
import { loudnessGain, measuredLoudnessGains } from './loudness.ts';

const target = { i: -24, lra: 7, tp: -2 };

describe('loudnessGain', () => {
  test.each([
    ['a loud stream is lowered', -14, -1, -10],
    ['a quiet stream is raised', -38.5, -27, 14.5],
    ['one on target is left alone', -24, -12, 0],
    ['a very quiet one is raised as far as live loudnorm would', -46.5, -35, 22.5],
    ['raising stops at 30 dB', -60, -45, 30],
    ['lowering stops at 30 dB', 10, 12, -30],
  ])('%s', (_, integrated, truePeak, gainDb) => {
    expect(loudnessGain(target, { integrated, truePeak, range: 5 })).toEqual({
      gainDb,
    });
  });

  test('a silent stream gets no gain', () => {
    expect(
      loudnessGain(target, { integrated: -70, truePeak: -60, range: 0 }),
    ).toEqual({ gainDb: 0 });
    expect(
      loudnessGain(target, {
        integrated: Number.NEGATIVE_INFINITY,
        truePeak: Number.NEGATIVE_INFINITY,
        range: 0,
      }),
    ).toEqual({ gainDb: 0 });
  });

  test("a limiter holds peaks the gain would lift past the target's", () => {
    // -30 LUFS raised 6 dB puts a -4.5 dBTP peak at +1.5
    expect(
      loudnessGain(target, { integrated: -30, truePeak: -4.5, range: 2 }),
    ).toEqual({ gainDb: 6, limit: 0.7943 });
  });

  test("loudnorm's offset gain is added", () => {
    expect(
      loudnessGain(
        { ...target, offsetGain: 2 },
        { integrated: -20, truePeak: -10, range: 5 },
      ),
    ).toEqual({ gainDb: -2 });
  });
});

describe('measuredLoudnessGains', () => {
  const measured = { integrated: -20, truePeak: -10, range: 5 };

  test('gives each played stream its own gain', () => {
    const gains = measuredLoudnessGains(target, [
      { index: 1, loudness: measured },
      { index: 2, loudness: { integrated: -30, truePeak: -20, range: 5 } },
    ]);

    expect(gains).toEqual(
      new Map([
        [1, { gainDb: -4 }],
        [2, { gainDb: 6 }],
      ]),
    );
  });

  test('leaves live loudnorm to level a stream far more dynamic than the target', () => {
    // An episode measured 14.3 LU against a target of 7: live loudnorm also
    // compresses its range, which a fixed gain can't
    expect(
      measuredLoudnessGains(target, [
        { index: 1, loudness: { ...measured, range: 14.3 } },
      ]),
    ).toBeUndefined();
    // within 3 LU of the target's range, a fixed gain stands in
    expect(
      measuredLoudnessGains(target, [
        { index: 1, loudness: { ...measured, range: 10 } },
      ]),
    ).toEqual(new Map([[1, { gainDb: -4 }]]));
  });

  test('leaves live loudnorm to level when any stream has no measurement', () => {
    expect(
      measuredLoudnessGains(target, [
        { index: 1, loudness: measured },
        { index: 2 },
      ]),
    ).toBeUndefined();
    expect(measuredLoudnessGains(target, [])).toBeUndefined();
  });
});
