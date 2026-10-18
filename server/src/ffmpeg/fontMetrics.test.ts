import fs from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { serverResourcePath } from '../serverResources.ts';
import { readFontMetrics } from './fontMetrics.ts';

// A font with just the tables readFontMetrics reads: 1000 units per em, three
// glyph advances (.notdef 500, 600, 700; glyphs past the third share 700), and
// one format 4 Unicode map
function makeFont(cmapSubtable: number[]) {
  const head = new Array<number>(54).fill(0);
  head[18] = 1000 >> 8;
  head[19] = 1000 & 0xff;
  const hhea = new Array<number>(36).fill(0);
  hhea[35] = 3;
  const hmtx = [500, 600, 700].flatMap((advance) => [
    ...u16(advance),
    ...u16(0),
  ]);
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12)];
  cmap.push(...cmapSubtable);

  const tables: [string, number[]][] = [
    ['cmap', cmap],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
  ];
  const bytes = [...u32(0x00010000), ...u16(tables.length), 0, 0, 0, 0, 0, 0];
  let offset = 12 + 16 * tables.length;
  for (const [tag, data] of tables) {
    bytes.push(...[...tag].map((c) => c.charCodeAt(0)), 0, 0, 0, 0);
    bytes.push(...u32(offset), ...u32(data.length));
    offset += data.length;
  }
  for (const [, data] of tables) {
    bytes.push(...data);
  }
  // offset into a bigger buffer, as Node's pooled Buffers are
  const pool = new Uint8Array(bytes.length + 8);
  pool.set(bytes, 8);
  return pool.subarray(8);
}

function u16(n: number) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number) {
  return [...u16(n >>> 16), ...u16(n & 0xffff)];
}

describe('readFontMetrics', () => {
  test('reads a format 4 map, with deltas and with a glyph index array', () => {
    // 'A'-'B' map to glyphs 1-2 by delta; 'x' maps to glyph 3 through the
    // array; 0xFFFF ends the map
    const segments = [
      { start: 0x41, end: 0x42, delta: 1 - 0x41, rangeOffset: 0 },
      { start: 0x78, end: 0x78, delta: 0, rangeOffset: 4 },
      { start: 0xffff, end: 0xffff, delta: 1, rangeOffset: 0 },
    ];
    const segCount = segments.length;
    const subtable = [
      ...u16(4),
      ...u16(0), // length, unread
      ...u16(0),
      ...u16(2 * segCount),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...segments.flatMap((s) => u16(s.end)),
      ...u16(0),
      ...segments.flatMap((s) => u16(s.start)),
      ...segments.flatMap((s) => u16(s.delta & 0xffff)),
      // the 'x' segment's offset (4) reaches from its own slot, past the
      // last slot, to the first entry of the glyph array
      ...segments.flatMap((s) => u16(s.rangeOffset)),
      ...u16(3),
    ];

    const metrics = readFontMetrics(makeFont(subtable));

    expect(metrics.advance(0x41)).toBe(0.6);
    expect(metrics.advance(0x42)).toBe(0.7);
    expect(metrics.advance(0x78)).toBe(0.7);
    expect(metrics.advance(0x43)).toBeUndefined();
    expect(metrics.advance(0xffff)).toBeUndefined();
  });

  test('rejects a file that is not a font', () => {
    expect(() =>
      readFontMetrics(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toThrow();
  });

  test("reads the bundled now-playing font's full Unicode map", async () => {
    const metrics = readFontMetrics(
      await fs.readFile(serverResourcePath('fonts', 'MPLUSRounded1c-Bold.ttf')),
    );

    expect(metrics.advance('A'.codePointAt(0) ?? 0)).toBe(0.653);
    expect(metrics.advance(0x266a)).toBe(0.613); // ♪
    expect(metrics.advance(0x2026)).toBe(1); // …
    expect(metrics.advance(0x6c34)).toBe(1); // 水
    expect(metrics.advance(0x3046)).toBe(1); // う
    expect(metrics.advance(0xe0)).toBe(0.561); // à
    // past the Basic Multilingual Plane: a kanji only the format 12 map has
    expect(metrics.advance(0x27fb7)).toBeGreaterThan(0);
    expect(metrics.advance(0xd55c)).toBeUndefined(); // 한
    expect(metrics.advance(0x1f600)).toBeUndefined(); // 😀
  });
});
