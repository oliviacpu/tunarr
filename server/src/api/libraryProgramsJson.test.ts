import { describe, expect, test, vi } from 'vitest';
import { nextPageSize, pagedJsonArray } from './libraryProgramsJson.ts';

type Row = { uuid: string; n: number };

const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({
  uuid: `id-${String(i).padStart(2, '0')}`,
  n: i,
}));

/** Rows after `afterUuid` in uuid order, like the paged library query. */
function readPageFrom(all: Row[]) {
  return vi.fn((afterUuid: string | undefined, limit: number) =>
    Promise.resolve(
      all
        .filter((r) => afterUuid === undefined || r.uuid > afterUuid)
        .slice(0, limit),
    ),
  );
}

/** Options for pages of exactly `n` rows, so the page size doesn't adapt. */
function fixedPages(n: number) {
  return { pageSize: n, minPageSize: n, maxPageSize: n };
}

const toItems = (page: Row[]) =>
  Promise.resolve(page.map((r) => ({ id: r.uuid, n: r.n })));
const encode = (items: unknown[]) => items;

describe('pagedJsonArray', () => {
  test('across page boundaries, the text equals stringifying everything at once', async () => {
    const readPage = readPageFrom(rows);
    const json = await pagedJsonArray(readPage, toItems, encode, {
      ...fixedPages(3),
      yieldToEventLoop: () => Promise.resolve(),
    });

    expect(json).toBe(JSON.stringify(await toItems(rows)));
    // 3 + 3 + 1 rows: the short last page ends it without another read
    expect(readPage.mock.calls).toEqual([
      [undefined, 3],
      ['id-02', 3],
      ['id-05', 3],
    ]);
  });

  test('a library that fills its last page exactly reads one empty page to finish', async () => {
    const readPage = readPageFrom(rows.slice(0, 6));
    const json = await pagedJsonArray(readPage, toItems, encode, {
      ...fixedPages(3),
      yieldToEventLoop: () => Promise.resolve(),
    });

    expect(JSON.parse(json)).toHaveLength(6);
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  test('an empty library is an empty array', async () => {
    await expect(
      pagedJsonArray(readPageFrom([]), toItems, encode),
    ).resolves.toBe('[]');
  });

  // The whole point: other requests (and the streams) get the event loop
  // between pages, and between each page's read, conversion and encoding.
  test('yields to the event loop between pages and between stages', async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await pagedJsonArray(readPageFrom(rows), toItems, encode, {
      ...fixedPages(3),
      yieldToEventLoop,
    });

    // 3 pages x 2 stage yields, plus 2 between pages
    expect(yieldToEventLoop).toHaveBeenCalledTimes(8);
  });

  test('a page whose rows all convert to nothing adds nothing', async () => {
    const json = await pagedJsonArray(
      readPageFrom(rows),
      (page) => toItems(page.filter((r) => r.n >= 3)),
      encode,
      { ...fixedPages(3), yieldToEventLoop: () => Promise.resolve() },
    );

    expect(JSON.parse(json)).toEqual(
      rows.filter((r) => r.n >= 3).map((r) => ({ id: r.uuid, n: r.n })),
    );
  });

  // Production's server is slower and shared: pages that block for ~20 ms on a
  // laptop could block for far longer there, so the size follows the time.
  test('shrinks the pages while reads block longer than the target', async () => {
    let clock = 0;
    const all = Array.from({ length: 40 }, (_, i) => ({
      uuid: `id-${String(i).padStart(2, '0')}`,
      n: i,
    }));
    const readPage = vi.fn((afterUuid: string | undefined, limit: number) => {
      const page = all
        .filter((r) => afterUuid === undefined || r.uuid > afterUuid)
        .slice(0, limit);
      clock += page.length * 10; // 10 ms of blocking per row
      return Promise.resolve(page);
    });

    const json = await pagedJsonArray(readPage, toItems, encode, {
      pageSize: 8,
      minPageSize: 2,
      maxPageSize: 16,
      targetBlockMs: 30,
      now: () => clock,
      yieldToEventLoop: () => Promise.resolve(),
    });

    expect(JSON.parse(json)).toHaveLength(40);
    // 8 rows took 80 ms, 4 took 40 ms, then 2 rows (20 ms) is within target
    expect(readPage.mock.calls.slice(0, 4).map(([, limit]) => limit)).toEqual([
      8, 4, 2, 2,
    ]);
  });
});

describe('nextPageSize', () => {
  const limits = { minPageSize: 10, maxPageSize: 100, targetBlockMs: 30 };

  test('halves after a read that blocked longer than the target, down to the minimum', () => {
    expect(nextPageSize(40, 45, limits)).toBe(20);
    expect(nextPageSize(15, 200, limits)).toBe(10);
  });

  test('doubles after a read well under the target, up to the maximum', () => {
    expect(nextPageSize(25, 5, limits)).toBe(50);
    expect(nextPageSize(80, 1, limits)).toBe(100);
  });

  test('keeps the size within the target band', () => {
    expect(nextPageSize(25, 20, limits)).toBe(25);
    expect(nextPageSize(25, 30, limits)).toBe(25);
  });
});
