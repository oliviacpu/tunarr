// A small CEA-608 decoder for tests: what a viewer's screen shows, frame by
// frame. It follows the commands Tunarr's encoder sends (pop-on, paint-on and
// roll-up, preamble addresses, tab offsets, mid-row and background codes,
// flash) closely enough to check them, and labels the attribute codes in the
// text instead of drawing them:
//
// - mid-row codes: [white], [red u] (underlined), [i] (italics, which 608
//   shows white), [iu]
// - background codes: [bg blue], [bg blue semi], [bg transparent]. They take
//   no column; the space sent before one does.
// - flash: [flash]
//
// Like FFmpeg's decoder (and Plex's, from the same family), it skips a control
// code identical to the control code before it.

export type DecodedRow = {
  row: number;
  column: number;
  width: number;
  text: string;
};

export type Screen = {
  // The first frame it is shown on
  fromFrame: number;
  rows: DecodedRow[];
};

// Preamble address codes per row (first byte, second byte without indent bits)
const PacRows = [
  [0x11, 0x40],
  [0x11, 0x60],
  [0x12, 0x40],
  [0x12, 0x60],
  [0x15, 0x40],
  [0x15, 0x60],
  [0x16, 0x40],
  [0x16, 0x60],
  [0x17, 0x40],
  [0x17, 0x60],
  [0x10, 0x40],
  [0x13, 0x40],
  [0x13, 0x60],
  [0x14, 0x40],
  [0x14, 0x60],
];

const Colors = [
  'white',
  'green',
  'blue',
  'cyan',
  'red',
  'yellow',
  'magenta',
  'black',
];

function midRowLabel(b: number): string {
  const underline = b & 1 ? 'u' : '';
  if (b >= 0x2e) {
    return `[i${underline}]`;
  }
  const color = Colors[(b - 0x20) >> 1] ?? '?';
  return `[${color}${underline ? ' u' : ''}]`;
}

type Memory = Map<number, DecodedRow>;

const snapshot = (memory: Memory): DecodedRow[] =>
  [...memory.values()].map((row) => ({ ...row })).sort((a, b) => a.row - b.row);

/**
 * The screens a viewer sees: one entry each time the displayed caption
 * changes, from the frame it changes on. `pairs` are the frames' byte pairs,
 * with or without parity.
 */
export function decodeScreens(pairs: readonly (readonly number[])[]): Screen[] {
  let displayed: Memory = new Map();
  let hidden: Memory = new Map();
  let mode: 'popOn' | 'paintOn' | 'rollUp' = 'popOn';
  let rollUpRows = 2;
  let cursor: DecodedRow | undefined;
  let lastControl: string | undefined;
  const screens: Screen[] = [];

  const target = () => (mode === 'popOn' ? hidden : displayed);
  const changed = (frame: number) => {
    const rows = snapshot(displayed);
    const last = screens.at(-1);
    if (!last || JSON.stringify(last.rows) !== JSON.stringify(rows)) {
      screens.push({ fromFrame: frame, rows });
    }
  };
  const write = (frame: number, text: string, columns: number) => {
    if (!cursor) {
      return;
    }
    cursor.text += text;
    cursor.width += columns;
    if (mode !== 'popOn') {
      changed(frame);
    }
  };

  for (const [frame, [rawA = 0, rawB = 0]] of pairs.entries()) {
    const a = rawA & 0x7f;
    const b = rawB & 0x7f;
    if (a === 0 && b === 0) {
      continue;
    }
    if (a >= 0x10 && a <= 0x1f) {
      const key = `${a},${b}`;
      if (key === lastControl) {
        continue;
      }
      lastControl = key;
    } else {
      lastControl = undefined;
    }

    if (a === 0x14 && b === 0x20) {
      mode = 'popOn';
    } else if (a === 0x14 && b === 0x29) {
      mode = 'paintOn';
    } else if (a === 0x14 && b >= 0x25 && b <= 0x27) {
      mode = 'rollUp';
      rollUpRows = b - 0x23;
    } else if (a === 0x14 && b === 0x2c) {
      displayed = new Map();
      cursor = mode === 'popOn' ? cursor : undefined;
      changed(frame);
    } else if (a === 0x14 && b === 0x2e) {
      hidden = new Map();
    } else if (a === 0x14 && b === 0x2f) {
      [displayed, hidden] = [hidden, displayed];
      changed(frame);
    } else if (a === 0x14 && b === 0x2d) {
      // Carriage return: in roll-up, the rows in the window move up one
      if (mode === 'rollUp' && cursor) {
        const base = cursor.row;
        const moved: Memory = new Map();
        for (const [row, content] of displayed) {
          if (row > base - rollUpRows + 1 && row <= base) {
            moved.set(row - 1, { ...content, row: row - 1 });
          }
        }
        displayed = moved;
        cursor = undefined;
        changed(frame);
      }
    } else if (a === 0x14 && b === 0x28) {
      write(frame, '[flash]', 1);
    } else if (a >= 0x10 && a <= 0x17 && b >= 0x40) {
      const index = PacRows.findIndex(
        ([first, second]) => first === a && second === (b & 0x60),
      );
      const row: DecodedRow = {
        row: index + 1,
        column: b & 0x10 ? ((b & 0x0e) >> 1) * 4 : 0,
        width: 0,
        text: '',
      };
      target().set(row.row, row);
      cursor = row;
    } else if (a === 0x17 && b >= 0x21 && b <= 0x23) {
      if (cursor) {
        cursor.column += b - 0x20;
      }
    } else if (a === 0x10 && b >= 0x20 && b <= 0x2f) {
      const color = Colors[(b - 0x20) >> 1] ?? '?';
      write(frame, `[bg ${color}${b & 1 ? ' semi' : ''}]`, 0);
    } else if (a === 0x17 && b === 0x2d) {
      write(frame, '[bg transparent]', 0);
    } else if (a === 0x11 && b >= 0x20 && b <= 0x2f) {
      write(frame, midRowLabel(b), 1);
    } else if (a === 0x11 && b === 0x37) {
      write(frame, '♪', 1);
    } else if (a >= 0x20) {
      for (const byte of [a, b].filter((x) => x >= 0x20)) {
        write(frame, String.fromCharCode(byte), 1);
      }
    }
  }
  return screens;
}

// What the screen shows on `frame`
export function screenAt(screens: Screen[], frame: number): DecodedRow[] {
  return screens.findLast((s) => s.fromFrame <= frame)?.rows ?? [];
}
