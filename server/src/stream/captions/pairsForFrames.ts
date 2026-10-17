import type { CaptionSchedule, CcPair } from './Cea608Encoder.ts';
import { PaddingPair } from './Cea608Encoder.ts';

// The longest run of frame slots without a frame that is made up for. A frame
// or two missing is caught up within a few frames; a longer jump is a new
// start, where old pairs would only arrive late.
const MaxCatchUpSlots = 8;

const isPadding = (p: CcPair) => (p[0] & 0x7f) === 0 && (p[1] & 0x7f) === 0;
const isControlCode = (p: CcPair) => (p[0] & 0x70) === 0x10;
const samePair = (a: CcPair | undefined, b: CcPair) =>
  a !== undefined && a[0] === b[0] && a[1] === b[1];

/**
 * The caption pair for each of a segment's video frames of one program, given
 * the frames' times on the schedule's clock, in presentation order. The
 * schedule has a pair per frame slot, and a frame takes the pair of the slot
 * it is shown in. When frames don't land one per slot, a lookup by slot alone
 * would lose a pair (a slot without a frame) or send it twice (two frames in a
 * slot): two letters gone or doubled, or a caption command lost. Instead:
 * - a slot without a frame has its pair sent on the frames that follow, one
 *   pair a frame (608's field 1 carries one), ahead of later pairs and in order
 * - a second frame in a slot sends padding, or the next pair waiting. When the
 *   frame before it sent the first copy of a control code (608 sends each
 *   twice, and decoders skip a copy only on the very next frame), it sends the
 *   copy, which would otherwise come a frame later after padding.
 * - a program's first frames start from its first slot, so pairs due before a
 *   frame that went missing there are still sent
 *
 * Only the segment's own frames decide, so a segment gets the same pairs
 * however often and in whatever order segments are asked for. A frame missing
 * right where a segment starts can't be told from the segment alone, and its
 * pair is lost: Tunarr's segments are evenly spaced, so that would take a
 * frame lost before them.
 */
export function pairsForFrames(
  schedule: CaptionSchedule,
  frameTimesMs: readonly number[],
): CcPair[] {
  const pairs: CcPair[] = [];
  // The first slot whose pair hasn't been queued or sent yet
  let nextSlot: number | undefined;
  // Pairs of slots already passed, waiting for a frame
  let waiting: CcPair[] = [];
  let lastSent: CcPair | undefined;

  for (const timeMs of frameTimesMs) {
    const slot = schedule.slotAt(timeMs);
    if (nextSlot === undefined) {
      nextSlot = slot > 0 && slot <= MaxCatchUpSlots ? 0 : slot;
    } else if (slot - nextSlot >= MaxCatchUpSlots) {
      waiting = [];
      nextSlot = slot;
    }
    if (slot >= nextSlot) {
      for (let s = nextSlot; s <= slot; s++) {
        const pair = schedule.pairAtSlot(s);
        if (!isPadding(pair)) {
          waiting.push(pair);
        }
      }
      nextSlot = slot + 1;
    } else if (waiting.length === 0 && lastSent && isControlCode(lastSent)) {
      // A second frame in a slot: keep a control code's two copies together
      const next = schedule.pairAtSlot(nextSlot);
      if (samePair(lastSent, next)) {
        waiting.push(next);
        nextSlot++;
      }
    }

    const pair = waiting.shift() ?? PaddingPair;
    lastSent = pair;
    pairs.push(pair);
  }
  return pairs;
}
