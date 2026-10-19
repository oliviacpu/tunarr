import fs from 'node:fs/promises';
import path from 'node:path';
import { globalOptions } from '../globals.ts';
import { serverResourcePath } from '../serverResources.ts';
import { FontsFolderName } from '../util/constants.ts';
import { LoggerFactory } from '../util/logging/LoggerFactory.ts';
import type { FontMetrics } from './fontMetrics.ts';
import { readFontMetrics } from './fontMetrics.ts';

// M+ Rounded 1c: rounded like the channel cards' lettering, and it covers
// Latin, Greek, Cyrillic and Japanese (kana and about 5,000 kanji), because
// drawtext draws with one font and can't fall back to another
export const NowPlayingFontFileName = 'MPLUSRounded1c-Bold.ttf';

// The widest line, in ems. NowPlayingTextFilter limits the font size by both
// picture dimensions, leaving room for the strip's horizontal padding.
export const MaxNowPlayingEms = 32;

// Three periods: this font draws U+2026 at mid-height, the Japanese way
const Ellipsis = '...';

export type NowPlayingTrack = {
  title: string;
  artist?: string;
};

/**
 * The line drawn over a gap's offline picture, "♪  Artist — Title", cut short
 * with "..." when it's wider than maxEms. Undefined when the track has
 * no title, or when the font has no glyph for one of its characters: drawtext
 * would draw a box in its place.
 */
export function nowPlayingLine(
  track: NowPlayingTrack,
  font: FontMetrics,
  maxEms: number = MaxNowPlayingEms,
): string | undefined {
  const title = cleanText(track.title);
  if (title.length === 0) {
    return;
  }
  const artist = cleanText(track.artist ?? '');
  const line = artist.length > 0 ? `♪  ${artist} — ${title}` : `♪  ${title}`;

  const chars = Array.from(line);
  const widths: number[] = [];
  for (const char of chars) {
    const width = font.advance(char.codePointAt(0) ?? 0);
    if (width === undefined) {
      return;
    }
    widths.push(width);
  }

  if (widths.reduce((sum, w) => sum + w, 0) <= maxEms) {
    return line;
  }

  const periodWidth = font.advance(Ellipsis.codePointAt(0) ?? 0);
  if (periodWidth === undefined) {
    return;
  }
  let kept = 0;
  let width = Ellipsis.length * periodWidth;
  for (const charWidth of widths) {
    if (width + charWidth > maxEms) {
      break;
    }
    width += charWidth;
    kept++;
  }
  return chars.slice(0, kept).join('').trimEnd() + Ellipsis;
}

// One line of composed text: control characters and runs of whitespace become
// a single space. NFC composes letters with combining accents into the
// precomposed letters fonts have glyphs for.
function cleanText(text: string) {
  return text
    .normalize('NFC')
    .replaceAll(/[\p{Cc}\s]+/gu, ' ')
    .trim();
}

export type NowPlayingFont = {
  // A copy ffmpeg can read
  file: string;
  metrics: FontMetrics;
};

/**
 * Copies a font file into dir, unless the same file is already there, and
 * reads its metrics. ffmpeg can't read the server's resources in the packaged
 * binary, where they live in the binary's snapshot.
 */
export async function installFont(
  resourceFile: string,
  dir: string,
): Promise<NowPlayingFont> {
  const bytes = await fs.readFile(resourceFile);
  const metrics = readFontMetrics(bytes);
  const file = path.join(dir, path.basename(resourceFile));
  const existing = await fs.readFile(file).catch(() => undefined);
  if (!existing?.equals(bytes)) {
    await fs.mkdir(dir, { recursive: true });
    // written aside and renamed in, so ffmpeg never opens half a font
    const partial = `${file}.${process.pid}.partial`;
    await fs.writeFile(partial, bytes);
    await fs.rename(partial, file);
  }
  return { file, metrics };
}

let installing: Promise<NowPlayingFont> | undefined;

function installNowPlayingFont() {
  return installFont(
    serverResourcePath('fonts', NowPlayingFontFileName),
    path.join(globalOptions().databaseDirectory, FontsFolderName),
  );
}

/**
 * The bundled now-playing font, copied into the data directory's fonts folder
 * on first use. Checks the copy is still there each time, since ffmpeg fails
 * to start without it, and copies it again if not. Undefined, and logged, when
 * the copy fails; the next call tries again.
 */
export async function loadNowPlayingFont(): Promise<
  NowPlayingFont | undefined
> {
  try {
    installing ??= installNowPlayingFont();
    let font = await installing;
    if (!(await fs.stat(font.file).catch(() => undefined))) {
      installing = installNowPlayingFont();
      font = await installing;
    }
    return font;
  } catch (err) {
    installing = undefined;
    LoggerFactory.child({
      caller: import.meta,
      className: 'NowPlayingText',
    }).warn(err, 'Could not set up the font for gap music titles');
    return;
  }
}
