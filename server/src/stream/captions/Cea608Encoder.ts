// CEA-608 (line 21) captions for field 1, channel CC1, in pop-on mode: each
// caption is loaded into the decoder's hidden memory ahead of time, then shown
// with one End of Caption command on its start frame, so timing is exact to the
// frame. One byte pair goes out per video frame; frames without caption data
// carry null padding so players always detect the caption track.

export type CaptionCue = {
  startMs: number;
  endMs: number;
  // Plain text; lines separated by '\n'. Formatting tags are stripped.
  text: string;
};

export type CcPair = readonly [number, number];

const Columns = 32;
const MaxRows = 2;

// Odd parity in bit 7, as 608 requires for every byte
function withParity(byte: number): number {
  let ones = 0;
  for (let v = byte & 0x7f; v; v >>= 1) {
    ones += v & 1;
  }
  return (byte & 0x7f) | (ones % 2 === 0 ? 0x80 : 0);
}

function pair(a: number, b: number): CcPair {
  return [withParity(a), withParity(b)];
}

export const PaddingPair: CcPair = pair(0, 0);

// Miscellaneous control codes, data channel 1
const ResumeCaptionLoading = pair(0x14, 0x20);
const EraseDisplayedMemory = pair(0x14, 0x2c);
const EraseNonDisplayedMemory = pair(0x14, 0x2e);
const EndOfCaption = pair(0x14, 0x2f);

// Preamble address codes: [first byte, second byte for column 0] per row (1-15)
const PacRows: Record<number, readonly [number, number]> = {
  1: [0x11, 0x40],
  2: [0x11, 0x60],
  3: [0x12, 0x40],
  4: [0x12, 0x60],
  5: [0x15, 0x40],
  6: [0x15, 0x60],
  7: [0x16, 0x40],
  8: [0x16, 0x60],
  9: [0x17, 0x40],
  10: [0x17, 0x60],
  11: [0x10, 0x40],
  12: [0x13, 0x40],
  13: [0x13, 0x60],
  14: [0x14, 0x40],
  15: [0x14, 0x60],
};

// Cursor to `row`, column `indent` (a multiple of 4, 0-28)
function preambleAddress(row: number, indent: number): CcPair {
  const codes = PacRows[row];
  if (!codes) {
    throw new Error(`No 608 row ${row}`);
  }
  return pair(codes[0], codes[1] | 0x10 | ((indent / 4) << 1));
}

// The basic character set is ASCII except for these positions
const BasicOverrides: Record<number, string> = {
  0x2a: 'á',
  0x5c: 'é',
  0x5e: 'í',
  0x5f: 'ó',
  0x60: 'ú',
  0x7b: 'ç',
  0x7c: '÷',
  0x7d: 'Ñ',
  0x7e: 'ñ',
  0x7f: '█',
};

// Special characters: 0x11 0x30-0x3f (0x39 is a transparent space)
const SpecialChars = '®°½¿™¢£♪à\u0000èâêîôû';
// Extended characters: 0x12 0x20-0x3f and 0x13 0x20-0x3f. A decoder replaces
// the character before one of these, so a basic fallback is sent first.
const ExtendedChars1 = 'ÁÉÓÚÜü‘¡*’—©℠•“”ÀÂÇÈÊËëÎÏïÔÙùÛ«»';
const ExtendedChars2 = 'ÃãÍÌìÒòÕõ{}\\^_|~ÄäÖöß¥¤¦ÅåØø┌┐└┘';

type CharUnit =
  | { kind: 'basic'; byte: number }
  | { kind: 'code'; code: CcPair; fallback?: number };

const charUnits = new Map<string, CharUnit>();
for (let byte = 0x20; byte <= 0x7f; byte++) {
  charUnits.set(BasicOverrides[byte] ?? String.fromCharCode(byte), {
    kind: 'basic',
    byte,
  });
}
for (const [i, ch] of [...SpecialChars].entries()) {
  if (ch !== '\u0000') {
    charUnits.set(ch, { kind: 'code', code: pair(0x11, 0x30 + i) });
  }
}
for (const [first, chars] of [
  [0x12, ExtendedChars1],
  [0x13, ExtendedChars2],
] as const) {
  for (const [i, ch] of [...chars].entries()) {
    charUnits.set(ch, {
      kind: 'code',
      code: pair(first, 0x20 + i),
      fallback: extendedFallback(ch),
    });
  }
}

function extendedFallback(ch: string): number {
  const base = ch.normalize('NFD')[0] ?? ' ';
  const unit = charUnits.get(base);
  if (unit?.kind === 'basic') {
    return unit.byte;
  }
  const symbolFallbacks: Record<string, string> = {
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"',
    '«': '"',
    '»': '"',
    '—': '-',
    '¡': '!',
    '{': '(',
    '}': ')',
    '\\': '/',
    '|': '!',
    '~': '-',
    _: '-',
    '^': "'",
    '*': '.',
    ß: 's',
  };
  return (symbolFallbacks[ch] ?? ' ').charCodeAt(0);
}

// Characters 608 can't show, mapped to ones it can
const Transliterations: Record<string, string> = {
  '…': '...',
  '–': '-',
  '‐': '-',
  '−': '-',
  '„': '"',
  '‚': "'",
  '`': "'",
  '′': "'",
  '″': '"',
  ' ': ' ',
  '♫': '♪',
  '♬': '♪',
  // Basic 0x27 is the apostrophe, which decoders draw as ’
  '’': "'",
  '‘': "'",
};

function toUnits(text: string): CharUnit[] {
  const units: CharUnit[] = [];
  for (const raw of text) {
    for (const ch of Transliterations[raw] ?? raw) {
      const unit =
        charUnits.get(ch) ?? charUnits.get(ch.normalize('NFD')[0] ?? '');
      // Anything still unknown (e.g. CJK) is dropped rather than shown as garbage
      if (unit) {
        units.push(unit);
      }
    }
  }
  return units;
}

// Splits a word wider than a line into line-sized pieces
function splitToWidth(word: string, width: (s: string) => number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece.length > 0 && width(piece + ch) > Columns) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece.length > 0) {
    pieces.push(piece);
  }
  return pieces;
}

// Removes SRT/ASS/WebVTT formatting and splits the cue into captions of at
// most 2 lines of 32 columns each.
export function layoutCaption(text: string): string[][] {
  const words = text
    .replace(/\{[^}]*\}/g, '') // ASS override blocks
    .replace(/<[^>]*>/g, '') // HTML-like tags
    .replace(/\\[Nn]/g, '\n') // ASS line breaks
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  // Width in 608 columns: transliteration can widen a character ('…' is 3)
  const width = (s: string) => separateRepeatedCodes(toUnits(s)).length;
  // The cue's own line breaks are kept when every line fits. Otherwise the
  // whole cue is rewrapped, so a 2-line cue with one long line usually stays
  // one caption instead of becoming 3 lines split over two captions.
  const sourceLines = words.every((line) => width(line) <= Columns)
    ? words
    : [words.join(' ')];
  const lines: string[] = [];
  for (const sourceLine of sourceLines) {
    let line = '';
    for (const word of sourceLine.split(' ')) {
      const chunks = splitToWidth(word, width);
      for (const chunk of chunks) {
        if (line.length === 0) {
          line = chunk;
        } else if (width(line) + 1 + width(chunk) <= Columns) {
          line = `${line} ${chunk}`;
        } else {
          lines.push(line);
          line = chunk;
        }
      }
    }
    if (line.length > 0) {
      lines.push(line);
    }
  }

  const captions: string[][] = [];
  for (let i = 0; i < lines.length; i += MaxRows) {
    captions.push(lines.slice(i, i + MaxRows));
  }
  return captions;
}

// The pairs that load one caption into hidden memory, in atoms: runs of pairs
// that must reach the decoder back to back (a fallback character and the
// extended character that replaces it). Other commands may go between atoms.
//
// Control codes are sent once. Broadcasters send each twice so one survives a
// transmission error; this stream is never damaged in transit, and the second
// copy costs a frame each, which made captions late in fast dialogue.
function loadSequence(lines: string[]): CcPair[][] {
  const atoms: CcPair[][] = [];
  const pushCode = (code: CcPair) => atoms.push([code]);

  pushCode(ResumeCaptionLoading);
  pushCode(EraseNonDisplayedMemory);

  // Block-centred: every line starts at the same column, the block centred as
  // nearly as a preamble's 4-column steps allow (no tab offsets to send)
  const lineUnits = lines.map((line) => separateRepeatedCodes(toUnits(line)));
  const widest = Math.max(0, ...lineUnits.map((units) => units.length));
  const indent = Math.min(
    Math.max(0, Math.round((Columns - widest) / 2 / 4) * 4),
    Math.max(0, Math.floor((Columns - widest) / 4) * 4),
  );

  const firstRow = 15 - lines.length + 1;
  for (const [i, units] of lineUnits.entries()) {
    pushCode(preambleAddress(firstRow + i, indent));

    // Basic characters go two to a pair
    let pending: number | undefined;
    for (const unit of units) {
      if (unit.kind === 'basic') {
        if (pending === undefined) {
          pending = unit.byte;
        } else {
          atoms.push([pair(pending, unit.byte)]);
          pending = undefined;
        }
        continue;
      }
      if (unit.fallback !== undefined) {
        const charPair =
          pending === undefined
            ? pair(unit.fallback, 0)
            : pair(pending, unit.fallback);
        atoms.push([charPair, unit.code]);
      } else {
        if (pending !== undefined) {
          atoms.push([pair(pending, 0)]);
        }
        pushCode(unit.code);
      }
      pending = undefined;
    }
    if (pending !== undefined) {
      atoms.push([pair(pending, 0)]);
    }
  }
  return atoms;
}

// Decoders skip a code identical to the one just before it, and null padding
// doesn't reset that, so a repeated special character ("♪♪") gets a space
function separateRepeatedCodes(units: CharUnit[]): CharUnit[] {
  const space = charUnits.get(' ');
  const out: CharUnit[] = [];
  for (const unit of units) {
    const last = out.at(-1);
    if (
      space &&
      unit.kind === 'code' &&
      unit.fallback === undefined &&
      last?.kind === 'code' &&
      last.fallback === undefined &&
      last.code[0] === unit.code[0] &&
      last.code[1] === unit.code[1]
    ) {
      out.push(space);
    }
    out.push(unit);
  }
  return out;
}

export type CaptionScheduleOptions = {
  // Time of the first video frame this schedule covers, on the same clock as the cues
  firstFrameMs: number;
  frameRate: number;
  // No caption data is placed at or after this time
  endMs?: number;
};

/**
 * The caption pair for every video frame of a program. Frames are matched to
 * the schedule by time, rounded to the nearest frame slot.
 */
export class CaptionSchedule {
  constructor(
    readonly firstFrameMs: number,
    readonly frameMs: number,
    private readonly pairs: ReadonlyMap<number, CcPair>,
  ) {}

  pairAt(frameTimeMs: number): CcPair {
    const slot = Math.round((frameTimeMs - this.firstFrameMs) / this.frameMs);
    return this.pairs.get(slot) ?? PaddingPair;
  }

  get size() {
    return this.pairs.size;
  }
}

export function buildCaptionSchedule(
  cues: CaptionCue[],
  options: CaptionScheduleOptions,
): CaptionSchedule {
  const frameMs = 1000 / options.frameRate;
  const endMs = options.endMs ?? Number.POSITIVE_INFINITY;
  const slotOf = (ms: number) =>
    Math.round((ms - options.firstFrameMs) / frameMs);
  const lastSlot = slotOf(endMs) - 1;

  // Each cue becomes one or more captions of up to 2 lines, sharing its time
  const captions = cues
    .flatMap((cue) => {
      // A cue too long for one caption is shown in parts, each for a share of
      // the cue's time in proportion to its text
      const parts = layoutCaption(cue.text);
      const lengths = parts.map((lines) => lines.join(' ').length);
      const total = Math.max(
        lengths.reduce((a, b) => a + b, 0),
        1,
      );
      let at = cue.startMs;
      return parts.map((lines, i) => {
        const startMs = at;
        at += ((cue.endMs - cue.startMs) * (lengths[i] ?? 0)) / total;
        return { startMs, endMs: at, lines };
      });
    })
    .filter((c) => c.endMs > options.firstFrameMs && c.startMs < endMs)
    .sort((a, b) => a.startMs - b.startMs);

  const pairs = new Map<number, CcPair>();
  const take = (slot: number, p: CcPair) => {
    if (slot >= 0 && slot <= lastSlot) {
      pairs.set(slot, p);
    }
  };
  const isFree = (slot: number) => !pairs.has(slot);
  const isFreeRun = (slot: number, length: number) => {
    for (let s = slot; s < slot + length; s++) {
      if (!isFree(s)) {
        return false;
      }
    }
    return true;
  };

  // Loads the atoms so the last ends just before `endSlot`, no earlier than
  // `minSlot`, stepping around commands already placed. False if they don't fit.
  const placeBefore = (atoms: CcPair[][], endSlot: number, minSlot: number) => {
    const placed: [number, CcPair[]][] = [];
    let limit = endSlot - 1;
    for (const atom of atoms.toReversed()) {
      let slot = limit - atom.length + 1;
      while (slot >= minSlot && !isFreeRun(slot, atom.length)) {
        slot--;
      }
      if (slot < minSlot) {
        return false;
      }
      placed.push([slot, atom]);
      limit = slot - 1;
    }
    for (const [slot, atom] of placed) {
      atom.forEach((p, k) => take(slot + k, p));
    }
    return true;
  };
  // Loads the atoms as early as possible from `startSlot`; returns the slot after the last
  const placeFrom = (atoms: CcPair[][], startSlot: number) => {
    let slot = startSlot;
    for (const atom of atoms) {
      while (!isFreeRun(slot, atom.length)) {
        slot++;
      }
      atom.forEach((p, k) => take(slot + k, p));
      slot += atom.length;
    }
    return slot;
  };

  // Hidden memory can only be reloaded once the previous caption is on screen
  let loadAfter = 0;
  for (const [i, caption] of captions.entries()) {
    const load = loadSequence(caption.lines);
    const wanted = Math.max(slotOf(caption.startMs), 0);

    // Show it on its start frame, or as soon as loading finishes when there
    // isn't room before it (a short gap, or a cue already under way)
    let showAt = wanted;
    if (!placeBefore(load, wanted, loadAfter)) {
      showAt = Math.max(wanted, placeFrom(load, loadAfter));
    }
    while (!isFree(showAt)) {
      showAt++;
    }
    take(showAt, EndOfCaption);
    loadAfter = showAt + 1;

    // Clear the screen at the end, unless the next caption replaces it right away
    const next = captions[i + 1];
    const endSlot = Math.max(slotOf(caption.endMs), showAt + 1);
    if (!next || slotOf(next.startMs) > endSlot + 1) {
      let clearAt = endSlot;
      while (!isFree(clearAt)) {
        clearAt++;
      }
      take(clearAt, EraseDisplayedMemory);
    }
  }

  return new CaptionSchedule(options.firstFrameMs, frameMs, pairs);
}
