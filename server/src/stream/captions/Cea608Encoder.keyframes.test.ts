import type { CaptionCue } from './Cea608Encoder.ts';
import { buildCaptionSchedule, captionLoadFrames } from './Cea608Encoder.ts';
import type { DecodedRow } from '../../testing/captions/Cea608TestDecoder.ts';
import {
  decodeScreens,
  screenAt,
} from '../../testing/captions/Cea608TestDecoder.ts';

// A player tuning in starts decoding at a keyframe (the frames before it can't
// be decoded, and their caption data goes with them). FFmpeg's decoder, and
// Plex's from the same family, starts in roll-up mode, so the rest of a pop-on
// caption still loading there would go straight on screen.

const KeyframeMs = 2000;

function pairs(
  cues: CaptionCue[],
  frameRate: number,
  frames: number,
  keyframeIntervalMs?: number,
) {
  const schedule = buildCaptionSchedule(cues, {
    firstFrameMs: 0,
    frameRate,
    keyframeIntervalMs,
  });
  return Array.from({ length: frames }, (_, slot) => {
    const [a, b] = schedule.pairAtSlot(slot);
    return [a & 0x7f, b & 0x7f];
  });
}

// The keyframes of Tunarr's transcodes: the first frame at or after each
// multiple of the interval, and the frame before it, which libx264 makes one
// too with Tunarr's options
const keyframes = (frameRate: number, frames: number, intervalMs: number) => {
  const slots: number[] = [];
  for (let k = 1; ; k++) {
    const slot = Math.ceil((k * intervalMs * frameRate) / 1000 - 1e-6);
    if (slot >= frames) {
      return slots;
    }
    slots.push(slot - 1, slot);
  }
};

const text = (rows: DecodedRow[]) =>
  rows
    .map((r) => r.text.trim())
    .filter((t) => t !== '')
    .join(' / ');

// The keyframes where a decoder starting there shows text that a decoder
// reading from the start isn't showing on that frame
function fragmentsAt(sent: number[][], slots: number[]) {
  const full = decodeScreens(sent);
  return slots.filter((slot) =>
    decodeScreens(sent.slice(slot), { joining: true }).some((screen) => {
      const shown = text(screen.rows);
      return (
        shown !== '' && shown !== text(screenAt(full, slot + screen.fromFrame))
      );
    }),
  );
}

// Each caption's text and the frame it first shows on, in order
function shows(sent: number[][]) {
  const out: { frame: number; text: string }[] = [];
  for (const screen of decodeScreens(sent)) {
    const shown = text(screen.rows);
    if (shown !== '' && out.at(-1)?.text !== shown) {
      out.push({ frame: screen.fromFrame, text: shown });
    }
  }
  return out;
}

// Dialogue: cues back to back, a gap of `gapMs` to `gapMs * 2` between them,
// one or two lines each, from a fixed seed
function dialogue(count: number, gapMs: number): CaptionCue[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const words =
    'we could take the long way back if you want but the bridge is out again and nobody told me anything about it until this morning so here we are'.split(
      ' ',
    );
  const line = (chars: number) => {
    const out: string[] = [];
    while (out.join(' ').length < chars) {
      out.push(words[Math.floor(random() * words.length)] ?? 'so');
    }
    return out.join(' ');
  };
  const cues: CaptionCue[] = [];
  let at = 1000;
  for (let i = 0; i < count; i++) {
    const durationMs = 1200 + Math.floor(random() * 2300);
    const lines = random() < 0.6 ? 2 : 1;
    cues.push({
      startMs: at,
      endMs: at + durationMs,
      text: Array.from({ length: lines }, () =>
        line(12 + Math.floor(random() * 18)),
      ).join('\n'),
    });
    at += durationMs + gapMs + Math.floor(random() * gapMs);
  }
  return cues;
}

// The same captions show, none earlier and none more than 300 ms later (a
// frame of rounding aside) than without keyframes
function expectShownAsBefore(
  sent: number[][],
  plain: number[][],
  rate: number,
) {
  const plainShows = shows(plain);
  const keyframeShows = shows(sent);
  expect(keyframeShows.map((s) => s.text)).toEqual(
    plainShows.map((s) => s.text),
  );
  for (const [k, s] of keyframeShows.entries()) {
    const delayMs = ((s.frame - (plainShows[k]?.frame ?? 0)) * 1000) / rate;
    expect(delayMs).toBeGreaterThanOrEqual(0);
    expect(delayMs).toBeLessThanOrEqual(300 + 1000 / rate);
  }
}

describe('captions and keyframes', () => {
  // 30 fps: keyframes on frames 59 and 60, 119 and 120, ...
  const frameRate = 30;
  const frameMs = 1000 / frameRate;
  const keyframe = 60;
  const atKeyframe = [keyframe - 1, keyframe];
  const later = 'We should get going before\nthe rain starts again tonight';
  const laterShown =
    'We should get going before / the rain starts again tonight';
  const load = captionLoadFrames(later);

  test('a caption loading across a keyframe shows as a fragment to a decoder starting there', () => {
    // The load just before its start frame crosses frame 60
    const cues = [
      { startMs: 15 * frameMs, endMs: 78 * frameMs, text: 'Hi.' },
      { startMs: 78 * frameMs, endMs: 150 * frameMs, text: later },
    ];
    const sent = pairs(cues, frameRate, 180);

    expect(78 - load).toBeLessThan(keyframe);
    expect(fragmentsAt(sent, atKeyframe)).toEqual(atKeyframe);
  });

  test('loads it before the keyframe instead, still on time', () => {
    const cues = [
      { startMs: 15 * frameMs, endMs: 78 * frameMs, text: 'Hi.' },
      { startMs: 78 * frameMs, endMs: 150 * frameMs, text: later },
    ];
    const sent = pairs(cues, frameRate, 180, KeyframeMs);

    expect(fragmentsAt(sent, atKeyframe)).toEqual([]);
    expect(shows(sent)).toEqual(shows(pairs(cues, frameRate, 180)));
    expect(shows(sent).at(-1)).toEqual({ frame: 78, text: laterShown });
    // A decoder starting at either keyframe misses it whole: no fragment
    for (const slot of atKeyframe) {
      const joined = decodeScreens(sent.slice(slot), { joining: true });
      expect(joined.every((s) => text(s.rows) === '')).toBe(true);
    }
  });

  test('shows a caption up to 300 ms late so its whole load comes after the keyframe', () => {
    // Too little room before the keyframe (the caption before shows on frame
    // 50) and after it (the caption starts 5 frames too soon to load there)
    const startFrame = keyframe + load - 5;
    const cues = [
      { startMs: 50 * frameMs, endMs: startFrame * frameMs, text: 'Hi.' },
      {
        startMs: startFrame * frameMs,
        endMs: (startFrame + 60) * frameMs,
        text: later,
      },
    ];
    const sent = pairs(cues, frameRate, 240, KeyframeMs);

    expect(fragmentsAt(sent, atKeyframe)).toEqual([]);
    // On time when its load crosses the keyframe; 5 frames (167 ms) later
    // when it doesn't
    expect(shows(pairs(cues, frameRate, 240)).at(-1)).toEqual({
      frame: startFrame,
      text: laterShown,
    });
    expect(shows(sent).at(-1)).toEqual({
      frame: startFrame + 5,
      text: laterShown,
    });
    // A decoder starting at the keyframe shows the whole caption, with
    // everyone else
    const joined = decodeScreens(sent.slice(keyframe), { joining: true });
    expect(
      joined.map((s) => [keyframe + s.fromFrame, text(s.rows)]),
    ).toContainEqual([startFrame + 5, laterShown]);
  });

  test('loads across the keyframe, on time, when keeping clear of it would make the caption more than 300 ms late', () => {
    const startFrame = keyframe + load - 12;
    const cues = [
      { startMs: 40 * frameMs, endMs: startFrame * frameMs, text: 'Hi.' },
      {
        startMs: startFrame * frameMs,
        endMs: (startFrame + 60) * frameMs,
        text: later,
      },
    ];
    const sent = pairs(cues, frameRate, 240, KeyframeMs);

    expect(sent).toEqual(pairs(cues, frameRate, 240));
    expect(fragmentsAt(sent, atKeyframe)).toEqual(atKeyframe);
  });

  test('changes nothing without keyframes', () => {
    const cues = dialogue(60, 100);
    expect(pairs(cues, frameRate, 30 * 200, undefined)).toEqual(
      pairs(cues, frameRate, 30 * 200),
    );
  });

  describe.each([
    ['23.976', 24000 / 1001],
    ['25', 25],
    ['29.97', 30000 / 1001],
    ['59.94', 60000 / 1001],
  ])('dialogue at %s fps', (_, rate) => {
    const frames = Math.ceil(rate * 260);

    test('with a pause between lines: a decoder starting at any keyframe shows nothing or what everyone sees', () => {
      const cues = dialogue(70, 600);
      const plain = pairs(cues, rate, frames);
      const sent = pairs(cues, rate, frames, KeyframeMs);
      const slots = keyframes(rate, frames, KeyframeMs);

      expect(fragmentsAt(plain, slots).length).toBeGreaterThan(0);
      expect(fragmentsAt(sent, slots)).toEqual([]);
      expectShownAsBefore(sent, plain, rate);
    });

    test('back to back: far fewer fragments, every caption still shown, none more than 300 ms later', () => {
      const cues = dialogue(90, 60);
      const plain = pairs(cues, rate, frames);
      const sent = pairs(cues, rate, frames, KeyframeMs);
      const slots = keyframes(rate, frames, KeyframeMs);

      const before = fragmentsAt(plain, slots).length;
      const after = fragmentsAt(sent, slots).length;
      expect(after).toBeLessThanOrEqual(before / 4);
      expectShownAsBefore(sent, plain, rate);
    });
  });
});
