import type {
  CaptionAlignment,
  CaptionBackground,
} from '@tunarr/types/schemas';

// CEA-608 (line 21) captions for field 1, channel CC1, in pop-on mode: each
// caption is loaded into the decoder's hidden memory ahead of time, then shown
// with one End of Caption command on its start frame, so timing is exact to the
// frame. One byte pair goes out per video frame; frames without caption data
// carry null padding so players always detect the caption track.

export type CaptionCue = {
  startMs: number;
  endMs: number;
  // As the subtitle file has it: lines separated by '\n', with its formatting
  // tags. Italics, underline and top placement are kept; the rest is dropped.
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
  ' ': ' ',
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

type CaptionStyle = { italic: boolean; underline: boolean };

const PlainStyle: CaptionStyle = { italic: false, underline: false };

const sameStyle = (a: CaptionStyle, b: CaptionStyle) =>
  a.italic === b.italic && a.underline === b.underline;

// Mid-row codes set the style of the text after them, and take a column each
// (shown as a space): 0x20 white, 0x21 white underlined, 0x2e italics, 0x2f
// italics underlined
function midRowCode(style: CaptionStyle): CharUnit {
  return {
    kind: 'code',
    code: pair(0x11, (style.italic ? 0x2e : 0x20) | (style.underline ? 1 : 0)),
  };
}

// One character of a cue, with the style it is shown in
export type StyledChar = CaptionStyle & { ch: string };

// A caption as it goes on screen: up to two lines, at the top or the bottom
export type CaptionLayout = { top: boolean; lines: StyledChar[][] };

export type CaptionLayoutOptions = {
  alignment: CaptionAlignment;
  background: CaptionBackground;
};

export const DefaultCaptionLayout: CaptionLayoutOptions = {
  alignment: 'centeredBlock',
  background: 'player',
};

// CEA-608's optional background attributes. Each is sent after a space: a
// decoder that knows it draws the attribute in that column, others show the
// space.
const BackgroundCodes: Record<Exclude<CaptionBackground, 'player'>, CcPair> = {
  semiTransparent: pair(0x10, 0x2f), // black, semi-transparent
  transparent: pair(0x17, 0x2d),
};

const backgroundColumns = (options: CaptionLayoutOptions) =>
  options.background === 'player' ? 0 : 1;

// Reads a cue's text into lines of styled characters. Italics and underline
// come from SRT/WebVTT tags (<i>, <u>) and ASS overrides ({\i1}, {\u1}, {\r});
// an alignment override at the top ({\an7}-{\an9}, or SSA's {\a5}-{\a7}) puts
// the cue at the top of the screen. Other formatting is dropped.
function parseCueText(text: string): CaptionLayout {
  let style = PlainStyle;
  let top: boolean | undefined;
  const lines: StyledChar[][] = [[]];
  const current = () => lines.at(-1) ?? [];
  for (const [token] of text.matchAll(
    /\{[^}]*\}|<[^>]*>|\\[Nnh]|\n|[\s\S]/gu,
  )) {
    if (token.length > 1 && token.startsWith('{')) {
      for (const [, tag, value] of token.matchAll(/\\(an|a|i|u)(\d+)|\\r/g)) {
        const n = Number(value);
        if (tag === undefined) {
          style = PlainStyle;
        } else if (tag === 'i') {
          style = { ...style, italic: n !== 0 };
        } else if (tag === 'u') {
          style = { ...style, underline: n !== 0 };
        } else {
          // As in ASS, the first alignment override of a cue is the one used
          top ??= tag === 'an' ? n >= 7 && n <= 9 : n >= 5 && n <= 7;
        }
      }
    } else if (token.length > 1 && token.startsWith('<')) {
      const tag = /^<\s*(\/?)\s*([a-z]+)/i.exec(token);
      const name = tag?.[2]?.toLowerCase();
      if (name === 'i') {
        style = { ...style, italic: tag?.[1] !== '/' };
      } else if (name === 'u') {
        style = { ...style, underline: tag?.[1] !== '/' };
      }
    } else if (token === '\n' || token === '\\N' || token === '\\n') {
      lines.push([]);
    } else {
      current().push({ ...style, ch: token === '\\h' ? ' ' : token });
    }
  }
  return {
    top: top ?? false,
    lines: lines.map(collapseSpaces).filter((line) => line.length > 0),
  };
}

// Whitespace runs become one space, and none at either end
function collapseSpaces(line: StyledChar[]): StyledChar[] {
  const out: StyledChar[] = [];
  for (const c of line) {
    const ch = /\s/u.test(c.ch) ? ' ' : c.ch;
    if (ch === ' ' && (out.length === 0 || out.at(-1)?.ch === ' ')) {
      continue;
    }
    out.push({ ...c, ch });
  }
  while (out.at(-1)?.ch === ' ') {
    out.pop();
  }
  return out;
}

// The units that draw a line: its characters, with a mid-row code wherever the
// style changes. A change at a space takes the space's column; one inside a
// word needs a column of its own. Punctuation straight after a word keeps the
// word's style ("<i>Hello</i>," keeps the comma in italics), so no gap opens
// before it.
function lineUnits(line: StyledChar[]): CharUnit[] {
  const styles: CaptionStyle[] = [];
  for (const [k, c] of line.entries()) {
    const before = line[k - 1];
    const beforeStyle = styles[k - 1];
    styles.push(
      before &&
        beforeStyle &&
        c.ch !== ' ' &&
        before.ch !== ' ' &&
        !/[\p{L}\p{N}]/u.test(c.ch)
        ? beforeStyle
        : c,
    );
  }

  const units: CharUnit[] = [];
  let current = PlainStyle;
  for (const [k, c] of line.entries()) {
    const style = styles[k] ?? PlainStyle;
    if (c.ch === ' ') {
      const next = styles[k + 1];
      if (next && !sameStyle(next, current)) {
        units.push(midRowCode(next));
        current = next;
      } else {
        units.push(...toUnits(' '));
      }
      continue;
    }
    if (!sameStyle(style, current)) {
      units.push(midRowCode(style));
      current = style;
    }
    units.push(...toUnits(c.ch));
  }
  return separateRepeatedCodes(units);
}

// Splits a word wider than a line into line-sized pieces
function splitToWidth(
  word: StyledChar[],
  width: (s: StyledChar[]) => number,
): StyledChar[][] {
  const pieces: StyledChar[][] = [];
  let piece: StyledChar[] = [];
  for (const ch of word) {
    if (piece.length > 0 && width([...piece, ch]) > Columns) {
      pieces.push(piece);
      piece = [];
    }
    piece.push(ch);
  }
  if (piece.length > 0) {
    pieces.push(piece);
  }
  return pieces;
}

// A space in the style of the text before it
function spaceAfter(line: StyledChar[]): StyledChar {
  const last = line.at(-1) ?? { ...PlainStyle, ch: ' ' };
  return { italic: last.italic, underline: last.underline, ch: ' ' };
}

function words(line: StyledChar[]): StyledChar[][] {
  const out: StyledChar[][] = [[]];
  for (const c of line) {
    if (c.ch === ' ') {
      out.push([]);
    } else {
      out.at(-1)?.push(c);
    }
  }
  return out.filter((word) => word.length > 0);
}

// Splits the cue into captions of at most 2 lines of 32 columns each, keeping
// its italics, underline and top-of-screen placement.
export function layoutCaption(
  text: string,
  options: CaptionLayoutOptions = DefaultCaptionLayout,
): CaptionLayout[] {
  const cue = parseCueText(text);

  // Width in 608 columns: style codes and a background attribute take
  // columns, and transliteration can widen a character ('…' is 3)
  const width = (line: StyledChar[]) =>
    lineUnits(line).length + backgroundColumns(options);
  // The cue's own line breaks are kept when every line fits. Otherwise the
  // whole cue is rewrapped, so a 2-line cue with one long line usually stays
  // one caption instead of becoming 3 lines split over two captions.
  const sourceLines = cue.lines.every((line) => width(line) <= Columns)
    ? cue.lines
    : [
        cue.lines.reduce<StyledChar[]>(
          (joined, line) =>
            joined.length === 0
              ? line
              : [...joined, spaceAfter(joined), ...line],
          [],
        ),
      ];
  const lines: StyledChar[][] = [];
  for (const sourceLine of sourceLines) {
    let line: StyledChar[] = [];
    for (const word of words(sourceLine)) {
      for (const chunk of splitToWidth(word, width)) {
        const candidate = [...line, spaceAfter(line), ...chunk];
        if (line.length === 0) {
          line = chunk;
        } else if (width(candidate) <= Columns) {
          line = candidate;
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

  const captions: CaptionLayout[] = [];
  for (let i = 0; i < lines.length; i += MaxRows) {
    captions.push({ top: cue.top, lines: lines.slice(i, i + MaxRows) });
  }
  return captions;
}

// The column each line starts at
function lineColumns(widths: number[], alignment: CaptionAlignment): number[] {
  switch (alignment) {
    case 'left':
      return widths.map(() => 0);
    case 'centeredLines':
      return widths.map((w) => Math.max(0, Math.floor((Columns - w) / 2)));
    case 'centeredBlock': {
      // Every line starts at the same column, the block centred as nearly as
      // a preamble's 4-column steps allow (no tab offsets to send)
      const widest = Math.max(0, ...widths);
      const indent = Math.min(
        Math.max(0, Math.round((Columns - widest) / 2 / 4) * 4),
        Math.max(0, Math.floor((Columns - widest) / 4) * 4),
      );
      return widths.map(() => indent);
    }
  }
}

// The pairs that load one caption into hidden memory, in atoms: runs of pairs
// that must reach the decoder back to back (a fallback character and the
// extended character that replaces it). Other commands may go between atoms.
//
// Control codes are sent once. Broadcasters send each twice so one survives a
// transmission error; this stream is never damaged in transit, and the second
// copy costs a frame each, which made captions late in fast dialogue.
function loadSequence(
  caption: CaptionLayout,
  options: CaptionLayoutOptions,
): CcPair[][] {
  const atoms: CcPair[][] = [];
  const pushCode = (code: CcPair) => atoms.push([code]);

  pushCode(ResumeCaptionLoading);
  pushCode(EraseNonDisplayedMemory);

  const background =
    options.background === 'player'
      ? undefined
      : BackgroundCodes[options.background];
  const lineUnitList = caption.lines.map(lineUnits);
  const columns = lineColumns(
    lineUnitList.map((units) => units.length + backgroundColumns(options)),
    options.alignment,
  );

  const firstRow = caption.top ? 1 : 15 - caption.lines.length + 1;
  for (const [i, units] of lineUnitList.entries()) {
    // A preamble reaches columns in steps of 4; a Tab Offset (TO1-TO3) the rest
    const column = columns[i] ?? 0;
    const indent = Math.floor(column / 4) * 4;
    pushCode(preambleAddress(firstRow + i, indent));
    if (column > indent) {
      pushCode(pair(0x17, 0x20 + (column - indent)));
    }
    if (background) {
      atoms.push([pair(0x20, 0), background]);
    }

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
  // Where lines sit, and the background behind them
  layout?: CaptionLayoutOptions;
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
  const layout = options.layout ?? DefaultCaptionLayout;
  const slotOf = (ms: number) =>
    Math.round((ms - options.firstFrameMs) / frameMs);
  const lastSlot = slotOf(endMs) - 1;

  // Each cue becomes one or more captions of up to 2 lines, sharing its time
  const captions = cues
    .flatMap((cue) => {
      // A cue too long for one caption is shown in parts, each for a share of
      // the cue's time in proportion to its text
      const parts = layoutCaption(cue.text, layout);
      const lengths = parts.map(
        ({ lines }) =>
          lines.reduce((n, line) => n + line.length, 0) + lines.length - 1,
      );
      const total = Math.max(
        lengths.reduce((a, b) => a + b, 0),
        1,
      );
      let at = cue.startMs;
      return parts.map((caption, i) => {
        const startMs = at;
        at += ((cue.endMs - cue.startMs) * (lengths[i] ?? 0)) / total;
        return { startMs, endMs: at, caption };
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
    const load = loadSequence(caption.caption, layout);
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
