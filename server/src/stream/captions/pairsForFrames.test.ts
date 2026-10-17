import type { CcPair } from './Cea608Encoder.ts';
import { CaptionSchedule, PaddingPair } from './Cea608Encoder.ts';
import { pairsForFrames } from './pairsForFrames.ts';

// 30 frame slots a second from time 0
const FrameMs = 1000 / 30;
const text = (k: number): CcPair => [0xc1 + k, 0xc2];
const EndOfCaption: CcPair = [0x94, 0x2f];

function schedule(pairs: Record<number, CcPair>) {
  return new CaptionSchedule(
    0,
    FrameMs,
    new Map(Object.entries(pairs).map(([slot, p]) => [Number(slot), p])),
  );
}

// The pairs frames shown at these slots get, slots fractional for frames
// between them
const send = (s: CaptionSchedule, slots: number[]) =>
  pairsForFrames(
    s,
    slots.map((slot) => slot * FrameMs),
  );

describe('pairsForFrames', () => {
  test('sends each pair on its own frame when frames land one per slot', () => {
    expect(
      send(schedule({ 0: text(0), 1: text(1), 3: text(3) }), [0, 1, 2, 3, 4]),
    ).toEqual([text(0), text(1), PaddingPair, text(3), PaddingPair]);
  });

  test("sends a missing frame's pair on the next frame, and the rest in order", () => {
    // No frame in slot 2
    expect(
      send(
        schedule({ 0: text(0), 1: text(1), 2: text(2), 3: text(3) }),
        [0, 1, 3, 4, 5],
      ),
    ).toEqual([text(0), text(1), text(2), text(3), PaddingPair]);
  });

  test('sends padding on a second frame in a slot, not the pair again', () => {
    // Two frames round to slot 1
    expect(
      send(schedule({ 0: text(0), 1: text(1), 2: text(2) }), [0, 0.9, 1.2, 2]),
    ).toEqual([text(0), text(1), PaddingPair, text(2)]);
  });

  test("keeps a control code's two copies on consecutive frames", () => {
    // A second frame in slot 0 takes the copy; a third End of Caption would
    // be a new command to a decoder
    expect(
      send(
        schedule({ 0: EndOfCaption, 1: EndOfCaption, 2: text(2) }),
        [0, 0.4, 1, 2],
      ),
    ).toEqual([EndOfCaption, EndOfCaption, PaddingPair, text(2)]);
  });

  test("starts from a program's first slot when its first frames are missing", () => {
    // The program's first two frames never came
    expect(
      send(schedule({ 0: text(0), 1: text(1), 2: text(2) }), [2, 3, 4]),
    ).toEqual([text(0), text(1), text(2)]);
  });

  test('starts from the first frame of a later segment', () => {
    // A segment from the middle of a program: nothing before it is sent late
    expect(send(schedule({ 58: text(58), 60: text(60) }), [60, 61])).toEqual([
      text(60),
      PaddingPair,
    ]);
  });

  test('starts afresh after a long run of slots without frames', () => {
    expect(
      send(
        schedule({ 0: text(0), 1: text(1), 2: text(2), 40: text(40) }),
        [0, 40, 41],
      ),
    ).toEqual([text(0), text(40), PaddingPair]);
  });
});
