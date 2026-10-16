import type {
  CaptionAppearance,
  CaptionLayout,
  CcPair,
} from './Cea608Encoder.ts';
import {
  buildCaptionSchedule,
  layoutCaption,
  PaddingPair,
} from './Cea608Encoder.ts';
import {
  NoCaptionsNoticeMs,
  NoCaptionsNoticeStartMs,
  NoCaptionsNoticeText,
  noCaptionsNoticeStartMs,
} from './ProgramCaptions.ts';
import {
  decodeScreens,
  screenAt,
} from '../../testing/captions/Cea608TestDecoder.ts';

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
  appearance?: Partial<CaptionAppearance>,
) {
  const schedule = buildCaptionSchedule(cues, {
    firstFrameMs,
    frameRate: FrameRate,
    appearance,
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
// changes show as [i] italics, [u] underline, [iu] both, [-] plain.
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
  layout?: Partial<CaptionAppearance>,
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
    expect(caption?.placement.vertical).toBe('top');
    expect(caption?.lines[0]?.every((c) => c.italic)).toBe(true);
    expect(caption?.lines[1]?.some((c) => c.italic)).toBe(false);
  });

  test('keeps every part of a long top-of-screen cue at the top', () => {
    const captions = layoutCaption(
      '{\\an8}One two three four five six seven eight nine ten eleven twelve thirteen fourteen',
    );

    expect(captions.length).toBeGreaterThan(1);
    expect(captions.every((c) => c.placement.vertical === 'top')).toBe(true);
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

  // A viewer who tunes in near the end of a cue: it can't be loaded before
  // it ends, so showing it would flash it for a frame and hold up the next
  test('leaves out a cue already under way that ends before it can be loaded', () => {
    // The program starts at 1 s, 100 ms before the cue ends
    const pairs = framePairs(
      [
        { startMs: 0, endMs: 1100, text: 'Already talking' },
        { startMs: 1500, endMs: 3000, text: 'Next' },
      ],
      90,
      1000,
    );

    expect(decodeCaptions(pairs).map((c) => c.map((r) => r.text))).toEqual([
      ['Next'],
    ]);
    // On its own start frame, 0.5 s in
    expect(indexOfPair(pairs, EndOfCaption)).toBe(15);
  });

  test('clears the caption on screen at its end when the one meant to replace it is left out', () => {
    const pairs = framePairs(
      [
        { startMs: 1000, endMs: 2000, text: 'First' },
        // Starts as the first ends, but its two full lines take longer to
        // load than the second the first is on screen
        {
          startMs: 2000,
          endMs: 2050,
          text: 'A line of thirty-two characters\nand another one just as long ok',
        },
      ],
      120,
    );

    expect(decodeCaptions(pairs).map((c) => c.map((r) => r.text))).toEqual([
      ['First'],
    ]);
    expect(pairs[30]).toEqual(EndOfCaption);
    expect(indexOfPair(pairs, EraseDisplayedMemory)).toBe(60);
    expect(indexOfPair(pairs, EndOfCaption, 31)).toBe(-1);
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
    const left = { alignment: 'left' } as const;
    // The italics code takes the first column: 31 characters fill the line
    const fits = decode(`<i>${'x'.repeat(31)}</i>`, left).flat();
    const wraps = decode(`<i>${'x'.repeat(32)}</i>`, left).flat();

    expect(fits).toHaveLength(1);
    expect(fits[0]?.width).toBe(32);
    expect(wraps).toHaveLength(2);
    expect(wraps.every((r) => r.column + r.width <= 32)).toBe(true);
  });
});

// The rows of each caption shown, as the test decoder reads them
function shownCaptions(
  cues: Parameters<typeof buildCaptionSchedule>[0],
  appearance?: Partial<CaptionAppearance>,
) {
  return decodeScreens(framePairs(cues, 30 * 20, 0, appearance))
    .filter((screen) => screen.rows.length > 0)
    .map((screen) => screen.rows);
}

const cue = (text: string) => [{ startMs: 3000, endMs: 6000, text }];
const rowTexts = (captions: ReturnType<typeof shownCaptions>) =>
  captions.map((rows) => rows.map((r) => r.text));

describe('caption appearance', () => {
  test('draws text in the chosen colour, from the start of each line', () => {
    expect(
      rowTexts(shownCaptions(cue('Hello\nthere'), { textColor: 'red' })),
    ).toEqual([['[red]Hello', '[red]there']]);
  });

  // 608's italics are white, so italic words lose the colour
  test('shows italics white and goes back to the colour after them', () => {
    expect(
      rowTexts(
        shownCaptions(cue('<i>Psst,</i> said <u>he</u>'), {
          textColor: 'green',
        }),
      ),
    ).toEqual([['[i]Psst,[green]said[green u]he']]);
  });

  test('puts a box of the chosen colour behind each line', () => {
    expect(
      rowTexts(shownCaptions(cue('Hi\nthere'), { backgroundColor: 'blue' })),
    ).toEqual([[' [bg blue]Hi', ' [bg blue]there']]);
  });

  test('sends semi-transparent and transparent boxes', () => {
    expect(
      rowTexts(
        shownCaptions(cue('Hi'), {
          backgroundColor: 'black',
          backgroundOpacity: 'semiTransparent',
        }),
      ),
    ).toEqual([[' [bg black semi]Hi']]);
    expect(
      rowTexts(
        shownCaptions(cue('Hi'), {
          backgroundColor: 'red',
          backgroundOpacity: 'transparent',
        }),
      ),
    ).toEqual([[' [bg transparent]Hi']]);
  });

  test("sends no box code for the player's own box, whatever the opacity", () => {
    expect(
      rowTexts(
        shownCaptions(cue('Hi'), {
          backgroundColor: 'player',
          backgroundOpacity: 'semiTransparent',
        }),
      ),
    ).toEqual([['Hi']]);
  });

  // A colour code ends flashing, so it has to come first
  test('sends the box, then the colour, then flash', () => {
    expect(
      rowTexts(
        shownCaptions(cue('Hi'), {
          backgroundColor: 'blue',
          textColor: 'yellow',
          flash: true,
        }),
      ),
    ).toEqual([[' [bg blue][yellow][flash]Hi']]);
  });

  test('counts the codes in the line width', () => {
    // 32 columns: one line plain, two with a box
    const line = 'Thirty-two characters, exactly.!';
    expect(line).toHaveLength(32);
    expect(shownCaptions(cue(line))[0]).toHaveLength(1);
    expect(
      shownCaptions(cue(line), { backgroundColor: 'blue' })[0],
    ).toHaveLength(2);
  });

  test('ends bottom captions on the chosen row', () => {
    const [rows] = shownCaptions(cue('One\nTwo'), { bottomRow: 11 });
    expect(rows?.map((r) => r.row)).toEqual([10, 11]);
  });

  test('starts top captions on the chosen row', () => {
    const [rows] = shownCaptions(cue('{\\an8}One\nTwo'), { topRow: 5 });
    expect(rows?.map((r) => r.row)).toEqual([5, 6]);
  });

  test('keeps every line on screen whatever the rows', () => {
    expect(
      shownCaptions(cue('One\nTwo'), { bottomRow: 1 })[0]?.map((r) => r.row),
    ).toEqual([1, 2]);
    expect(
      shownCaptions(cue('{\\an8}One\nTwo'), { topRow: 15 })[0]?.map(
        (r) => r.row,
      ),
    ).toEqual([14, 15]);
  });

  test('puts up to the chosen number of lines in a caption', () => {
    const text = 'One\nTwo\nThree\nFour';
    expect(rowTexts(shownCaptions(cue(text)))).toEqual([
      ['One', 'Two'],
      ['Three', 'Four'],
    ]);
    const [four] = shownCaptions(cue(text), { maxLines: 4 });
    expect(four?.map((r) => [r.row, r.text])).toEqual([
      [12, 'One'],
      [13, 'Two'],
      [14, 'Three'],
      [15, 'Four'],
    ]);
  });

  test('wraps lines at the chosen width', () => {
    const captions = shownCaptions(
      cue('A sentence long enough to need wrapping at twenty columns.'),
      { lineWidth: 20, maxLines: 4 },
    );
    const widths = captions.flat().map((r) => r.width);
    expect(Math.max(...widths)).toBeLessThanOrEqual(20);
    expect(widths.length).toBeGreaterThan(2);
  });

  test('shows the text in capitals', () => {
    expect(
      rowTexts(
        shownCaptions(cue('Die Straße, <i>jetzt</i>'), { upperCase: true }),
      ),
    ).toEqual([['DIE STRASSE,[i]JETZT']]);
  });

  test("leaves out the file's styles and top placement when asked", () => {
    const [rows] = shownCaptions(cue('{\\an8}<i>Hi</i> there'), {
      keepStyles: false,
      keepTopPlacement: false,
    });
    expect(rows?.map((r) => [r.row, r.text])).toEqual([[15, 'Hi there']]);
  });

  test("gives a cue its own appearance over the schedule's", () => {
    const captions = shownCaptions(
      [
        { startMs: 1000, endMs: 3000, text: 'Plain' },
        {
          startMs: 4000,
          endMs: 6000,
          text: 'Mine',
          appearance: { textColor: 'cyan' },
        },
      ],
      { backgroundColor: 'red' },
    );
    expect(rowTexts(captions)).toEqual([
      [' [bg red]Plain'],
      [' [bg red][cyan]Mine'],
    ]);
  });
});

const ResumeDirectCaptioning = [0x14, 0x29];
const CarriageReturn = [0x14, 0x2d];
const RollUp2 = [0x14, 0x25];
const RollUp3 = [0x14, 0x26];

// Each row's text on `frame`
const textsAt = (pairs: number[][], frame: number) =>
  screenAt(decodeScreens(pairs), frame).map((r) => [r.row, r.text]);

describe('paint-on captions', () => {
  test('draws each caption as it arrives, from its start frame', () => {
    const pairs = framePairs(
      [{ startMs: 2000, endMs: 4000, text: 'Hello there' }],
      150,
      0,
      { mode: 'paintOn' },
    );

    expect(indexOfPair(pairs, ResumeDirectCaptioning)).toBeLessThan(60);
    // Erased on its start frame, which is where FFmpeg's decoder times it from
    expect(pairs[60]).toEqual(EraseDisplayedMemory);
    const screens = decodeScreens(pairs).filter((s) => s.rows.length > 0);
    expect(screens[0]?.fromFrame).toBe(62);
    expect(textsAt(pairs, 100)).toEqual([[15, 'Hello there']]);
    expect(textsAt(pairs, 120)).toEqual([]);
    expect(indexOfPair(pairs, EndOfCaption)).toBe(-1);
  });

  test('replaces one caption with the next, which erases on its start', () => {
    const pairs = framePairs(
      [
        { startMs: 1000, endMs: 2000, text: 'First' },
        { startMs: 2000, endMs: 3000, text: 'Second' },
      ],
      120,
      0,
      { mode: 'paintOn' },
    );

    expect(textsAt(pairs, 55)).toEqual([[15, 'First']]);
    expect(pairs[60]).toEqual(EraseDisplayedMemory);
    expect(textsAt(pairs, 85)).toEqual([[15, 'Second']]);
    expect(indexOfPair(pairs, EraseDisplayedMemory, 61)).toBe(90);
  });

  test('leaves out a cue already under way that ends before it can start', () => {
    const pairs = framePairs(
      [{ startMs: 0, endMs: 1010, text: 'Gone' }],
      60,
      1000,
      { mode: 'paintOn' },
    );
    expect(decodeScreens(pairs).filter((s) => s.rows.length > 0)).toEqual([]);
  });
});

describe('roll-up captions', () => {
  test("scrolls a cue's lines up from the bottom, keeping the chosen number of rows", () => {
    const pairs = framePairs(
      [{ startMs: 2000, endMs: 5000, text: 'One\nTwo\nThree' }],
      180,
      0,
      { mode: 'rollUp2' },
    );

    // The mode is set before the cue, with the screen cleared
    expect(indexOfPair(pairs, EraseDisplayedMemory)).toBeLessThan(60);
    expect(indexOfPair(pairs, RollUp2)).toBeLessThan(60);
    // The first carriage return on its start frame
    expect(pairs[60]).toEqual(CarriageReturn);
    expect(textsAt(pairs, 140)).toEqual([
      [14, 'Two'],
      [15, 'Three'],
    ]);
    expect(textsAt(pairs, 151)).toEqual([]);
  });

  test('keeps the last lines up for the next cue to scroll, within 2 s', () => {
    const pairs = framePairs(
      [
        { startMs: 1000, endMs: 2000, text: 'One' },
        { startMs: 3500, endMs: 4500, text: 'Two' },
        // More than 2 s later: the screen is cleared before it
        { startMs: 7000, endMs: 8000, text: 'Three' },
      ],
      270,
      0,
      { mode: 'rollUp3' },
    );

    expect(textsAt(pairs, 90)).toEqual([[15, 'One']]);
    expect(textsAt(pairs, 130)).toEqual([
      [14, 'One'],
      [15, 'Two'],
    ]);
    expect(textsAt(pairs, 200)).toEqual([]);
    expect(textsAt(pairs, 230)).toEqual([[15, 'Three']]);
    // The mode is set once
    expect(pairs.filter((p) => p[0] === 0x14 && p[1] === 0x26)).toHaveLength(1);
    expect(indexOfPair(pairs, RollUp3)).toBeLessThan(30);
  });

  test('rolls up to the chosen bottom row', () => {
    const pairs = framePairs(
      [{ startMs: 1000, endMs: 4000, text: 'One\nTwo\nThree' }],
      150,
      0,
      { mode: 'rollUp3', bottomRow: 11 },
    );
    expect(textsAt(pairs, 110)).toEqual([
      [9, 'One'],
      [10, 'Two'],
      [11, 'Three'],
    ]);
  });
});

// Paint-on and roll-up send their text while the cue is up
describe('drawn captions that take longer to send than they last', () => {
  const long =
    'A line long enough to take a while\nAnd a second one just as long\nA third line of text to send\nAnd a fourth line to finish';
  const cues = [
    { startMs: 1000, endMs: 2000, text: long },
    { startMs: 2100, endMs: 3500, text: 'Next' },
  ];

  test('paint-on: cuts the text off at the end, and the next cue starts on time', () => {
    const pairs = framePairs(cues, 150, 0, { mode: 'paintOn' });

    // Cleared on its end frame, not later
    expect(pairs[60]).toEqual(EraseDisplayedMemory);
    expect(textsAt(pairs, 61)).toEqual([]);
    // The next cue erases on its start frame and its text follows
    expect(pairs[63]).toEqual(EraseDisplayedMemory);
    expect(textsAt(pairs, 70)).toEqual([[15, 'Next']]);
  });

  test('roll-up: sends nothing of the cue after its end, and the next cue starts on time', () => {
    const pairs = framePairs(cues, 150, 0, { mode: 'rollUp4' });

    // The frames between the two cues carry nothing
    expect(pairs.slice(60, 63)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(pairs[63]).toEqual(CarriageReturn);
    expect(textsAt(pairs, 70).at(-1)).toEqual([15, 'Next']);
  });
});

describe('switching modes', () => {
  // pop-on, roll-up, paint-on, pop-on, each cue in its own mode
  const cues = [
    { startMs: 1000, endMs: 2000, text: 'Pop', appearance: {} },
    {
      startMs: 3000,
      endMs: 4000,
      text: 'Roll',
      appearance: { mode: 'rollUp2' as const },
    },
    {
      startMs: 5000,
      endMs: 6000,
      text: 'Paint',
      appearance: { mode: 'paintOn' as const },
    },
    { startMs: 7000, endMs: 8000, text: 'Pop again', appearance: {} },
  ];

  test('shows each cue in its own mode, for its own time', () => {
    const pairs = framePairs(cues, 270);

    expect(textsAt(pairs, 50)).toEqual([[15, 'Pop']]);
    expect(textsAt(pairs, 70)).toEqual([]);
    expect(textsAt(pairs, 110)).toEqual([[15, 'Roll']]);
    expect(textsAt(pairs, 130)).toEqual([]);
    expect(textsAt(pairs, 170)).toEqual([[15, 'Paint']]);
    expect(textsAt(pairs, 190)).toEqual([]);
    expect(textsAt(pairs, 230)).toEqual([[15, 'Pop again']]);
  });

  // FFmpeg's decoder takes a carriage return in pop-on mode as a roll-up,
  // wiping rows and showing the hidden caption early
  test('never sends a carriage return while loading a pop-on caption', () => {
    const pairs = framePairs(cues, 270);
    let mode = '';
    for (const [a, b] of pairs) {
      if (a === 0x14 && b === 0x20) {
        mode = 'popOn';
      } else if (a === 0x14 && (b === 0x29 || (b >= 0x25 && b <= 0x27))) {
        mode = 'other';
      } else if (a === 0x14 && b === 0x2d) {
        expect(mode).toBe('other');
      }
    }
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
    })[0];

    // (32 - 5) / 2 = 13: preamble indent 12 and TO1; (32 - 25) / 2 = 3: indent 0 and TO3
    expect(rows?.map((r) => r.column)).toEqual([13, 3]);
  });

  test('starts every line at the left edge', () => {
    expect(
      decode('Short\nA much longer second line', { alignment: 'left' })[0]?.map(
        (r) => r.column,
      ),
    ).toEqual([0, 0]);
  });
});

describe('the no-captions notice', () => {
  test('is a plain caption on the bottom row, from 1 s to 5 s', () => {
    const pairs = framePairs(
      [
        {
          startMs: NoCaptionsNoticeStartMs,
          endMs: NoCaptionsNoticeStartMs + NoCaptionsNoticeMs,
          text: NoCaptionsNoticeText,
        },
      ],
      30 * 6,
    );

    expect(decodeCaptions(pairs)).toEqual([
      [{ row: 15, column: 4, width: 28, text: 'No captions for this program' }],
    ]);
    // Loaded in the 17 frames before it shows, clear of the first frames
    expect(indexOfPair(pairs, ResumeCaptionLoading)).toBe(13);
    expect(indexOfPair(pairs, EndOfCaption)).toBe(30);
    expect(indexOfPair(pairs, EraseDisplayedMemory)).toBe(150);
  });

  test('loads in full before it shows, whatever the appearance', () => {
    for (const appearance of [
      { backgroundColor: 'blue', textColor: 'red', flash: true },
      { lineWidth: 20, alignment: 'centeredLines', backgroundColor: 'white' },
      { maxLines: 4, lineWidth: 20, textColor: 'magenta' },
    ] as const) {
      const startMs = noCaptionsNoticeStartMs(FrameRate, appearance);
      const pairs = framePairs(
        [
          {
            startMs,
            endMs: startMs + NoCaptionsNoticeMs,
            text: NoCaptionsNoticeText,
          },
        ],
        30 * 7,
        0,
        appearance,
      );
      expect(indexOfPair(pairs, EndOfCaption)).toBe(
        Math.round((startMs * FrameRate) / 1000),
      );
      expect(indexOfPair(pairs, ResumeCaptionLoading)).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  // The notice loads clear of the first 2 frame slots, which a program whose
  // video starts late never sends, even where 1 s is only 15 frames
  test('loads after the first 2 frames at 15 fps', () => {
    const frameRate = 15;
    const startMs = noCaptionsNoticeStartMs(frameRate);
    const schedule = buildCaptionSchedule(
      [
        {
          startMs,
          endMs: startMs + NoCaptionsNoticeMs,
          text: NoCaptionsNoticeText,
        },
      ],
      { firstFrameMs: 0, frameRate },
    );
    const pairs = Array.from({ length: frameRate * 7 }, (_, k) =>
      withoutParity(schedule.pairAt((k * 1000) / frameRate)),
    );

    expect(indexOfPair(pairs, ResumeCaptionLoading)).toBeGreaterThanOrEqual(2);
    expect(decodeCaptions(pairs.slice(2))).toEqual([
      [{ row: 15, column: 4, width: 28, text: 'No captions for this program' }],
    ]);
  });
});
