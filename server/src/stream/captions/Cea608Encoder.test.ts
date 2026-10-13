import type {
  CaptionLayout,
  CaptionLayoutOptions,
  CcPair,
} from './Cea608Encoder.ts';
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
  layout?: CaptionLayoutOptions,
) {
  const schedule = buildCaptionSchedule(cues, {
    firstFrameMs,
    frameRate: FrameRate,
    layout,
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

// Each caption's lines as plain text
const texts = (captions: CaptionLayout[]) =>
  captions.map((caption) =>
    caption.lines.map((line) => line.map((c) => c.ch).join('')),
  );

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
const MidRowLabels: Record<number, string> = {
  0x20: '[-]',
  0x21: '[u]',
  0x2e: '[i]',
  0x2f: '[iu]',
};

type DecodedRow = { row: number; column: number; width: number; text: string };

// A small 608 decoder for the tests: each caption shown (up to its End of
// Caption), as rows with their start column, width in columns, and text. Style
// changes show as [i] italics, [u] underline, [iu] both, [-] plain;
// background attributes as [bg:semi] and [bg:transparent].
function decodeCaptions(pairs: number[][]): DecodedRow[][] {
  const captions: DecodedRow[][] = [];
  let rows: DecodedRow[] = [];
  let row: DecodedRow | undefined;
  const add = (text: string, columns: number) => {
    if (row) {
      row.text += text;
      row.width += columns;
    }
  };
  for (const [a = 0, b = 0] of pairs) {
    if (a === 0x14 && b === 0x2f) {
      captions.push(rows);
      rows = [];
      row = undefined;
    } else if (a >= 0x10 && a <= 0x17 && b >= 0x40) {
      const index = PacRows.findIndex(
        ([first, second]) => first === a && second === (b & 0x60),
      );
      row = {
        row: index + 1,
        column: b & 0x10 ? ((b & 0x0e) >> 1) * 4 : 0,
        width: 0,
        text: '',
      };
      rows.push(row);
    } else if (a === 0x17 && b >= 0x21 && b <= 0x23) {
      if (row) {
        row.column += b - 0x20;
      }
    } else if (a === 0x11 && b >= 0x20 && b <= 0x2f) {
      add(MidRowLabels[b] ?? '[?]', 1);
    } else if (a === 0x10 && b === 0x2f) {
      add('[bg:semi]', 0);
    } else if (a === 0x17 && b === 0x2d) {
      add('[bg:transparent]', 0);
    } else if (a === 0x11 && b === 0x37) {
      add('♪', 1);
    } else if (a >= 0x20) {
      for (const byte of [a, b].filter((x) => x >= 0x20)) {
        add(String.fromCharCode(byte), 1);
      }
    }
  }
  return captions;
}

const decode = (
  text: string,
  layout?: CaptionLayoutOptions,
  endMs = 6000,
): DecodedRow[][] =>
  decodeCaptions(
    framePairs([{ startMs: 3000, endMs, text }], 30 * 12, 0, layout),
  );

describe('layoutCaption', () => {
  test('wraps at 32 columns on word boundaries, two lines per caption', () => {
    const captions = layoutCaption(
      'The quick brown fox jumps over the lazy dog, then keeps on running far away from here',
    );

    expect(
      texts(captions)
        .flat()
        .every((line) => line.length <= 32),
    ).toBe(true);
    expect(captions.every(({ lines }) => lines.length <= 2)).toBe(true);
    expect(texts(captions).flat().join(' ')).toBe(
      'The quick brown fox jumps over the lazy dog, then keeps on running far away from here',
    );
    expect(captions).toHaveLength(2);
  });

  test('rewraps a cue whose lines are too wide, keeping it to two lines', () => {
    // One source line is 36 columns; rewrapping the whole cue fits it in two
    expect(
      texts(
        layoutCaption('Well, that is\na problem he thinks you can resolve.'),
      ),
    ).toEqual([['Well, that is a problem he', 'thinks you can resolve.']]);
  });

  test('keeps italics and top placement, and drops other formatting', () => {
    const [caption] = layoutCaption('{\\an8}<i>Hello</i>\\Nthere  <b>you</b>');

    expect(texts(caption ? [caption] : [])).toEqual([['Hello', 'there you']]);
    expect(caption?.top).toBe(true);
    expect(caption?.lines[0]?.every((c) => c.italic)).toBe(true);
    expect(caption?.lines[1]?.some((c) => c.italic)).toBe(false);
  });

  test('keeps every part of a long top-of-screen cue at the top', () => {
    const captions = layoutCaption(
      '{\\an8}One two three four five six seven eight nine ten eleven twelve thirteen fourteen',
    );

    expect(captions.length).toBeGreaterThan(1);
    expect(captions.every((c) => c.top)).toBe(true);
  });

  test("keeps the cue's own line breaks", () => {
    expect(texts(layoutCaption('First line\nSecond line'))).toEqual([
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
    expect(indexOfPair(pairs, EndOfCaption)).toBe(60);
    expect(indexOfPair(pairs, EndOfCaption, 61)).toBe(-1);
    expect(pairs[120]).toEqual(EraseDisplayedMemory);
    expect(indexOfPair(pairs, EraseDisplayedMemory, 121)).toBe(-1);
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

    // ♪, a space, ♪: a decoder would take a second ♪ right after the first for
    // a transmission repeat and skip it
    expect(pairs.slice(first, first + 3)).toEqual([
      MusicNote,
      [0x20, 0x00],
      MusicNote,
    ]);
  });

  test('starts both lines of a caption at the same column', () => {
    const pairs = framePairs(
      [
        {
          startMs: 3000,
          endMs: 5000,
          text: 'Short\nA much longer second line',
        },
      ],
      150,
    );
    // Preamble address codes with an indent: rows 14 (0x14 0x50-0x5f) and 15 (0x14 0x70-0x7f)
    const row14 = pairs.find(
      (p) => p[0] === 0x14 && (p[1] ?? 0) >= 0x50 && (p[1] ?? 0) <= 0x5f,
    );
    const row15 = pairs.find(
      (p) => p[0] === 0x14 && (p[1] ?? 0) >= 0x70 && (p[1] ?? 0) <= 0x7f,
    );

    expect(row14).toBeDefined();
    expect((row14?.[1] ?? 0) & 0x0f).toBe((row15?.[1] ?? 1) & 0x0f);
    // No tab offsets
    expect(
      pairs.some(
        (p) => p[0] === 0x17 && (p[1] ?? 0) >= 0x21 && (p[1] ?? 0) <= 0x23,
      ),
    ).toBe(false);
  });

  test('gives each part of a long cue time in proportion to its text', () => {
    // Three lines, so two captions: 55 characters, then 21
    const text =
      'One two three four five six seven eight nine ten eleven twelve thirteen. Bye.';
    const pairs = framePairs([{ startMs: 3000, endMs: 9000, text }], 400);
    const firstShown = indexOfPair(pairs, EndOfCaption);
    const secondShown = indexOfPair(pairs, EndOfCaption, firstShown + 1);

    expect(firstShown).toBe(90);
    // About 72% of the 6 s (180 frames) goes to the first caption, not half
    expect(secondShown).toBeGreaterThan(90 + 0.65 * 180);
    expect(secondShown).toBeLessThan(90 + 0.8 * 180);
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

describe('caption styles', () => {
  test('switches italics on and off in the spaces around them', () => {
    expect(decode('He said <i>hello there</i> to me')).toEqual([
      [
        {
          row: 15,
          column: 4,
          width: 25,
          text: 'He said[i]hello there[-]to me',
        },
      ],
    ]);
  });

  test('reads ASS italics, starting a line with the code', () => {
    expect(decode('{\\i1}Thinking{\\i0} out loud')[0]?.[0]?.text).toBe(
      '[i]Thinking[-]out loud',
    );
  });

  test('carries italics across the lines of a cue', () => {
    expect(
      decode('<i>First line\nsecond line</i>')[0]?.map((r) => r.text),
    ).toEqual(['[i]First line', '[i]second line']);
  });

  test('sends underline, italics with underline, and a reset', () => {
    expect(
      decode('<u>Under</u> plain {\\i1\\u1}both{\\r} reset')[0]?.[0]?.text,
    ).toBe('[u]Under[-]plain[iu]both[-]reset');
  });

  test('keeps punctuation after a styled word in its style', () => {
    expect(decode('<i>Hello</i>, world')[0]?.[0]?.text).toBe(
      '[i]Hello,[-]world',
    );
  });

  test('gives a change inside a word a column of its own', () => {
    expect(decode('un<i>believ</i>able')[0]?.[0]).toMatchObject({
      text: 'un[i]believ[-]able',
      width: 14,
    });
  });

  test('drops formatting 608 has no code for', () => {
    expect(
      decode(
        '<b>Bold</b> <font color="red">red</font> {\\pos(1,2)\\c&H00FF00&}text',
      )[0]?.[0]?.text,
    ).toBe('Bold red text');
  });

  test('counts style codes when wrapping', () => {
    const left = { alignment: 'left', background: 'player' } as const;
    // The italics code takes the first column: 31 characters fill the line
    const fits = decode(`<i>${'x'.repeat(31)}</i>`, left).flat();
    const wraps = decode(`<i>${'x'.repeat(32)}</i>`, left).flat();

    expect(fits).toHaveLength(1);
    expect(fits[0]?.width).toBe(32);
    expect(wraps).toHaveLength(2);
    expect(wraps.every((r) => r.column + r.width <= 32)).toBe(true);
  });
});

describe('caption placement', () => {
  test('puts a cue with a top alignment override at the top', () => {
    expect(decode('{\\an8}Top of the screen')[0]?.map((r) => r.row)).toEqual([
      1,
    ]);
    expect(decode('{\\an7}Upper\nleft')[0]?.map((r) => r.row)).toEqual([1, 2]);
    expect(decode('{\\a6}Old SSA top')[0]?.map((r) => r.row)).toEqual([1]);
  });

  test('reads an override block with several tags', () => {
    expect(decode('{\\an8\\i1}Top italic')[0]?.[0]).toMatchObject({
      row: 1,
      text: '[i]Top italic',
    });
  });

  test('keeps other alignments at the bottom', () => {
    expect(decode('{\\an2}Bottom')[0]?.map((r) => r.row)).toEqual([15]);
    expect(decode('{\\an5}Middle')[0]?.map((r) => r.row)).toEqual([15]);
  });

  test('centres each line on its own with tab offsets', () => {
    const rows = decode('Short\nA much longer second line', {
      alignment: 'centeredLines',
      background: 'player',
    })[0];

    // (32 - 5) / 2 = 13: preamble indent 12 and TO1; (32 - 25) / 2 = 3: indent 0 and TO3
    expect(rows?.map((r) => r.column)).toEqual([13, 3]);
  });

  test('starts every line at the left edge', () => {
    expect(
      decode('Short\nA much longer second line', {
        alignment: 'left',
        background: 'player',
      })[0]?.map((r) => r.column),
    ).toEqual([0, 0]);
  });
});

describe('caption background', () => {
  test('sends no background code by default', () => {
    expect(decode('Hi')[0]?.[0]?.text).toBe('Hi');
  });

  test('starts each line with a space and the background attribute', () => {
    expect(
      decode('Hi\nthere', {
        alignment: 'centeredBlock',
        background: 'semiTransparent',
      })[0]?.map((r) => r.text),
    ).toEqual([' [bg:semi]Hi', ' [bg:semi]there']);
    expect(
      decode('Hi', {
        alignment: 'centeredBlock',
        background: 'transparent',
      })[0]?.[0]?.text,
    ).toBe(' [bg:transparent]Hi');
  });

  test('counts the background column when wrapping', () => {
    const line = 'x'.repeat(32);

    expect(
      decode(line, { alignment: 'left', background: 'player' }).flat(),
    ).toHaveLength(1);
    // 31 characters and the background column fit a line, so 32 take two
    expect(
      decode(line, {
        alignment: 'left',
        background: 'semiTransparent',
      }).flat(),
    ).toHaveLength(2);
  });
});
