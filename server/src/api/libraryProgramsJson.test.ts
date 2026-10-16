import { once } from 'node:events';
import { Writable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  jsonChunkStream,
  nextPageSize,
  pagedJsonArray,
} from './libraryProgramsJson.ts';

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
const noWait = () => Promise.resolve();

async function chunksOf(chunks: AsyncIterable<string>): Promise<string[]> {
  const all: string[] = [];
  for await (const chunk of chunks) {
    all.push(chunk);
  }
  return all;
}

async function textOf(chunks: AsyncIterable<string>): Promise<string> {
  return (await chunksOf(chunks)).join('');
}

describe('pagedJsonArray', () => {
  test('across page boundaries, the text equals stringifying everything at once', async () => {
    const readPage = readPageFrom(rows);
    const json = await textOf(
      pagedJsonArray(readPage, toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop: noWait,
      }),
    );

    expect(json).toBe(JSON.stringify(await toItems(rows)));
    // 3 + 3 + 1 rows: the short last page ends it without another read
    expect(readPage.mock.calls).toEqual([
      [undefined, 3],
      ['id-02', 3],
      ['id-05', 3],
    ]);
  });

  // Each page is sent and dropped on its own: joining them made one 185 MB
  // string on production, and building and sending it froze the server.
  test('each page is its own chunk', async () => {
    const chunks = await chunksOf(
      pagedJsonArray(readPageFrom(rows), toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop: noWait,
      }),
    );

    const items = await toItems(rows);
    const pageText = (from: number, to: number) =>
      JSON.stringify(items.slice(from, to)).slice(1, -1);
    expect(chunks).toEqual([
      `[${pageText(0, 3)}`,
      `,${pageText(3, 6)}`,
      `,${pageText(6, 7)}`,
      ']',
    ]);
  });

  test('a library that fills its last page exactly reads one empty page to finish', async () => {
    const readPage = readPageFrom(rows.slice(0, 6));
    const json = await textOf(
      pagedJsonArray(readPage, toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop: noWait,
      }),
    );

    expect(JSON.parse(json)).toHaveLength(6);
    expect(readPage).toHaveBeenCalledTimes(3);
  });

  test('an empty library is an empty array', async () => {
    await expect(
      chunksOf(pagedJsonArray(readPageFrom([]), toItems, encode)),
    ).resolves.toEqual(['[]']);
  });

  // Nothing is sent before the first page is built, so the route can still
  // answer with an error status.
  test('a failure in the first page comes before any chunk', async () => {
    const chunks = pagedJsonArray(
      () => Promise.reject(new Error('database is locked')),
      toItems,
      encode,
      { yieldToEventLoop: noWait },
    );

    await expect(chunks.next()).rejects.toThrow('database is locked');
  });

  test('a failure in a later page comes after the earlier pages', async () => {
    const readPage = readPageFrom(rows);
    readPage.mockImplementationOnce((_afterUuid, limit) =>
      Promise.resolve(rows.slice(0, limit)),
    );
    readPage.mockRejectedValueOnce(new Error('database is locked'));
    const chunks = pagedJsonArray(readPage, toItems, encode, {
      ...fixedPages(3),
      yieldToEventLoop: noWait,
    });

    await expect(chunks.next()).resolves.toMatchObject({ done: false });
    await expect(chunks.next()).rejects.toThrow('database is locked');
  });

  // A client that disconnects shouldn't leave the server building the rest.
  test('reads no further pages once the consumer stops', async () => {
    const readPage = readPageFrom(rows);
    const chunks = pagedJsonArray(readPage, toItems, encode, {
      ...fixedPages(3),
      yieldToEventLoop: noWait,
    });

    await chunks.next();
    await chunks.return();

    expect(readPage).toHaveBeenCalledTimes(1);
  });

  // The whole point: other requests (and the streams) get the event loop
  // between pages, and between each page's read, conversion and encoding.
  test('yields to the event loop between pages and between stages', async () => {
    const yieldToEventLoop = vi.fn(() => Promise.resolve());
    await chunksOf(
      pagedJsonArray(readPageFrom(rows), toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop,
      }),
    );

    // 3 pages x 2 stage yields, plus 2 between pages
    expect(yieldToEventLoop).toHaveBeenCalledTimes(8);
  });

  test('a page whose rows all convert to nothing adds nothing', async () => {
    const json = await textOf(
      pagedJsonArray(
        readPageFrom(rows),
        (page) => toItems(page.filter((r) => r.n >= 3)),
        encode,
        { ...fixedPages(3), yieldToEventLoop: noWait },
      ),
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

    const json = await textOf(
      pagedJsonArray(readPage, toItems, encode, {
        pageSize: 8,
        minPageSize: 2,
        maxPageSize: 16,
        targetBlockMs: 30,
        now: () => clock,
        yieldToEventLoop: noWait,
      }),
    );

    expect(JSON.parse(json)).toHaveLength(40);
    // 8 rows took 80 ms, 4 took 40 ms, then 2 rows (20 ms) is within target
    expect(readPage.mock.calls.slice(0, 4).map(([, limit]) => limit)).toEqual([
      8, 4, 2, 2,
    ]);
  });
});

describe('jsonChunkStream', () => {
  // Pages of about 100 KB, each bigger than a stream's buffer
  const bigRows = Array.from({ length: 20 }, (_, i) => ({
    uuid: `id-${String(i).padStart(2, '0')}`,
    n: i,
    text: 'x'.repeat(100_000),
  }));
  const asItems = (page: typeof bigRows) => Promise.resolve(page);

  test('sends the same text as the chunks', async () => {
    const stream = jsonChunkStream(
      pagedJsonArray(readPageFrom(rows), toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop: noWait,
      }),
    );
    let text = '';
    for await (const chunk of stream) {
      text += String(chunk);
    }

    expect(text).toBe(JSON.stringify(await toItems(rows)));
  });

  test('a client that stops reading holds the next pages back', async () => {
    const readPage = readPageFrom(bigRows);
    // Takes the first write and never finishes it, like a stalled socket
    const stalledClient = new Writable({ write() {} });
    jsonChunkStream(
      pagedJsonArray(readPage, asItems, encode, {
        ...fixedPages(1),
        yieldToEventLoop: noWait,
      }),
    ).pipe(stalledClient);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The page being written, one buffered, and at most one being built
    expect(readPage.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test('a closed stream reads no further pages', async () => {
    let releaseSecondPage = () => {};
    const readPage = readPageFrom(rows);
    const realRead = readPage.getMockImplementation();
    if (realRead === undefined) {
      throw new Error('readPageFrom has an implementation');
    }
    readPage.mockImplementation((afterUuid, limit) =>
      afterUuid === undefined
        ? realRead(afterUuid, limit)
        : new Promise((resolve) => {
            releaseSecondPage = () => resolve(realRead(afterUuid, limit));
          }),
    );
    const stream = jsonChunkStream(
      pagedJsonArray(readPage, toItems, encode, {
        ...fixedPages(3),
        yieldToEventLoop: noWait,
      }),
    );
    stream.resume();
    await vi.waitFor(() => expect(readPage).toHaveBeenCalledTimes(2));

    // The client disconnects while the second page is being read
    stream.destroy();
    releaseSecondPage();
    await once(stream, 'close');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(readPage).toHaveBeenCalledTimes(2);
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
