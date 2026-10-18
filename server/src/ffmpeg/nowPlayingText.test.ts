import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { serverResourcePath } from '../serverResources.ts';
import type { FontMetrics } from './fontMetrics.ts';
import {
  installFont,
  MaxNowPlayingEms,
  NowPlayingFontFileName,
  nowPlayingLine,
} from './nowPlayingText.ts';

// Every character is half an em wide, except those the font has no glyph for
function fakeFont(missing: string[] = []): FontMetrics {
  const missingCodes = new Set(missing.map((c) => c.codePointAt(0)));
  return {
    advance: (codePoint) => (missingCodes.has(codePoint) ? undefined : 0.5),
  };
}

describe('nowPlayingLine', () => {
  test('puts the artist before the title', () => {
    expect(
      nowPlayingLine(
        { artist: 'Les Exemples', title: 'Le matin à Paris' },
        fakeFont(),
      ),
    ).toBe('♪  Les Exemples — Le matin à Paris');
  });

  test('shows the title alone without an artist', () => {
    expect(nowPlayingLine({ title: 'Sundown' }, fakeFont())).toBe('♪  Sundown');
    expect(nowPlayingLine({ artist: '  ', title: 'Sundown' }, fakeFont())).toBe(
      '♪  Sundown',
    );
  });

  test('draws nothing without a title', () => {
    expect(
      nowPlayingLine({ artist: 'Les Exemples', title: ' \n ' }, fakeFont()),
    ).toBeUndefined();
  });

  test('keeps the text on one line', () => {
    expect(
      nowPlayingLine(
        { artist: 'The\tExample  Band', title: 'Ride\nOut\r\nTonight' },
        fakeFont(),
      ),
    ).toBe('♪  The Example Band — Ride Out Tonight');
  });

  test('composes accents typed as combining marks', () => {
    // "à" as "a" plus U+0300, which the font has no glyph for on its own
    expect(
      nowPlayingLine(
        { artist: 'Les Exemples', title: 'Le matin a\u0300 Paris' },
        fakeFont(['\u0300']),
      ),
    ).toBe('♪  Les Exemples — Le matin à Paris');
  });

  test("draws nothing when the font can't draw a character", () => {
    expect(
      nowPlayingLine({ artist: '아무개', title: 'Example' }, fakeFont(['아'])),
    ).toBeUndefined();
  });

  test('cuts a line that is too wide short with three periods', () => {
    // "♪  " and the periods take 3 ems of 5, which leaves room for "Lost"
    expect(nowPlayingLine({ title: 'Lost in the Middle' }, fakeFont(), 5)).toBe(
      '♪  Lost...',
    );
  });

  test('keeps a line exactly as wide as the limit', () => {
    expect(nowPlayingLine({ title: 'Sundown' }, fakeFont(), 5)).toBe(
      '♪  Sundown',
    );
  });

  test('measures with the real font, wide Japanese characters included', async () => {
    const { metrics } = await installFont(
      serverResourcePath('fonts', NowPlayingFontFileName),
      await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-font-')),
    );

    expect(
      nowPlayingLine(
        { artist: 'Neon 82–99', title: '新宿区 Night Drive' },
        metrics,
      ),
    ).toBe('♪  Neon 82–99 — 新宿区 Night Drive');

    const long = nowPlayingLine(
      {
        artist: 'The Long Names Ensemble',
        title:
          'A Very‐long Track Title That Goes On and On (Extended Remaster)',
      },
      metrics,
    );
    expect(
      long?.startsWith('♪  The Long Names Ensemble — A Very‐long Track'),
    ).toBe(true);
    expect(long?.endsWith('...')).toBe(true);
    const width = Array.from(long ?? '').reduce(
      (sum, c) => sum + (metrics.advance(c.codePointAt(0) ?? 0) ?? 0),
      0,
    );
    expect(width).toBeLessThanOrEqual(MaxNowPlayingEms);
  });
});

describe('installFont', () => {
  let dir: string;
  const resource = serverResourcePath('fonts', NowPlayingFontFileName);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-font-'));
  });

  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  test('copies the font where ffmpeg can read it', async () => {
    const fontsDir = path.join(dir, 'fonts');

    const font = await installFont(resource, fontsDir);

    expect(font.file).toBe(path.join(fontsDir, NowPlayingFontFileName));
    expect(
      (await fs.readFile(font.file)).equals(await fs.readFile(resource)),
    ).toBe(true);
    expect(await fs.readdir(fontsDir)).toEqual([NowPlayingFontFileName]);
  });

  test('leaves an identical copy alone', async () => {
    const first = await installFont(resource, dir);
    const before = await fs.stat(first.file);

    await installFont(resource, dir);

    expect((await fs.stat(first.file)).ino).toBe(before.ino);
  });

  test('replaces a copy that differs, such as one from an older version', async () => {
    const stale = path.join(dir, NowPlayingFontFileName);
    await fs.writeFile(stale, 'not this font');

    await installFont(resource, dir);

    expect((await fs.readFile(stale)).equals(await fs.readFile(resource))).toBe(
      true,
    );
  });
});
