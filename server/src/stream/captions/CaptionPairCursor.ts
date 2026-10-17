import type { CaptionSchedule, CcPair } from './Cea608Encoder.ts';
import { PaddingPair } from './Cea608Encoder.ts';

// The longest run of frame slots without a frame that is made up for. A frame
// or two missing is caught up within a few frames; a longer jump is a new
// start (a viewer joining at a later segment), where old pairs would only
// arrive late.
const MaxCatchUpSlots = 8;

// Frames whose pairs are remembered, so a segment captioned again (another
// viewer, a retry) gets the same pairs: about two minutes at 29.97 fps
const RememberedFrames = 4096;

const isPadding = (p: CcPair) => (p[0] & 0x7f) === 0 && (p[1] & 0x7f) === 0;
const isControlCode = (p: CcPair) => (p[0] & 0x70) === 0x10;
const samePair = (a: CcPair | undefined, b: CcPair) =>
  a !== undefined && a[0] === b[0] && a[1] === b[1];

/**
 * Hands one program's caption pairs to its video frames, in presentation
 * order. The schedule has a pair per frame slot, and a frame takes the pair of
 * the slot it is shown in. When frames don't land one per slot, a lookup by
 * slot alone would lose a pair (a slot without a frame) or send it twice (two
 * frames in a slot): two letters gone or doubled, or a caption command lost.
 * Instead:
 * - a slot without a frame has its pair sent on the frames that follow, one
 *   pair a frame (608's field 1 carries one), ahead of later pairs and in order
 * - a second frame in a slot sends padding, or the next pair waiting. When the
 *   frame before it sent the first copy of a control code (608 sends each
 *   twice, and decoders skip a copy only on the very next frame), it sends the
 *   copy, which would otherwise come a frame later after padding.
 * - a frame asked about again gets the pair it got the first time
 */
export class CaptionPairCursor {
  // The first slot whose pair hasn't been queued or sent yet
  #nextSlot: number | undefined;
  // Pairs of slots already passed, waiting for a frame
  #waiting: CcPair[] = [];
  #lastSent: CcPair | undefined;
  // The latest frame handed a pair, by its time on the schedule's clock
  #lastTimeMs: number | undefined;
  // PTS (90 kHz) -> the pair that frame got
  #given = new Map<number, CcPair>();

  constructor(private schedule: CaptionSchedule) {}

  /**
   * The pair for the frame with this PTS, shown at `frameTimeMs` on the
   * schedule's clock (which, unlike PTS, doesn't wrap). Frames are expected in
   * presentation order; an earlier one that wasn't asked about before (a
   * segment captioned out of order) gets the pair of its slot.
   */
  pairFor(pts: number, frameTimeMs: number): CcPair {
    const given = this.#given.get(pts);
    if (given) {
      return given;
    }
    if (this.#lastTimeMs !== undefined && frameTimeMs < this.#lastTimeMs) {
      return this.schedule.pairAt(frameTimeMs);
    }

    const slot = this.schedule.slotAt(frameTimeMs);
    if (
      this.#nextSlot === undefined ||
      slot - this.#nextSlot >= MaxCatchUpSlots
    ) {
      this.#waiting = [];
      this.#nextSlot = slot;
    }
    if (slot >= this.#nextSlot) {
      for (let s = this.#nextSlot; s <= slot; s++) {
        const pair = this.schedule.pairAtSlot(s);
        if (!isPadding(pair)) {
          this.#waiting.push(pair);
        }
      }
      this.#nextSlot = slot + 1;
    } else if (this.#waiting.length === 0 && this.#lastSent) {
      // A second frame in a slot: keep a control code's two copies together
      const next = this.schedule.pairAtSlot(this.#nextSlot);
      if (isControlCode(this.#lastSent) && samePair(this.#lastSent, next)) {
        this.#waiting.push(next);
        this.#nextSlot++;
      }
    }

    const pair = this.#waiting.shift() ?? PaddingPair;
    this.#lastSent = pair;
    this.#lastTimeMs = frameTimeMs;
    this.#given.set(pts, pair);
    if (this.#given.size > RememberedFrames) {
      const oldest = this.#given.keys().next();
      if (!oldest.done) {
        this.#given.delete(oldest.value);
      }
    }
    return pair;
  }
}
