import {
  decodeSubtitleText,
  decodeWindows1252,
  subtitleCharacterEncoding,
} from './decodeSubtitleText.ts';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((p) =>
      typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p),
    ),
  );

describe('decodeSubtitleText', () => {
  test('reads UTF-8', () => {
    expect(decodeSubtitleText(bytes('Un café para el niño’s…'))).toBe(
      'Un café para el niño’s…',
    );
  });

  test('reads UTF-8 with a byte order mark, without the mark', () => {
    expect(decodeSubtitleText(bytes([0xef, 0xbb, 0xbf], 'café'))).toBe('café');
  });

  test('reads UTF-16 LE with a byte order mark', () => {
    expect(
      decodeSubtitleText(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from('1\r\nUn café, niño ♪', 'utf16le'),
        ]),
      ),
    ).toBe('1\r\nUn café, niño ♪');
  });

  test('reads UTF-16 BE with a byte order mark', () => {
    const body = Buffer.from('Un café, niño ♪', 'utf16le').swap16();
    expect(
      decodeSubtitleText(Buffer.concat([Buffer.from([0xfe, 0xff]), body])),
    ).toBe('Un café, niño ♪');
    // A cut-off last byte is dropped
    expect(
      decodeSubtitleText(
        Buffer.concat([Buffer.from([0xfe, 0xff]), body, Buffer.from([0x00])]),
      ),
    ).toBe('Un café, niño ♪');
  });

  test('reads Windows-1252 accented letters', () => {
    // 'café' and 'niño' as Windows-1252 (and Latin-1) saves them
    expect(decodeSubtitleText(bytes('caf', [0xe9]))).toBe('café');
    expect(decodeSubtitleText(bytes('ni', [0xf1], 'o'))).toBe('niño');
  });

  test("reads Windows-1252's punctuation at 0x80-0x9f, not control codes", () => {
    // It’s – “fine”… 5 €
    expect(
      decodeSubtitleText(
        bytes(
          'It',
          [0x92],
          's ',
          [0x96, 0x20, 0x93],
          'fine',
          [0x94, 0x85],
          ' 5 ',
          [0x80],
        ),
      ),
    ).toBe('It’s – “fine”… 5 €');
  });

  test('leaves plain ASCII as it is', () => {
    const ascii = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello, world!\r\n';
    expect(decodeSubtitleText(bytes(ascii))).toBe(ascii);
  });

  test('reads a mostly UTF-8 file with a stray byte as UTF-8', () => {
    // One bad byte doesn't turn every é into Ã©
    expect(decodeSubtitleText(bytes('Un café, ', [0xff], ' niño'))).toBe(
      'Un café, \ufffd niño',
    );
  });

  test('reads a UTF-8 file with as many stray bytes as accents as UTF-8', () => {
    // A cut-off last character, and one accent: still UTF-8
    expect(decodeSubtitleText(bytes('Un café', [0xc3]))).toBe('Un café\ufffd');
  });

  test('reads a Windows-1252 file as Windows-1252 even with a UTF-8-looking pair', () => {
    // 'Ã©' (0xc3 0xa9) happens to be valid UTF-8 for 'é'; the rest isn't UTF-8
    expect(
      decodeSubtitleText(
        bytes([0xc3, 0xa9], ' caf', [0xe9], ' ni', [0xf1], 'o'),
      ),
    ).toBe('Ã© café niño');
  });

  test('reads an empty file as empty', () => {
    expect(decodeSubtitleText(Buffer.alloc(0))).toBe('');
  });
});

describe('decodeWindows1252', () => {
  test('maps 0x80-0x9f to the code page, keeping its five unassigned bytes', () => {
    expect(
      decodeWindows1252(
        Buffer.from(Array.from({ length: 0x20 }, (_, i) => 0x80 + i)),
      ),
    ).toBe('€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ');
  });

  test('reads every other byte as Latin-1', () => {
    const others = Array.from({ length: 0x100 }, (_, i) => i).filter(
      (b) => b < 0x80 || b > 0x9f,
    );
    expect(decodeWindows1252(Buffer.from(others))).toBe(
      String.fromCharCode(...others),
    );
  });
});

describe('subtitleCharacterEncoding', () => {
  test('only overrides FFmpeg for legacy bytes', () => {
    expect(subtitleCharacterEncoding(Buffer.from('café', 'latin1'))).toBe(
      'WINDOWS-1252',
    );
    expect(subtitleCharacterEncoding(Buffer.from('café'))).toBeUndefined();
    expect(
      subtitleCharacterEncoding(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from('café', 'utf16le'),
        ]),
      ),
    ).toBeUndefined();
  });
});
