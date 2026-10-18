/**
 * The glyph widths of a TrueType font, read from its cmap, head, hhea and hmtx
 * tables. Enough to tell whether the font can draw a string and how wide it
 * will be, ignoring kerning.
 */
export type FontMetrics = {
  /** The advance width of the code point's glyph, in ems; undefined when the font has no glyph for it. */
  advance(codePoint: number): number | undefined;
};

type TableRecord = { offset: number };

export function readFontMetrics(font: Uint8Array): FontMetrics {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = readTableDirectory(view);
  const table = (tag: string) => {
    const record = tables.get(tag);
    if (!record) {
      throw new Error(`The font has no ${tag} table`);
    }
    return record;
  };

  const unitsPerEm = view.getUint16(table('head').offset + 18);
  const numberOfHMetrics = view.getUint16(table('hhea').offset + 34);
  if (unitsPerEm === 0 || numberOfHMetrics === 0) {
    throw new Error('The font has no glyph metrics');
  }

  const hmtx = table('hmtx').offset;
  // Glyphs past numberOfHMetrics share the last advance width
  const advanceOf = (glyph: number) =>
    view.getUint16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1)) /
    unitsPerEm;

  const glyphs = readCharacterMap(view, table('cmap'));
  return {
    advance(codePoint) {
      const glyph = glyphs.get(codePoint);
      // glyph 0 is .notdef, the box drawn for a missing character
      return glyph ? advanceOf(glyph) : undefined;
    },
  };
}

function readTableDirectory(view: DataView) {
  const numTables = view.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + 16 * i;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    tables.set(tag, { offset: view.getUint32(record + 8) });
  }
  return tables;
}

// Unicode subtables, full repertoire (format 12) before the Basic Multilingual
// Plane alone (format 4)
const PreferredEncodings: [platformId: number, encodingId: number][] = [
  [3, 10],
  [0, 4],
  [0, 6],
  [3, 1],
  [0, 3],
];

function readCharacterMap(view: DataView, cmap: TableRecord) {
  const numSubtables = view.getUint16(cmap.offset + 2);
  const subtables = new Map<string, number>();
  for (let i = 0; i < numSubtables; i++) {
    const record = cmap.offset + 4 + 8 * i;
    const key = `${view.getUint16(record)}/${view.getUint16(record + 2)}`;
    subtables.set(key, cmap.offset + view.getUint32(record + 4));
  }

  for (const [platformId, encodingId] of PreferredEncodings) {
    const offset = subtables.get(`${platformId}/${encodingId}`);
    if (offset === undefined) {
      continue;
    }
    switch (view.getUint16(offset)) {
      case 4:
        return readFormat4(view, offset);
      case 12:
        return readFormat12(view, offset);
    }
  }
  throw new Error('The font has no Unicode character map');
}

// Segment mapping to delta values: the Basic Multilingual Plane
function readFormat4(view: DataView, offset: number) {
  const glyphs = new Map<number, number>();
  const segCount = view.getUint16(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + 2 * segCount + 2;
  const idDeltas = startCodes + 2 * segCount;
  const idRangeOffsets = idDeltas + 2 * segCount;

  for (let i = 0; i < segCount; i++) {
    const start = view.getUint16(startCodes + 2 * i);
    const end = view.getUint16(endCodes + 2 * i);
    const delta = view.getInt16(idDeltas + 2 * i);
    const rangeOffsetAt = idRangeOffsets + 2 * i;
    const rangeOffset = view.getUint16(rangeOffsetAt);
    // the last segment maps 0xFFFF to .notdef
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const raw = view.getUint16(
          rangeOffsetAt + rangeOffset + 2 * (code - start),
        );
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) {
        glyphs.set(code, glyph);
      }
    }
  }
  return glyphs;
}

// Segmented coverage: every plane
function readFormat12(view: DataView, offset: number) {
  const glyphs = new Map<number, number>();
  const numGroups = view.getUint32(offset + 12);
  for (let i = 0; i < numGroups; i++) {
    const group = offset + 16 + 12 * i;
    const start = view.getUint32(group);
    const end = view.getUint32(group + 4);
    const startGlyph = view.getUint32(group + 8);
    for (let code = start; code <= end; code++) {
      const glyph = startGlyph + (code - start);
      if (glyph !== 0) {
        glyphs.set(code, glyph);
      }
    }
  }
  return glyphs;
}
