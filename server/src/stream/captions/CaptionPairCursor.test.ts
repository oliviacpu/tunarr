import { CaptionPairCursor } from './CaptionPairCursor.ts';
import type { CcPair } from './Cea608Encoder.ts';
import { CaptionSchedule, PaddingPair } from './Cea608Encoder.ts';

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
function send(cursor: CaptionPairCursor, slots: number[]): CcPair[] {
  return slots.map((slot) => {
    const ms = slot * FrameMs;
    return cursor.pairFor(Math.round(ms * 90), ms);
  });
}

describe('CaptionPairCursor', () => {
  test('sends each pair on its own frame when frames land one per slot', () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: text(0), 1: text(1), 3: text(3) }),
    );
    expect(send(cursor, [0, 1, 2, 3, 4])).toEqual([
      text(0),
      text(1),
      PaddingPair,
      text(3),
      PaddingPair,
    ]);
  });

  test("sends a missing frame's pair on the next frame, and the rest in order", () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: text(0), 1: text(1), 2: text(2), 3: text(3) }),
    );
    // No frame in slot 2
    expect(send(cursor, [0, 1, 3, 4, 5])).toEqual([
      text(0),
      text(1),
      text(2),
      text(3),
      PaddingPair,
    ]);
  });

  test('sends padding on a second frame in a slot, not the pair again', () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: text(0), 1: text(1), 2: text(2) }),
    );
    // Two frames round to slot 1
    expect(send(cursor, [0, 0.9, 1.2, 2])).toEqual([
      text(0),
      text(1),
      PaddingPair,
      text(2),
    ]);
  });

  test("keeps a control code's two copies on consecutive frames", () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: EndOfCaption, 1: EndOfCaption, 2: text(2) }),
    );
    // A second frame in slot 0 takes the copy; a third End of Caption would
    // be a new command to a decoder
    expect(send(cursor, [0, 0.4, 1, 2])).toEqual([
      EndOfCaption,
      EndOfCaption,
      PaddingPair,
      text(2),
    ]);
  });

  test('gives a frame asked about again the pair it got before', () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: text(0), 1: text(1), 2: text(2), 3: text(3) }),
    );
    const first = send(cursor, [0, 1, 3]);
    // The same frames again (a segment captioned for a second viewer), then
    // the next one
    expect(send(cursor, [0, 1, 3])).toEqual(first);
    expect(send(cursor, [4])).toEqual([text(3)]);
  });

  test('starts afresh after a long run of slots without frames', () => {
    const cursor = new CaptionPairCursor(
      schedule({ 0: text(0), 1: text(1), 2: text(2), 40: text(40) }),
    );
    // A viewer joining far ahead gets what is due now, not a backlog
    expect(send(cursor, [0, 40, 41])).toEqual([text(0), text(40), PaddingPair]);
  });

  test('gives an earlier frame not asked about before the pair of its slot', () => {
    const cursor = new CaptionPairCursor(
      schedule({ 3: text(3), 10: text(10) }),
    );
    send(cursor, [10]);
    expect(send(cursor, [3])).toEqual([text(3)]);
  });
});
