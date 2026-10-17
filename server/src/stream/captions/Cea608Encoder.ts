import type {
  CaptionAlignment,
  CaptionAppearanceSettings,
  CaptionBackgroundColor,
  CaptionMode,
  CaptionTextColor,
} from '@tunarr/types/schemas';
import { CaptionAppearanceSchema } from '@tunarr/types/schemas';

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
  // This cue's own look, over the schedule's (the test pattern sets these)
  appearance?: Partial<CaptionAppearance>;
  // For a cue from an ASS/SSA file: the script's size, which \pos and \move
  // coordinates are in, and its style's alignment as a numpad position
  ass?: AssContext;
};

export type AssContext = {
  playResX: number;
  playResY: number;
  styleAlignment?: number;
};

export type CcPair = readonly [number, number];

// Columns across the screen, and caption rows down it
const Columns = 32;
const Rows = 15;

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
const ResumeDirectCaptioning = pair(0x14, 0x29);
const CarriageReturn = pair(0x14, 0x2d);
const EraseDisplayedMemory = pair(0x14, 0x2c);
const EraseNonDisplayedMemory = pair(0x14, 0x2e);
const EndOfCaption = pair(0x14, 0x2f);

type RollUpMode = 'rollUp2' | 'rollUp3' | 'rollUp4';

// Roll-up with 2, 3 or 4 rows on screen
const RollUp: Record<RollUpMode, { command: CcPair; rows: number }> = {
  rollUp2: { command: pair(0x14, 0x25), rows: 2 },
  rollUp3: { command: pair(0x14, 0x26), rows: 3 },
  rollUp4: { command: pair(0x14, 0x27), rows: 4 },
};

const isRollUp = (mode: CaptionMode): mode is RollUpMode => mode in RollUp;

// How long roll-up text stays up waiting for the next cue to scroll it, as a
// live captioner's does, before the screen is cleared
const RollUpHoldMs = 2000;

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

// The order of 608's colours in its mid-row and background codes
const ColorIndex: Record<CaptionTextColor | 'black', number> = {
  white: 0,
  green: 1,
  blue: 2,
  cyan: 3,
  red: 4,
  yellow: 5,
  magenta: 6,
  black: 7,
};

// The second byte of the mid-row code that draws text in `style` and `color`:
// 0x20 + 2 × the colour, or 0x2e for italics, plus 1 for underline. Italics
// are always white in 608, so italic text loses the colour.
function textAttribute(style: CaptionStyle, color: CaptionTextColor): number {
  return (
    (style.italic ? 0x2e : 0x20 + 2 * ColorIndex[color]) |
    (style.underline ? 1 : 0)
  );
}

// What an indent preamble leaves the text as: white, not underlined
const PreambleAttribute = 0x20;

// Mid-row codes set the style of the text after them, and take a column each
// (shown as a space)
function midRowCode(attribute: number): CharUnit {
  return { kind: 'code', code: pair(0x11, attribute) };
}

// The box behind the text, set once at the start of each line. The code is
// sent after a space: a decoder that knows it backs up over the space, one
// that doesn't shows the space. Either way it takes one column. Undefined for
// the player's own box.
function backgroundUnit(appearance: CaptionAppearance): CharUnit | undefined {
  const color: CaptionBackgroundColor = appearance.backgroundColor;
  if (color === 'player') {
    return;
  }
  const code =
    appearance.backgroundOpacity === 'transparent'
      ? pair(0x17, 0x2d)
      : pair(
          0x10,
          0x20 +
            2 * ColorIndex[color] +
            (appearance.backgroundOpacity === 'semiTransparent' ? 1 : 0),
        );
  return { kind: 'code', code, fallback: 0x20 };
}

// Flash On: the text after it blinks, until the next mid-row code
const FlashOn: CharUnit = { kind: 'code', code: pair(0x14, 0x28) };

// One character of a cue, with the style it is shown in
export type StyledChar = CaptionStyle & { ch: string };

// Where a block of caption lines goes: a band of the screen, and a side or
// the middle across it ('center' follows the alignment setting)
export type CaptionPlacement = {
  vertical: 'top' | 'middle' | 'bottom';
  horizontal: 'left' | 'center' | 'right';
};

const DefaultPlacement: CaptionPlacement = {
  vertical: 'bottom',
  horizontal: 'center',
};

// A block of caption lines as it goes on screen. A caption is one or more
// blocks shown together.
export type CaptionLayout = {
  placement: CaptionPlacement;
  lines: StyledChar[][];
  // A side for each line, where stacked subtitles keep their own; otherwise
  // every line takes the placement's
  lineSides?: CaptionPlacement['horizontal'][];
};

// A cue's text as read: its lines, the first alignment override in it as a
// numpad position (7-9 top, 4-6 middle, 1-3 bottom), and the first \pos (or
// \move's starting point)
type ParsedCue = {
  lines: StyledChar[][];
  alignment?: number;
  position?: { x: number; y: number };
};

// SSA's alignments ({\aN}, and [V4 Styles]): 1-3 at the bottom, +4 at the
// top, +8 in the middle
const LegacyAlignment: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  5: 7,
  6: 8,
  7: 9,
  9: 4,
  10: 5,
  11: 6,
};

// An SSA alignment as a numpad position
export function numpadFromLegacyAlignment(n: number): number | undefined {
  return LegacyAlignment[n];
}

// How captions look: the appearance settings, the alignment setting, and
// flashing text, which only the test pattern sends
export type CaptionAppearance = CaptionAppearanceSettings & {
  alignment: CaptionAlignment;
  flash: boolean;
};

export const DefaultCaptionAppearance: CaptionAppearance = {
  ...CaptionAppearanceSchema.parse({}),
  alignment: 'centeredBlock',
  flash: false,
};

// The defaults, overridden by each layer in turn. A layer's undefined fields
// leave what is below them.
function resolveAppearance(
  ...layers: (Partial<CaptionAppearance> | undefined)[]
): CaptionAppearance {
  const resolved: CaptionAppearance = { ...DefaultCaptionAppearance };
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value !== undefined) {
        Object.assign(resolved, { [key]: value });
      }
    }
  }
  return resolved;
}

// Reads a cue's text into lines of styled characters. Italics and underline
// come from SRT/WebVTT tags (<i>, <u>) and ASS overrides ({\i1}, {\u1}, {\r});
// an alignment override at the top ({\an7}-{\an9}, or SSA's {\a5}-{\a7}) puts
// the cue at the top of the screen. Other formatting is dropped.
function parseCueText(text: string): ParsedCue {
  let style = PlainStyle;
  let alignment: number | undefined;
  let position: ParsedCue['position'];
  // ASS vector drawings ({\p1}...{\p0}) are shapes, not text
  let drawing = false;
  const lines: StyledChar[][] = [[]];
  const current = () => lines.at(-1) ?? [];
  for (const [token] of text.matchAll(
    /\{[^}]*\}|<[^>]*>|\\[Nnh]|\n|[\s\S]/gu,
  )) {
    if (token.length > 1 && token.startsWith('{')) {
      // The first \pos, or where the first \move starts
      const moveOrPos = /\\(?:pos|move)\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(
        token,
      );
      if (moveOrPos && position === undefined) {
        position = { x: Number(moveOrPos[1]), y: Number(moveOrPos[2]) };
      }
      for (const [, tag, value] of token.matchAll(/\\(an|a|i|u|p)(\d+)|\\r/g)) {
        const n = Number(value);
        if (tag === 'p') {
          drawing = n > 0;
        } else if (tag === undefined) {
          // \r resets every override, drawing mode included
          style = PlainStyle;
          drawing = false;
        } else if (tag === 'i') {
          style = { ...style, italic: n !== 0 };
        } else if (tag === 'u') {
          style = { ...style, underline: n !== 0 };
        } else {
          // As in ASS, the first alignment override of a cue is the one used
          alignment ??= tag === 'an' ? n : LegacyAlignment[n];
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
    } else if (drawing) {
      continue;
    } else if (token === '\n' || token === '\\N' || token === '\\n') {
      lines.push([]);
    } else {
      current().push({ ...style, ch: token === '\\h' ? ' ' : token });
    }
  }
  return {
    alignment,
    position,
    lines: lines.map(collapseSpaces).filter((line) => line.length > 0),
  };
}

// The third of the screen a point is in, as a placement
function positionPlacement(
  { x, y }: { x: number; y: number },
  ass: AssContext,
): CaptionPlacement {
  const third = (v: number, size: number) =>
    v < size / 3 ? 0 : v > (2 * size) / 3 ? 2 : 1;
  return {
    vertical:
      (['top', 'middle', 'bottom'] as const)[third(y, ass.playResY)] ??
      'bottom',
    horizontal:
      (['left', 'center', 'right'] as const)[third(x, ass.playResX)] ??
      'center',
  };
}

// A numpad position (7-9 top, 4-6 middle, 1-3 bottom; left, centre, right)
function numpadPlacement(n: number): CaptionPlacement | undefined {
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return;
  }
  const horizontal = (['left', 'center', 'right'] as const)[(n - 1) % 3];
  return {
    vertical: n >= 7 ? 'top' : n >= 4 ? 'middle' : 'bottom',
    horizontal: horizontal ?? 'center',
  };
}

// Where a cue goes, as the subtitle file puts it, first match:
// 1. an ASS \pos or \move: the third of the script's screen its point is in
// 2. its alignment override ({\anN}, {\aN})
// 3. its ASS style's alignment
// 4. the bottom, centred by the alignment setting
// With placement from the file turned off, always the last.
function resolvePlacement(
  cue: ParsedCue,
  appearance: CaptionAppearance,
  ass?: AssContext,
): CaptionPlacement {
  if (!appearance.keepTopPlacement) {
    return DefaultPlacement;
  }
  if (ass && cue.position) {
    return positionPlacement(cue.position, ass);
  }
  const alignment = cue.alignment ?? ass?.styleAlignment;
  return (
    (alignment !== undefined ? numpadPlacement(alignment) : undefined) ??
    DefaultPlacement
  );
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
function lineUnits(
  line: StyledChar[],
  appearance: CaptionAppearance = DefaultCaptionAppearance,
): CharUnit[] {
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

  const attribute = (style: CaptionStyle) =>
    textAttribute(style, appearance.textColor);

  const units: CharUnit[] = [];
  const background = backgroundUnit(appearance);
  if (background) {
    units.push(background);
  }
  let current = PreambleAttribute;
  if (appearance.flash) {
    // Flash goes after any colour code, which would end it
    const first = attribute(styles[0] ?? PlainStyle);
    if (first !== current) {
      units.push(midRowCode(first));
      current = first;
    }
    units.push(FlashOn);
  }
  for (const [k, c] of line.entries()) {
    const style = attribute(styles[k] ?? PlainStyle);
    if (c.ch === ' ') {
      const next = styles[k + 1];
      if (next && attribute(next) !== current) {
        current = attribute(next);
        units.push(midRowCode(current));
      } else {
        units.push(...toUnits(' '));
      }
      continue;
    }
    if (style !== current) {
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
  maxWidth: number,
): StyledChar[][] {
  const pieces: StyledChar[][] = [];
  let piece: StyledChar[] = [];
  for (const ch of word) {
    if (piece.length > 0 && width([...piece, ch]) > maxWidth) {
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

// The cue's text as the appearance has it shown: without the file's styles
// when those are turned off, and in capitals when asked
function applyTextOptions(
  lines: StyledChar[][],
  appearance: CaptionAppearance,
): StyledChar[][] {
  return lines.map((line) =>
    line.flatMap((c) => {
      const style = appearance.keepStyles ? c : PlainStyle;
      // Some letters become two in capitals ('ß' is 'SS')
      const chars = appearance.upperCase ? [...c.ch.toUpperCase()] : [c.ch];
      return chars.map((ch) => ({
        italic: style.italic,
        underline: style.underline,
        ch,
      }));
    }),
  );
}

// Splits the cue into captions of at most `maxLines` lines of `lineWidth`
// columns each (2 of 32 by default), keeping its italics, underline and
// top-of-screen placement.
export function layoutCaption(
  text: string,
  appearance: CaptionAppearance = DefaultCaptionAppearance,
  ass?: AssContext,
): CaptionLayout[] {
  const parsed = parseCueText(text);
  const placement = resolvePlacement(parsed, appearance, ass);
  const cueLines = applyTextOptions(parsed.lines, appearance);
  const maxWidth = appearance.lineWidth;

  // Width in 608 columns: style and background codes take columns, and
  // transliteration can widen a character ('…' is 3)
  const width = (line: StyledChar[]) => lineUnits(line, appearance).length;
  // The cue's own line breaks are kept when every line fits. Otherwise the
  // whole cue is rewrapped, so a 2-line cue with one long line usually stays
  // one caption instead of becoming 3 lines split over two captions.
  const sourceLines = cueLines.every((line) => width(line) <= maxWidth)
    ? cueLines
    : [
        cueLines.reduce<StyledChar[]>(
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
      for (const chunk of splitToWidth(word, width, maxWidth)) {
        const candidate = [...line, spaceAfter(line), ...chunk];
        if (line.length === 0) {
          line = chunk;
        } else if (width(candidate) <= maxWidth) {
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
  for (let i = 0; i < lines.length; i += appearance.maxLines) {
    captions.push({
      placement,
      lines: lines.slice(i, i + appearance.maxLines),
    });
  }
  return captions;
}

// The row a block's first line goes on: ending on the bottom row, starting on
// the top row for a block placed at the top, or centred between the two for
// one in the middle. Always on screen.
function firstRow(block: CaptionLayout, appearance: CaptionAppearance): number {
  const lines = block.lines.length;
  const wanted = {
    top: appearance.topRow,
    middle: Math.floor(
      (appearance.topRow + appearance.bottomRow + 1 - lines) / 2,
    ),
    bottom: appearance.bottomRow - lines + 1,
  }[block.placement.vertical];
  return Math.min(Math.max(wanted, 1), Rows + 1 - lines);
}

// The column each line starts at: at the left edge or ending at the right one
// for a block placed at a side, otherwise by the alignment setting
function lineColumns(
  widths: number[],
  alignment: CaptionAlignment,
  horizontal: CaptionPlacement['horizontal'] = 'center',
): number[] {
  if (horizontal === 'right') {
    return widths.map((w) => Math.max(0, Columns - w));
  }
  switch (horizontal === 'left' ? 'left' : alignment) {
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

// The pairs that draw one line, in atoms: runs of pairs that must reach the
// decoder back to back (a fallback character and the extended character that
// replaces it). Other commands may go between atoms.
//
// Control codes are sent once. Broadcasters send each twice so one survives a
// transmission error; this stream is never damaged in transit, and the second
// copy costs a frame each, which made captions late in fast dialogue.
function lineAtoms(units: CharUnit[], row: number, column: number): CcPair[][] {
  const atoms: CcPair[][] = [];
  const pushCode = (code: CcPair) => atoms.push([code]);

  // A preamble reaches columns in steps of 4; a Tab Offset (TO1-TO3) the rest
  const indent = Math.floor(column / 4) * 4;
  pushCode(preambleAddress(row, indent));
  if (column > indent) {
    pushCode(pair(0x17, 0x20 + (column - indent)));
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
  return atoms;
}

// A caption's lines on their rows and columns, block by block
function captionLines(
  blocks: readonly CaptionLayout[],
  appearance: CaptionAppearance,
) {
  return blocks.flatMap((block) => {
    const lineUnitList = block.lines.map((line) => lineUnits(line, appearance));
    // Lines on each side are aligned among themselves
    const widths = lineUnitList.map((units) => units.length);
    const sides = sidesOf(block);
    const columns: number[] = [];
    for (const side of new Set(sides)) {
      const indices = sides.flatMap((s, i) => (s === side ? [i] : []));
      const sideColumns = lineColumns(
        indices.map((i) => widths[i] ?? 0),
        appearance.alignment,
        side,
      );
      indices.forEach((lineIndex, k) => {
        columns[lineIndex] = sideColumns[k] ?? 0;
      });
    }
    const row = firstRow(block, appearance);
    return lineUnitList.map((units, i) => ({
      units,
      row: row + i,
      column: columns[i] ?? 0,
    }));
  });
}

// Pop-on: the pairs that load one caption into hidden memory
function loadSequence(
  blocks: readonly CaptionLayout[],
  appearance: CaptionAppearance,
): CcPair[][] {
  return groupedLoadSequence(blocks, appearance).atoms;
}

// The load's atoms, and for each the line it draws when that line sets a box
// colour (undefined otherwise). FFmpeg's decoder turns the box back to black
// on Erase Displayed Memory (ccaption_dec.c handle_edm: bg_color =
// CCCOL_BLACK) and colours each character with the box current when it
// arrives, so such a line has to load wholly before or wholly after one; the
// scheduler keeps each group on one side.
function groupedLoadSequence(
  blocks: readonly CaptionLayout[],
  appearance: CaptionAppearance,
): { atoms: CcPair[][]; groups: (number | undefined)[] } {
  const box = backgroundUnit(appearance) !== undefined;
  const atoms: CcPair[][] = [[ResumeCaptionLoading], [EraseNonDisplayedMemory]];
  const groups: (number | undefined)[] = [undefined, undefined];
  for (const [line, { units, row, column }] of captionLines(
    blocks,
    appearance,
  ).entries()) {
    for (const atom of lineAtoms(units, row, column)) {
      atoms.push(atom);
      groups.push(box ? line : undefined);
    }
  }
  return { atoms, groups };
}

// Consecutive atoms in the same group form one segment, placed as a whole;
// every other atom is a segment of its own
type Segment = { atoms: CcPair[][]; grouped: boolean };

function segmentsOf(
  atoms: CcPair[][],
  groups?: readonly (number | undefined)[],
): Segment[] {
  const segments: Segment[] = [];
  let previous: number | undefined;
  for (const [i, atom] of atoms.entries()) {
    const group = groups?.[i];
    const last = segments.at(-1);
    if (group !== undefined && group === previous && last) {
      last.atoms.push(atom);
    } else {
      segments.push({ atoms: [atom], grouped: group !== undefined });
    }
    previous = group;
  }
  return segments;
}

/**
 * How many frames of caption data a cue needs before it can show: for
 * pop-on, its first caption's whole load; for paint-on and roll-up, the
 * commands that set the mode.
 */
export function captionLoadFrames(
  text: string,
  appearance: Partial<CaptionAppearance> = {},
): number {
  const resolved = resolveAppearance(appearance);
  if (resolved.mode !== 'popOn') {
    return 2;
  }
  const [first] = layoutCaption(text, resolved);
  return first ? loadSequence([first], resolved).flat().length : 0;
}

// Roll-up: each line is drawn on the base row after a carriage return, which
// moves the lines above it up one row
function rollUpLines(
  block: CaptionLayout,
  appearance: CaptionAppearance,
  rows: number,
): CcPair[][][] {
  const baseRow = Math.min(Math.max(appearance.bottomRow, rows), Rows);
  // Aligned as a block, as a pop-on caption's lines are
  const lineUnitList = block.lines.map((line) => lineUnits(line, appearance));
  const columns = lineColumns(
    lineUnitList.map((units) => units.length),
    appearance.alignment,
  );
  return lineUnitList.map((units, i) => [
    [CarriageReturn],
    ...lineAtoms(units, baseRow, columns[i] ?? 0),
  ]);
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

// One caption of a schedule: its blocks, shown from startMs to endMs
type ScheduleItem = {
  startMs: number;
  endMs: number;
  blocks: CaptionLayout[];
  appearance: CaptionAppearance;
};

// Overlapping subtitles: each change to what is on screen is a new pop-on
// caption, which takes up to a few seconds to load (two characters a frame),
// so changes are kept at least this far apart
const MinOverlapMs = 500;
const MinIntervalMs = 1000;
// The shortest rest of a subtitle that began earlier worth showing on its own:
// one that outlasts a newer one comes back for it, and a cue already under way
// when a stream starts (a viewer tuning in) shows it. Less would flash up and
// vanish before it could be read.
const MinTailMs = 1000;
// Lines of overlapping subtitles stacked in one block, the newest kept
const MaxStackedLines = 4;

// How many frames a pop-on caption takes to load
function loadFrames(
  blocks: readonly CaptionLayout[],
  appearance: CaptionAppearance,
): number {
  return loadSequence(blocks, appearance).flat().length;
}

/**
 * Pop-on captions of subtitles that overlap in time, as the overlap setting
 * has them. Pop-on shows one caption at a time, so without this the later
 * subtitle replaced the earlier, which never came back.
 *
 * - together: while they overlap by more than MinOverlapMs, they share one
 *   block, older lines above newer. Where their places differ (a sign at the
 *   top over dialogue), the block goes at the bottom: decoders of FFmpeg's
 *   family position only a caption's first row.
 * - apart: as together, but each band of the screen (top, middle, bottom)
 *   gets its own block, for decoders that position every row.
 * - newest: the latest-started subtitle shows; one that outlasts a newer one
 *   comes back for the rest of its time, when that is at least MinTailMs
 *   and leaves the next caption time to load.
 *
 * Paint-on and roll-up draw as text arrives, and are left as they are. Input
 * with no overlaps comes back as the same array.
 */
function resolveOverlaps(
  items: ScheduleItem[],
  frameMs: number,
): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  let changed = false;
  const taken = new Set<ScheduleItem>();
  for (const [i, first] of items.entries()) {
    if (taken.has(first)) {
      continue;
    }
    taken.add(first);
    const policy = first.appearance.overlappingCues;
    const minOverlap = policy === 'newest' ? 0 : MinOverlapMs;
    const cluster = [first];
    let clusterEnd = first.endMs;
    let after: ScheduleItem | undefined;
    // Later subtitles that start while the cluster is up join it when they
    // overlap it long enough. One that doesn't (a short overlap) stays on its
    // own, and the scan goes on past it.
    for (const next of items.slice(i + 1)) {
      if (next.startMs >= clusterEnd) {
        after ??= next;
        break;
      }
      // How long it overlaps the cluster: to the earlier of its own end and
      // the cluster's
      const overlap = Math.min(clusterEnd, next.endMs) - next.startMs;
      if (
        first.appearance.mode === 'popOn' &&
        !taken.has(next) &&
        next.appearance.mode === 'popOn' &&
        next.appearance.overlappingCues === policy &&
        overlap > minOverlap
      ) {
        cluster.push(next);
        taken.add(next);
        clusterEnd = Math.max(clusterEnd, next.endMs);
      } else {
        after ??= next;
      }
    }
    const resolved =
      cluster.length === 1
        ? cluster
        : policy === 'newest'
          ? newestOf(cluster, frameMs, after)
          : stackedOf(cluster, policy === 'apart');
    changed ||= resolved !== cluster;
    out.push(...resolved);
  }
  // Subtitles left out of a cluster can start inside it, so back in order
  return changed ? out.sort((a, b) => a.startMs - b.startMs) : items;
}

// The stretches of a cluster with the same subtitles on screen, in order;
// each subtitle in its order of start (ties: file order)
function activeIntervals(cluster: ScheduleItem[]) {
  const times = [
    ...new Set(cluster.flatMap((item) => [item.startMs, item.endMs])),
  ].sort((a, b) => a - b);
  const intervals: {
    startMs: number;
    endMs: number;
    active: ScheduleItem[];
  }[] = [];
  for (const [k, startMs] of times.slice(0, -1).entries()) {
    const endMs = times[k + 1] ?? startMs;
    const active = cluster.filter(
      (item) => item.startMs <= startMs && startMs < item.endMs,
    );
    if (active.length > 0) {
      intervals.push({ startMs, endMs, active });
    }
  }
  return intervals;
}

function stackedOf(cluster: ScheduleItem[], apart: boolean): ScheduleItem[] {
  // A stretch too short to load a caption for goes with a neighbour that
  // shows everything it shows (the one before, else the one after), so a
  // subtitle is shown a little longer or sooner, never left out. Then
  // neighbours that show the same merge.
  const intervals = activeIntervals(cluster).map((i) => ({ ...i }));
  const shows = (
    outer: (typeof intervals)[number] | undefined,
    inner: (typeof intervals)[number],
  ) =>
    outer !== undefined &&
    inner.active.every((item) => outer.active.includes(item));
  const folded: typeof intervals = [];
  for (const [k, interval] of intervals.entries()) {
    const previous = folded.at(-1);
    const next = intervals[k + 1];
    const short = interval.endMs - interval.startMs < MinIntervalMs;
    if (short && previous && shows(previous, interval)) {
      previous.endMs = interval.endMs;
    } else if (short && next && shows(next, interval)) {
      next.startMs = interval.startMs;
    } else {
      folded.push(interval);
    }
  }
  const merged: typeof intervals = [];
  for (const interval of folded) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.active.length === interval.active.length &&
      previous.active.every((item, k) => item === interval.active[k])
    ) {
      previous.endMs = interval.endMs;
    } else {
      merged.push(interval);
    }
  }

  return merged.map(({ startMs, endMs, active }) => {
    const newest = active.at(-1) ?? cluster[0];
    const appearance = newest?.appearance ?? DefaultCaptionAppearance;
    const together = stackBlock(active.flatMap((item) => item.blocks));
    let blocks = [together];
    if (apart) {
      const bands = (['top', 'middle', 'bottom'] as const)
        .map((vertical) =>
          active
            .flatMap((item) => item.blocks)
            .filter((b) => b.placement.vertical === vertical),
        )
        .filter((band) => band.length > 0)
        .map(stackBlock);
      // Bands that would share rows go together after all
      const rows = bands.map((block) => {
        const row = firstRow(block, appearance);
        return [row, row + block.lines.length - 1] as const;
      });
      const clear = rows.every(([, last], k) => {
        const next = rows[k + 1];
        return !next || last < next[0];
      });
      if (clear) {
        blocks = bands;
      }
    }
    return { startMs, endMs, blocks, appearance };
  });
}

// Blocks stacked into one: their lines in order (the newest kept when there
// are too many), placed where they all agree, else at the bottom and centred
function stackBlock(blocks: readonly CaptionLayout[]): CaptionLayout {
  const agreed = <K extends keyof CaptionPlacement>(key: K) => {
    const first = blocks[0]?.placement[key];
    return blocks.every((b) => b.placement[key] === first) ? first : undefined;
  };
  const horizontal = agreed('horizontal');
  const lines = blocks.flatMap((b) => b.lines);
  // Where their sides differ, each line keeps its own: decoders of FFmpeg's
  // family keep each row's indent even within one caption
  const lineSides = blocks.flatMap((b) => sidesOf(b));
  return {
    placement: {
      vertical: agreed('vertical') ?? 'bottom',
      horizontal: horizontal ?? 'center',
    },
    lines: lines.slice(-MaxStackedLines),
    ...(horizontal === undefined
      ? { lineSides: lineSides.slice(-MaxStackedLines) }
      : {}),
  };
}

// The side each of a block's lines goes on
function sidesOf(block: CaptionLayout): CaptionPlacement['horizontal'][] {
  return block.lines.map(
    (_, i) => block.lineSides?.[i] ?? block.placement.horizontal,
  );
}

function newestOf(
  cluster: ScheduleItem[],
  frameMs: number,
  after: ScheduleItem | undefined,
): ScheduleItem[] {
  // The newest subtitle on screen in each stretch, joined into segments
  const segments: { startMs: number; endMs: number; item: ScheduleItem }[] = [];
  for (const { startMs, endMs, active } of activeIntervals(cluster)) {
    const item = active.at(-1);
    if (!item) {
      continue;
    }
    const last = segments.at(-1);
    if (last && last.item === item && last.endMs === startMs) {
      last.endMs = endMs;
    } else {
      segments.push({ startMs, endMs, item });
    }
  }

  const shown = new Set<ScheduleItem>();
  const out: ScheduleItem[] = [];
  for (const [k, segment] of segments.entries()) {
    if (!shown.has(segment.item)) {
      // Its first showing: the subtitle itself, with its own end, so it is
      // still cleared then if the one replacing it is left out. One that
      // starts with a newer one shows only once that one ends.
      shown.add(segment.item);
      out.push(
        segment.startMs === segment.item.startMs
          ? segment.item
          : { ...segment.item, startMs: segment.startMs },
      );
      continue;
    }
    // A comeback, when long enough, and when the next caption can still load
    // while it shows
    const next = segments[k + 1]?.item ?? after;
    const nextStart = segments[k + 1]?.startMs ?? after?.startMs;
    const roomForNext =
      next === undefined ||
      nextStart === undefined ||
      nextStart - segment.startMs >=
        (loadFrames(next.blocks, next.appearance) + 2) * frameMs;
    if (segment.endMs - segment.startMs >= MinTailMs && roomForNext) {
      out.push({
        ...segment.item,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    }
  }
  // Unchanged when every subtitle showed once and nothing came back
  return out.length === cluster.length &&
    out.every((item, k) => item === cluster[k])
    ? cluster
    : out;
}

export type CaptionScheduleOptions = {
  // Time of the first video frame this schedule covers, on the same clock as the cues
  firstFrameMs: number;
  frameRate: number;
  // No caption data is placed at or after this time
  endMs?: number;
  // How the captions look; a cue's own appearance overrides it
  appearance?: Partial<CaptionAppearance>;
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

  // Each cue becomes one or more captions, sharing its time
  const parts: ScheduleItem[] = cues
    .flatMap((cue) => {
      const appearance = resolveAppearance(options.appearance, cue.appearance);
      // A cue too long for one caption is shown in parts, each for a share of
      // the cue's time in proportion to its text. Roll-up scrolls a cue's
      // lines up one by one at the bottom, so its cue stays whole.
      const parts = isRollUp(appearance.mode)
        ? layoutCaption(cue.text, {
            ...appearance,
            maxLines: Number.MAX_SAFE_INTEGER,
            keepTopPlacement: false,
          })
        : layoutCaption(cue.text, appearance, cue.ass);
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
        return { startMs, endMs: at, blocks: [caption], appearance };
      });
    })
    .filter((c) => c.endMs > options.firstFrameMs && c.startMs < endMs)
    .sort((a, b) => a.startMs - b.startMs);
  const captions = resolveOverlaps(parts, frameMs);

  const pairs = new Map<number, CcPair>();
  // The slots of Erase Displayed Memory: a line with a box colour must not
  // load across one (groupedLoadSequence)
  const clears = new Set<number>();
  const take = (slot: number, p: CcPair) => {
    if (slot >= 0 && slot <= lastSlot) {
      pairs.set(slot, p);
      if (p === EraseDisplayedMemory) {
        clears.add(slot);
      } else {
        clears.delete(slot);
      }
    }
  };
  // The last clear strictly between two slots, if any
  const clearBetween = (first: number, last: number) => {
    let found: number | undefined;
    for (const slot of clears) {
      if (
        slot > first &&
        slot < last &&
        (found === undefined || slot > found)
      ) {
        found = slot;
      }
    }
    return found;
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
  // Atoms in one of `groups` stay on one side of every clear: a group that
  // would load across one is moved before it.
  const placeBefore = (
    atoms: CcPair[][],
    endSlot: number,
    minSlot: number,
    {
      dryRun = false,
      groups,
    }: { dryRun?: boolean; groups?: readonly (number | undefined)[] } = {},
  ) => {
    const placed: [number, CcPair[]][] = [];
    let limit = endSlot - 1;
    for (const segment of segmentsOf(atoms, groups).toReversed()) {
      let segmentLimit = limit;
      for (;;) {
        const tried: [number, CcPair[]][] = [];
        let next = segmentLimit;
        for (const atom of segment.atoms.toReversed()) {
          let slot = next - atom.length + 1;
          while (slot >= minSlot && !isFreeRun(slot, atom.length)) {
            slot--;
          }
          if (slot < minSlot) {
            return false;
          }
          tried.push([slot, atom]);
          next = slot - 1;
        }
        const clear = segment.grouped
          ? clearBetween(next + 1, segmentLimit)
          : undefined;
        if (clear === undefined) {
          placed.push(...tried);
          limit = next;
          break;
        }
        segmentLimit = clear - 1;
      }
    }
    if (!dryRun) {
      for (const [slot, atom] of placed) {
        atom.forEach((p, k) => take(slot + k, p));
      }
    }
    return true;
  };
  // Loads the atoms as early as possible from `startSlot`; returns the slot
  // after the last. With `dryRun`, only finds that slot. Atoms that would
  // reach `until` are left out, with those after them. Atoms in one of
  // `groups` stay on one side of every clear: a group that would load across
  // one is moved after it.
  const placeFrom = (
    atoms: CcPair[][],
    startSlot: number,
    {
      dryRun = false,
      until = Number.POSITIVE_INFINITY,
      groups,
    }: {
      dryRun?: boolean;
      until?: number;
      groups?: readonly (number | undefined)[];
    } = {},
  ) => {
    let slot = startSlot;
    for (const segment of segmentsOf(atoms, groups)) {
      let from = slot;
      let tried: [number, CcPair[]][] = [];
      let end = from;
      for (;;) {
        tried = [];
        let at = from;
        for (const atom of segment.atoms) {
          while (!isFreeRun(at, atom.length)) {
            at++;
          }
          tried.push([at, atom]);
          at += atom.length;
        }
        end = at;
        const clear = segment.grouped
          ? clearBetween(tried[0]?.[0] ?? from, end - 1)
          : undefined;
        if (clear === undefined) {
          break;
        }
        from = clear + 1;
      }
      if (end > until) {
        break;
      }
      if (!dryRun) {
        for (const [at, atom] of tried) {
          atom.forEach((p, k) => take(at + k, p));
        }
      }
      slot = end;
    }
    return slot;
  };
  const firstFreeFrom = (slot: number) => {
    let free = slot;
    while (!isFree(free)) {
      free++;
    }
    return free;
  };
  const clearFrom = (slot: number) =>
    take(firstFreeFrom(slot), EraseDisplayedMemory);

  // The next caption's pairs go after this slot: pop-on's hidden memory can
  // only be reloaded once the previous caption is on screen, and paint-on and
  // roll-up text must all arrive before the mode changes
  let loadAfter = 0;
  // Where the caption on screen ends, when it was left up for the next one to
  // replace
  let replacedAt: number | undefined;
  // The mode this schedule last put the decoder in
  let screenMode: CaptionMode | undefined;
  const rollUpHoldSlots = Math.round(RollUpHoldMs / frameMs);

  // A caption that can't be shown before it ends is left out, rather than
  // flashed for a frame. A cue nearly over when a viewer tunes in is one: its
  // pairs would also hold up the next caption. The caption on screen, left up
  // for it to replace, is cleared at its own end instead.
  const leaveOut = () => {
    if (replacedAt !== undefined) {
      clearFrom(replacedAt);
      replacedAt = undefined;
    }
  };
  // Whether a caption first on screen at `shownAt` is left out: it can't show
  // before it ends, or it was already under way at the first frame and less
  // than MinTailMs of it is left, the end of a line flashing up and gone. What
  // is left ends with the schedule if that comes first (a program ending).
  // The next caption is then the first one shown.
  const tooLateToShow = (caption: ScheduleItem, shownAt: number) =>
    shownAt >= slotOf(caption.endMs) ||
    (caption.startMs < options.firstFrameMs &&
      (slotOf(Math.min(caption.endMs, endMs)) - shownAt) * frameMs < MinTailMs);

  for (const [i, caption] of captions.entries()) {
    const { appearance } = caption;
    const mode = appearance.mode;
    const wanted = Math.max(slotOf(caption.startMs), 0);
    // The slot after the caption's last pair
    let doneAt: number;

    if (mode === 'popOn') {
      // Show it on its start frame, or as soon as loading finishes when there
      // isn't room before it (a short gap, or a cue already under way).
      // Lines with a box colour load clear of the previous caption's clear
      // (groupedLoadSequence), but only where that doesn't move the frame
      // the caption shows on: a later caption holds up the next one's load,
      // which could then miss its own time and be left out.
      const { atoms: load, groups: lineGroups } = groupedLoadSequence(
        caption.blocks,
        appearance,
      );
      const boxed = lineGroups.some((g) => g !== undefined);
      let showAt = wanted;
      if (
        boxed &&
        placeBefore(load, wanted, loadAfter, { groups: lineGroups })
      ) {
        // On time, each boxed line on one side of any clear
      } else if (!placeBefore(load, wanted, loadAfter)) {
        const lateShow = (groups?: (number | undefined)[]) =>
          firstFreeFrom(
            Math.max(
              wanted,
              placeFrom(load, loadAfter, { dryRun: true, groups }),
            ),
          );
        showAt = lateShow();
        if (tooLateToShow(caption, showAt)) {
          leaveOut();
          continue;
        }
        placeFrom(load, loadAfter, {
          groups:
            boxed && lateShow(lineGroups) === showAt ? lineGroups : undefined,
        });
      }
      showAt = firstFreeFrom(showAt);
      take(showAt, EndOfCaption);
      doneAt = showAt + 1;
    } else {
      // Paint-on and roll-up draw on screen as the text arrives, from the
      // cue's start frame. The mode is set beforehand. On the start frame,
      // paint-on erases the screen and roll-up sends its first carriage
      // return; FFmpeg's decoder times the caption from that command.
      const entry: CcPair[][] =
        mode === 'paintOn'
          ? [[ResumeDirectCaptioning]]
          : screenMode === mode
            ? []
            : // A roll-up command keeps what is on screen, so clear it first
              [[EraseDisplayedMemory], [RollUp[mode].command]];
      const entryFits = placeBefore(entry, wanted, loadAfter, {
        dryRun: true,
      });
      const startAt = firstFreeFrom(
        entryFits
          ? wanted
          : Math.max(wanted, placeFrom(entry, loadAfter, { dryRun: true })),
      );
      // Roll-up keeps a cue's lines up, scrolling, while the next cue's arrive,
      // so the rest of one under way is no flash: it stays as context
      if (
        mode === 'paintOn'
          ? tooLateToShow(caption, startAt)
          : startAt >= slotOf(caption.endMs)
      ) {
        leaveOut();
        continue;
      }
      if (entryFits) {
        placeBefore(entry, wanted, loadAfter);
      } else {
        placeFrom(entry, loadAfter);
      }

      // Text drawn on screen can only be sent while the cue lasts, at two
      // characters a frame. What doesn't fit is cut off, rather than keeping
      // the caption up past its end and holding up the next one.
      const until = slotOf(caption.endMs);
      if (mode === 'paintOn') {
        take(startAt, EraseDisplayedMemory);
        doneAt = placeFrom(
          captionLines(caption.blocks, appearance).flatMap(
            ({ units, row, column }) => lineAtoms(units, row, column),
          ),
          startAt + 1,
          { until },
        );
      } else {
        const [first = [], ...rest] = rollUpLines(
          caption.blocks[0] ?? { placement: DefaultPlacement, lines: [] },
          appearance,
          RollUp[mode].rows,
        );
        // The first line's carriage return on the start frame, the rest after
        take(startAt, CarriageReturn);
        doneAt = placeFrom([...first.slice(1), ...rest.flat()], startAt + 1, {
          until,
        });
      }
    }
    screenMode = mode;
    loadAfter = doneAt;

    // Clear the screen at the end, unless the next caption, in the same mode,
    // replaces it right away (roll-up: scrolls it up within the hold)
    const next = captions[i + 1];
    const endSlot = Math.max(slotOf(caption.endMs), doneAt);
    const nextSlot = next ? slotOf(next.startMs) : undefined;
    const replacedBy =
      next?.appearance.mode === mode &&
      nextSlot !== undefined &&
      nextSlot <= endSlot + (isRollUp(mode) ? rollUpHoldSlots : 1);
    if (replacedBy) {
      replacedAt = endSlot;
    } else {
      // Before a caption in another mode starts, if it starts first
      clearFrom(
        nextSlot !== undefined && next?.appearance.mode !== mode
          ? Math.min(endSlot, nextSlot)
          : endSlot,
      );
      replacedAt = undefined;
    }
  }

  return new CaptionSchedule(options.firstFrameMs, frameMs, pairs);
}
