const Utf8Bom = [0xef, 0xbb, 0xbf];
const Utf16LeBom = [0xff, 0xfe];
const Utf16BeBom = [0xfe, 0xff];

const StrictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// What Windows-1252 has at 0x80-0x9f, where Latin-1 has C1 control codes. The
// five bytes the code page leaves unassigned keep their Latin-1 value, as in
// the WHATWG Encoding Standard. Everywhere else the two are the same.
const Windows1252C1 =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021' +
  '\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
  '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014' +
  '\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

function startsWith(bytes: Buffer, prefix: readonly number[]): boolean {
  return (
    bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)
  );
}

/**
 * Windows-1252 bytes as text. Not `new TextDecoder('windows-1252')`: Node 22
 * decodes 0x80-0x9f with it as Latin-1's control codes, so ’ (0x92) and
 * – (0x96) come out as U+0092 and U+0096.
 */
export function decodeWindows1252(bytes: Buffer): string {
  return bytes
    .toString('latin1')
    .replace(/[\u0080-\u009f]/g, (c) =>
      Windows1252C1.charAt(c.charCodeAt(0) - 0x80),
    );
}

// The charset ffmpeg must be told to read a subtitle file in: only
// Windows-1252, since it reads byte order marks and UTF-8 on its own
export type SubtitleCharacterEncoding = 'WINDOWS-1252';

export type DecodedSubtitleFile = {
  text: string;
  // Set when the text was read as Windows-1252, for ffmpeg's `charenc`
  characterEncoding: SubtitleCharacterEncoding | undefined;
};

/**
 * A subtitle file's text, from its bytes, and the charset ffmpeg needs to
 * read the same file (for burn-in or WebVTT) the same way:
 *
 * - A byte order mark says the encoding: UTF-8, UTF-16 LE or UTF-16 BE.
 * - Otherwise UTF-8 when the bytes are valid UTF-8, which includes plain
 *   ASCII.
 * - Otherwise Windows-1252, the Western European code page older subtitle
 *   files were saved in. It reads Latin-1 (ISO 8859-1) files too: the two
 *   have the same printable characters outside 0x80-0x9f.
 * - Except a file that is mostly UTF-8, with at least as many valid non-ASCII
 *   characters as broken sequences (a stray byte, a character cut in two).
 *   That stays UTF-8, the broken sequences becoming U+FFFD, rather than
 *   turning every accented letter into two Windows-1252 ones (é as Ã©).
 *   Windows-1252 text seldom makes a valid UTF-8 sequence, so a tie goes to
 *   UTF-8.
 *
 * ffmpeg's subtitle decoder, which burn-in uses, reads byte order marks too,
 * but without a `charenc` it drops any cue that isn't valid UTF-8. So the
 * charset is set only when the file is read as Windows-1252.
 */
export function decodeSubtitleFile(bytes: Buffer): DecodedSubtitleFile {
  if (startsWith(bytes, Utf8Bom)) {
    return {
      text: bytes.toString('utf8', Utf8Bom.length),
      characterEncoding: undefined,
    };
  }
  if (startsWith(bytes, Utf16LeBom)) {
    return {
      text: bytes.toString('utf16le', Utf16LeBom.length),
      characterEncoding: undefined,
    };
  }
  if (startsWith(bytes, Utf16BeBom)) {
    // Swapped to little-endian, which Node decodes without ICU; a trailing
    // odd byte is dropped, as utf16le drops it
    const end = bytes.length - ((bytes.length - Utf16BeBom.length) % 2);
    return {
      text: Buffer.from(bytes.subarray(Utf16BeBom.length, end))
        .swap16()
        .toString('utf16le'),
      characterEncoding: undefined,
    };
  }
  try {
    return { text: StrictUtf8.decode(bytes), characterEncoding: undefined };
  } catch {
    // Not all valid UTF-8; see which it mostly is
  }
  const lossy = bytes.toString('utf8');
  let broken = 0;
  let nonAscii = 0;
  for (const ch of lossy) {
    if (ch === '\ufffd') {
      broken++;
    } else if (ch > '\u007f') {
      nonAscii++;
    }
  }
  return nonAscii >= broken
    ? { text: lossy, characterEncoding: undefined }
    : { text: decodeWindows1252(bytes), characterEncoding: 'WINDOWS-1252' };
}

/** A subtitle file's text, from its bytes ({@link decodeSubtitleFile}). */
export function decodeSubtitleText(bytes: Buffer): string {
  return decodeSubtitleFile(bytes).text;
}

/**
 * The charset ffmpeg needs for a subtitle file: Windows-1252 when
 * {@link decodeSubtitleFile} reads it as Windows-1252. BOMs and UTF-8 are
 * handled by FFmpeg.
 */
export function subtitleCharacterEncoding(
  bytes: Buffer,
): SubtitleCharacterEncoding | undefined {
  return decodeSubtitleFile(bytes).characterEncoding;
}
