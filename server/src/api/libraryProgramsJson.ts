import type { ContentProgram, TerminalProgram } from '@tunarr/types';
import { ContentProgramSchema } from '@tunarr/types/schemas';
import type { FastifyReply } from 'fastify';
import { last } from 'lodash-es';
import z from 'zod/v4';
import throttle from '../util/throttle.ts';

const ContentProgramsSchema = z.array(ContentProgramSchema);

/**
 * Encodes one page the way the Zod type provider's serializer encodes a whole
 * response: the same schema, so unknown keys are stripped as before.
 */
function encodeContentPrograms(items: ContentProgram[]): unknown {
  const result = z.safeEncode(ContentProgramsSchema, items);
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

export type PageSizeLimits = {
  minPageSize: number;
  maxPageSize: number;
  /** How long one page's read should block the event loop, roughly. */
  targetBlockMs: number;
};

/**
 * The next page's size, from how long the last page's read blocked: halved
 * when it took longer than the target, doubled when it took under half of it.
 * The read dominates a page's cost and scales with its rows, so this settles
 * on pages that block about `targetBlockMs` on whatever machine runs it: big
 * pages on a fast one, small ones on a slow or busy one.
 */
export function nextPageSize(
  current: number,
  blockedMs: number,
  { minPageSize, maxPageSize, targetBlockMs }: PageSizeLimits,
): number {
  if (blockedMs > targetBlockMs) {
    return Math.max(minPageSize, Math.floor(current / 2));
  }
  if (blockedMs < targetBlockMs / 2) {
    return Math.min(maxPageSize, current * 2);
  }
  return current;
}

export type PagedJsonArrayOptions = Partial<PageSizeLimits> & {
  /** Rows in the first page; later pages adapt (see {@link nextPageSize}). */
  pageSize?: number;
  yieldToEventLoop?: () => Promise<void>;
  now?: () => number;
};

/**
 * A JSON array built a page at a time, yielding to the event loop between
 * pages and between the stages of each page.
 *
 * better-sqlite3 is synchronous, and converting, encoding and stringifying are
 * CPU work on the main thread, which also serves the streams. For a large
 * result in one go that adds up to a long freeze: a 5,000-episode library
 * froze Tunarr for about 17 s and paused Live TV (2026-10-15). Paging bounds
 * each piece of work. The text is the same as stringifying the whole encoded
 * array at once, since `JSON.stringify` of an array is its items' JSON joined
 * by commas, inside brackets.
 *
 * `readPage` returns the rows after `afterUuid` in uuid order; `toItems` may
 * drop rows; `encode` turns a page of items into the value to stringify (an
 * array).
 */
export async function pagedJsonArray<Row extends { uuid: string }, Item>(
  readPage: (afterUuid: string | undefined, limit: number) => Promise<Row[]>,
  toItems: (rows: Row[]) => Promise<Item[]>,
  encode: (items: Item[]) => unknown,
  {
    pageSize: firstPageSize = 25,
    minPageSize = 10,
    maxPageSize = 100,
    targetBlockMs = 30,
    yieldToEventLoop = throttle,
    now = () => performance.now(),
  }: PagedJsonArrayOptions = {},
): Promise<string> {
  const limits = { minPageSize, maxPageSize, targetBlockMs };
  const parts: string[] = [];
  let afterUuid: string | undefined;
  let pageSize = firstPageSize;
  for (;;) {
    const readStarted = now();
    const rows = await readPage(afterUuid, pageSize);
    const readMs = now() - readStarted;
    const lastRow = last(rows);
    if (lastRow === undefined) {
      break;
    }
    afterUuid = lastRow.uuid;
    // Between the stages too: on a slow or busy server one page's query,
    // conversion and encoding together still add up.
    await yieldToEventLoop();
    const items = await toItems(rows);
    await yieldToEventLoop();

    const json = JSON.stringify(encode(items));
    if (json.length > 2) {
      parts.push(json.slice(1, -1));
    }

    if (rows.length < pageSize) {
      break;
    }
    pageSize = nextPageSize(pageSize, readMs, limits);
    await yieldToEventLoop();
  }
  return `[${parts.join(',')}]`;
}

export type LibraryProgramsSource<Row extends { uuid: string }> = {
  /** The rows after `afterUuid` in uuid order, at most `limit` of them. */
  readPage(afterUuid: string | undefined, limit: number): Promise<Row[]>;
  /** API programs for the rows; rows that can't be converted are left out. */
  materialize(rows: Row[]): Promise<TerminalProgram[]>;
  toContentProgram(program: TerminalProgram): ContentProgram;
};

/**
 * The body of `GET /api/media-libraries/:libraryId/programs`: the library's
 * programs as content programs, encoded with the route's response schema, a
 * page at a time (see {@link pagedJsonArray}).
 */
export function libraryProgramsJson<Row extends { uuid: string }>(
  source: LibraryProgramsSource<Row>,
  options?: PagedJsonArrayOptions,
): Promise<string> {
  return pagedJsonArray(
    (afterUuid, limit) => source.readPage(afterUuid, limit),
    async (rows) =>
      (await source.materialize(rows)).map((program) =>
        source.toContentProgram(program),
      ),
    encodeContentPrograms,
    options,
  );
}

/**
 * Sends a body that is already JSON text. Fastify sends a string with a JSON
 * content type as is, so the route's response serializer (which would encode
 * and stringify the whole body again, in one go) doesn't run.
 */
export function sendJsonText(reply: FastifyReply, json: string): FastifyReply {
  return reply.type('application/json; charset=utf-8').send(json);
}
