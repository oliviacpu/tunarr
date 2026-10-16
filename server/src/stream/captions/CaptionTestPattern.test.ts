import { decodeScreens } from '../../testing/captions/Cea608TestDecoder.ts';
import {
  CaptionTestSamples,
  captionTestPattern,
} from './CaptionTestPattern.ts';
import {
  buildCaptionSchedule,
  DefaultCaptionAppearance,
} from './Cea608Encoder.ts';
import { noCaptionsNoticeStartMs } from './ProgramCaptions.ts';

const base = {
  cues: [{ startMs: 0, endMs: 1000, text: 'The program’s own' }],
  frameRate: 30000 / 1001,
  durationMs: 600_000,
  language: 'eng',
};

describe('captionTestPattern', () => {
  test('numbers the samples in order', () => {
    expect(
      CaptionTestSamples.map((s) =>
        Number(/\d+/.exec(s.text.replace(/\{[^}]*\}/g, ''))?.[0]),
      ),
    ).toEqual(CaptionTestSamples.map((_, i) => i + 1));
  });

  test('replaces the cues, and keeps the rest of the program', () => {
    const pattern = captionTestPattern(base);
    expect(pattern.cues[0]?.text).toBe('1 WHITE TEXT');
    expect(pattern.frameRate).toBe(base.frameRate);
    expect(pattern.durationMs).toBe(base.durationMs);
    expect(pattern.language).toBe('eng');
  });

  // So the appearance settings can't change what a sample tests
  test('gives every cue its whole appearance', () => {
    for (const cue of captionTestPattern(base).cues) {
      expect(Object.keys(cue.appearance ?? {}).sort()).toEqual(
        Object.keys(DefaultCaptionAppearance).sort(),
      );
    }
  });

  test('starts where the notice would, and loops within the program', () => {
    const { cues } = captionTestPattern(base);
    expect(cues[0]?.startMs).toBe(noCaptionsNoticeStartMs(base.frameRate));
    expect(cues.length).toBeGreaterThan(CaptionTestSamples.length);
    // One cue per sample, plus the overlapping and follow-up second subtitles
    const perLoop =
      CaptionTestSamples.length +
      CaptionTestSamples.filter((sample) => sample.also !== undefined).length +
      CaptionTestSamples.filter((sample) => sample.then !== undefined).length;
    expect(cues[perLoop]?.text).toBe('1 WHITE TEXT');
    const last = cues.at(-1);
    expect((last?.endMs ?? Infinity) + 1000).toBeLessThanOrEqual(
      base.durationMs,
    );
  });

  test('leaves a gap after each sample, longer before a change of mode', () => {
    // A sample's second subtitle (overlapping, or a follow-up) belongs to it
    const { cues } = captionTestPattern(base);
    const seconds = new Set(
      CaptionTestSamples.flatMap((sample) => [
        ...(sample.also !== undefined ? [sample.also] : []),
        ...(sample.then !== undefined ? [sample.then] : []),
      ]),
    );
    let previous: (typeof cues)[number] | undefined;
    let previousEnd = 0;
    for (const cue of cues) {
      if (seconds.has(cue.text)) {
        previousEnd = Math.max(previousEnd, cue.endMs);
        continue;
      }
      if (previous) {
        const modeChange = cue.appearance?.mode !== previous.appearance?.mode;
        expect(cue.startMs - previousEnd).toBe(modeChange ? 2000 : 1500);
      }
      previous = cue;
      previousEnd = cue.endMs;
    }
  });

  test('follows sample 39 with a magenta-boxed subtitle a moment after it ends', () => {
    // Shorter than the second subtitle takes to load, so its load meets the
    // first one's clear
    const { cues } = captionTestPattern(base);
    const at = cues.findIndex((cue) => cue.text.startsWith('39 '));
    const [first, second] = [cues[at], cues[at + 1]];
    expect(second?.text).toBe('MAGENTA TO THE <i>VERY</i> END ♪');
    expect((second?.startMs ?? 0) - (first?.endMs ?? 0)).toBe(200);
    expect(first?.appearance?.backgroundColor).toBe('magenta');
    expect(second?.appearance?.backgroundColor).toBe('magenta');
  });

  test('adds the overlapping second subtitle to samples 37 and 38', () => {
    const { cues } = captionTestPattern(base);
    const overlapping = cues.filter(
      (cue, i) => i > 0 && cue.startMs < (cues[i - 1]?.endMs ?? 0),
    );
    expect(overlapping.slice(0, 2).map((c) => c.text)).toEqual([
      'WHEN A SECOND STARTS',
      'AND A LINE AT THE BOTTOM',
    ]);
    expect(overlapping[1]?.appearance?.overlappingCues).toBe('apart');
  });

  test('is empty for a program too short for one sample', () => {
    expect(captionTestPattern({ ...base, durationMs: 4000 }).cues).toEqual([]);
  });

  test('shows every sample, in order, whatever the appearance settings', () => {
    const frameRate = 30;
    const { cues } = captionTestPattern({ ...base, frameRate });
    const schedule = buildCaptionSchedule(cues, {
      firstFrameMs: 0,
      frameRate,
      // The user's own settings, which the samples override
      appearance: { backgroundColor: 'red', textColor: 'green' },
    });
    // Through the end of the last sample's subtitles
    const lastSample = `${CaptionTestSamples.length} `;
    const lastAt = cues.findIndex((c) => c.text.startsWith(lastSample));
    const lastEndMs = Math.max(
      ...cues.slice(lastAt, lastAt + 2).map((c) => c.endMs),
    );
    const frames = Math.ceil((lastEndMs / 1000) * frameRate) + 30;
    const screens = decodeScreens(
      Array.from({ length: frames }, (_, k) => [
        ...schedule.pairAt((k * 1000) / frameRate),
      ]),
    );

    // The frame each sample's number first shows on. A style code takes a
    // space's column, so labels read as spaces.
    const firstShown = CaptionTestSamples.map((_, i) =>
      screens.find((screen) =>
        screen.rows.some((row) =>
          row.text
            .replace(/\[[^\]]*\]/g, ' ')
            .trim()
            .startsWith(`${i + 1} `),
        ),
      ),
    );
    expect(firstShown.flatMap((screen, i) => (screen ? [] : [i + 1]))).toEqual(
      [],
    );
    const order = firstShown.map((screen) => screen?.fromFrame ?? 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // The first sample is plain white, with no box from the settings
    expect(firstShown[0]?.rows.map((r) => r.text)).toEqual(['1 WHITE TEXT']);
  });
});
