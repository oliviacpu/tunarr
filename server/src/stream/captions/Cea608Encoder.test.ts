import type { CcPair } from './Cea608Encoder.ts';
import {
  buildCaptionSchedule,
  layoutCaption,
  PaddingPair,
} from './Cea608Encoder.ts';

const FrameRate = 30;
const frameMs = 1000 / FrameRate;

const EndOfCaption = [0x14, 0x2f];
const EraseDisplayedMemory = [0x14, 0x2c];
const ResumeCaptionLoading = [0x14, 0x20];
const MusicNote = [0x11, 0x37];

const withoutParity = (p: CcPair) => [p[0] & 0x7f, p[1] & 0x7f];

function hasOddParity(byte: number) {
  let ones = 0;
  for (let v = byte; v; v >>= 1) {
    ones += v & 1;
  }
  return ones % 2 === 1;
}

// The pair sent on each frame, parity removed, for frames [0, frames)
function framePairs(
  cues: Parameters<typeof buildCaptionSchedule>[0],
  frames: number,
  firstFrameMs = 0,
) {
  const schedule = buildCaptionSchedule(cues, {
    firstFrameMs,
    frameRate: FrameRate,
  });
  return Array.from({ length: frames }, (_, k) =>
    withoutParity(schedule.pairAt(firstFrameMs + k * frameMs)),
  );
}

const indexOfPair = (pairs: number[][], target: number[], from = 0) =>
  pairs.findIndex(
    (p, i) => i >= from && p[0] === target[0] && p[1] === target[1],
  );

// The basic characters sent between two frames (pairs that aren't control codes)
function textBetween(pairs: number[][], from: number, to: number) {
  return pairs
    .slice(from, to)
    .filter((p) => (p[0] ?? 0) >= 0x20)
    .flatMap((p) => p.filter((b) => b >= 0x20))
    .map((b) => String.fromCharCode(b))
    .join('');
}

describe('layoutCaption', () => {
  test('wraps at 32 columns on word boundaries, two lines per caption', () => {
    const captions = layoutCaption(
      'The quick brown fox jumps over the lazy dog, then keeps on running far away from here',
    );

    expect(captions.flat().every((line) => line.length <= 32)).toBe(true);
    expect(captions.every((lines) => lines.length <= 2)).toBe(true);
    expect(captions.flat().join(' ')).toBe(
      'The quick brown fox jumps over the lazy dog, then keeps on running far away from here',
    );
    expect(captions).toHaveLength(2);
  });

  test('removes SRT, ASS and WebVTT formatting', () => {
    expect(layoutCaption('{\\an8}<i>Hello</i>\\Nthere  <b>you</b>')).toEqual([
      ['Hello', 'there you'],
    ]);
  });

  test("keeps the cue's own line breaks", () => {
    expect(layoutCaption('First line\nSecond line')).toEqual([
      ['First line', 'Second line'],
    ]);
  });
});

describe('buildCaptionSchedule', () => {
  test('sends a pair with odd parity on every frame, null padding when idle', () => {
    const schedule = buildCaptionSchedule(
      [{ startMs: 2000, endMs: 3000, text: 'Hi' }],
      { firstFrameMs: 0, frameRate: FrameRate },
    );

    for (let k = 0; k < 150; k++) {
      const [a, b] = schedule.pairAt(k * frameMs);
      expect(hasOddParity(a)).toBe(true);
      expect(hasOddParity(b)).toBe(true);
    }
    expect(schedule.pairAt(0)).toEqual(PaddingPair);
    expect(PaddingPair).toEqual([0x80, 0x80]);
  });

  test('shows a caption on its start frame and clears it on its end frame', () => {
    const pairs = framePairs([{ startMs: 2000, endMs: 4000, text: 'Hi' }], 150);

    expect(pairs[60]).toEqual(EndOfCaption);
    expect(pairs[61]).toEqual(EndOfCaption);
    expect(indexOfPair(pairs, EndOfCaption)).toBe(60);
    expect(pairs[120]).toEqual(EraseDisplayedMemory);
    expect(pairs[121]).toEqual(EraseDisplayedMemory);
  });

  test('loads the caption before its start frame', () => {
    const pairs = framePairs(
      [{ startMs: 2000, endMs: 4000, text: 'Hello' }],
      150,
    );
    const load = indexOfPair(pairs, ResumeCaptionLoading);

    expect(load).toBeGreaterThan(0);
    expect(load).toBeLessThan(60);
    expect(textBetween(pairs, load, 60)).toBe('Hello');
  });

  test('shows a cue already under way as soon as it is loaded', () => {
    // The program starts at 1 s, inside a cue that began at 0 s
    const pairs = framePairs(
      [{ startMs: 0, endMs: 3000, text: 'Already talking' }],
      90,
      1000,
    );
    const shown = indexOfPair(pairs, EndOfCaption);

    expect(indexOfPair(pairs, ResumeCaptionLoading)).toBe(0);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(30);
  });

  test('replaces one caption with the next without clearing the screen between them', () => {
    const pairs = framePairs(
      [
        { startMs: 1000, endMs: 3000, text: 'First' },
        { startMs: 3000, endMs: 5000, text: 'Second' },
      ],
      180,
    );

    expect(pairs[30]).toEqual(EndOfCaption);
    expect(pairs[90]).toEqual(EndOfCaption);
    expect(indexOfPair(pairs, EraseDisplayedMemory)).toBe(150);
  });

  test('separates a repeated special character with a space', () => {
    const pairs = framePairs([{ startMs: 2000, endMs: 3000, text: '♪♪' }], 90);
    const first = indexOfPair(pairs, MusicNote);

    // ♪ (sent twice), a space, ♪ (sent twice)
    expect(pairs.slice(first, first + 5)).toEqual([
      MusicNote,
      MusicNote,
      [0x20, 0x00],
      MusicNote,
      MusicNote,
    ]);
  });

  test('sends nothing at or after the end of the program', () => {
    const schedule = buildCaptionSchedule(
      [{ startMs: 1000, endMs: 5000, text: 'Cut short' }],
      { firstFrameMs: 0, frameRate: FrameRate, endMs: 2000 },
    );

    for (let k = 60; k < 180; k++) {
      expect(schedule.pairAt(k * frameMs)).toEqual(PaddingPair);
    }
  });
});
