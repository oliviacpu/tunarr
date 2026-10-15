import { isNodeError } from '@/util/index.js';
import type { Dayjs } from 'dayjs';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import type {
  HlsPlaylistFilterOptions,
  MutateOptions,
  TrimPlaylistResult,
} from './HlsPlaylistMutator.ts';
import { HlsPlaylistMutator } from './HlsPlaylistMutator.ts';
import { MediaPlaylistIndex } from './MediaPlaylistIndex.ts';

// The header is a few hundred bytes. More is read when it is longer.
const HeadReadBytes = 4096;
// Bytes compared at each end of the parsed part, about two entries
const AnchorBytes = 256;
const ExtInf = Buffer.from('#EXTINF:');
const NewlineExtInf = Buffer.from('\n#EXTINF:');
const Newline = 0x0a;

export type MediaPlaylistReaderStats = {
  // Reads that parsed the whole body
  fullParses: number;
  // Reads that parsed only what was appended since the previous read
  incrementalReads: number;
  // Lines handed to the parser
  parsedLines: number;
};

/**
 * Trims an HLS session's media playlist the way HlsPlaylistMutator.trimPlaylist
 * trims the whole file, but parses only what ffmpeg appended since the last
 * read.
 *
 * Every program's ffmpeg rewrites the whole playlist (hls_list_size 0,
 * append_list) with its in-memory list of every segment so far, so the file
 * grows for as long as the session runs. Parsing all of it on every request
 * made each request slower the longer the channel was watched. ffmpeg leaves
 * the entries it already wrote unchanged, and only its header (before the
 * first #EXTINF line) changes, when a new process starts. So this keeps the
 * parsed entries and the body bytes they came from, and on each read checks
 * that the body still starts and continues with those bytes before parsing
 * the rest. When it doesn't (the file shrank or was rewritten), it parses the
 * whole file again.
 */
export class MediaPlaylistReader {
  #mutator = new HlsPlaylistMutator();
  #index: MediaPlaylistIndex | undefined;
  // Length of the body prefix (from the first #EXTINF line) parsed into #index
  #parsedBytes = 0;
  // The first and last (up to) AnchorBytes of that prefix
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  #stats: MediaPlaylistReaderStats = {
    fullParses: 0,
    incrementalReads: 0,
    parsedLines: 0,
  };

  constructor(private readonly path: string) {}

  get stats(): Readonly<MediaPlaylistReaderStats> {
    return this.#stats;
  }

  /**
   * The trimmed playlist, as HlsPlaylistMutator.trimPlaylist returns it for
   * the file's current contents. Undefined when the file doesn't exist.
   */
  async trim(
    start: Dayjs | undefined,
    filter: HlsPlaylistFilterOptions,
    opts: MutateOptions,
  ): Promise<TrimPlaylistResult | undefined> {
    let handle: FileHandle;
    try {
      handle = await fs.open(this.path, 'r');
    } catch (e) {
      if (isNodeError(e) && e.code === 'ENOENT') {
        return;
      }
      throw e;
    }

    // One handle for every read: ffmpeg replaces the playlist by renaming a
    // new file over it, so the reads all see the same version.
    try {
      if (start === undefined) {
        throw new Error('The HLS playlist has no start time yet');
      }
      const { size } = await handle.stat();
      const index = await this.#update(handle, size, start, false);
      const result = this.#trimLatest(index, filter, opts);
      if (result !== undefined) {
        return result;
      }
      // The filter reaches back past what the index has discarded
      const fullIndex = await this.#update(handle, size, start, true);
      const fullResult = this.#trimLatest(fullIndex, filter, opts);
      if (fullResult === undefined) {
        throw new Error('A playlist parsed whole has no discarded segments');
      }
      return fullResult;
    } finally {
      await handle.close();
    }
  }

  /**
   * Forgets segments numbered below `segmentNumber`, except the newest
   * `keep`, so a long session holds only the ones it can still list. A later
   * trim whose filter reaches below parses the whole file again.
   */
  discardSegmentsBelow(segmentNumber: number, keep: number) {
    this.#index?.discardSegmentsBelow(segmentNumber, keep);
  }

  // Trims the parsed entries plus the file's unfinished last line, if any,
  // which is parsed for this read only
  #trimLatest(
    { index, rest }: { index: MediaPlaylistIndex; rest: string[] },
    filter: HlsPlaylistFilterOptions,
    opts: MutateOptions,
  ) {
    // Usually the empty string after the final newline
    if (rest.length === 0 || (rest.length === 1 && rest[0] === '')) {
      return this.#mutator.trimIndex(index, filter, opts);
    }
    const savepoint = index.savepoint();
    try {
      index.parseLines(rest, 0, true);
      return this.#mutator.trimIndex(index, filter, opts);
    } finally {
      index.rollback(savepoint);
    }
  }

  // Brings #index up to date with the file. `rest` holds the lines after the
  // last complete entry, which may still be growing.
  async #update(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    forceFullParse: boolean,
  ): Promise<{ index: MediaPlaylistIndex; rest: string[] }> {
    try {
      return await this.#updateIndex(handle, size, start, forceFullParse);
    } catch (e) {
      // The index may no longer match #parsedBytes. Start over next time.
      this.#index = undefined;
      throw e;
    }
  }

  async #updateIndex(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    forceFullParse: boolean,
  ): Promise<{ index: MediaPlaylistIndex; rest: string[] }> {
    const head = await findBody(handle, size);
    if (head === undefined) {
      // No entries yet
      this.#reset(start);
      return { index: this.#requireIndex(), rest: [] };
    }

    const { bodyStart } = head;
    let from = 0;
    let chunk: Buffer | undefined;
    if (
      !forceFullParse &&
      this.#index !== undefined &&
      this.#index.start.valueOf() === start.valueOf() &&
      bodyStart + this.#parsedBytes <= size &&
      (await this.#headMatches(handle, head))
    ) {
      // Read the tail anchor and everything after it in one go
      const tailStart = bodyStart + this.#parsedBytes - this.#tail.length;
      const bytes = await readRange(handle, tailStart, size);
      if (bytes.subarray(0, this.#tail.length).equals(this.#tail)) {
        from = this.#parsedBytes;
        chunk = bytes.subarray(this.#tail.length);
      }
    }

    if (chunk === undefined) {
      this.#reset(start);
      chunk = await readRange(handle, bodyStart, size);
      this.#stats.fullParses++;
    } else {
      this.#stats.incrementalReads++;
    }

    const index = this.#requireIndex();
    const lines = chunk.toString('utf-8').split('\n');
    this.#stats.parsedLines += lines.length;
    const parsedLines = index.parseLines(lines, 0, false);
    const parsedBytes = byteOffsetOfLine(chunk, parsedLines);
    this.#remember(chunk.subarray(0, parsedBytes), from);
    return { index, rest: lines.slice(parsedLines) };
  }

  #reset(start: Dayjs) {
    this.#index = new MediaPlaylistIndex(start);
    this.#parsedBytes = 0;
    this.#head = Buffer.alloc(0);
    this.#tail = Buffer.alloc(0);
  }

  #requireIndex() {
    if (this.#index === undefined) {
      throw new Error('The playlist index was not set up');
    }
    return this.#index;
  }

  async #headMatches(
    handle: FileHandle,
    { bodyStart, bytes }: { bodyStart: number; bytes: Buffer },
  ) {
    const end = bodyStart + this.#head.length;
    const current =
      end <= bytes.length
        ? bytes.subarray(bodyStart, end)
        : await readRange(handle, bodyStart, end);
    return current.equals(this.#head);
  }

  // Records body bytes [from, from + parsed.length) as parsed
  #remember(parsed: Buffer, from: number) {
    if (parsed.length === 0) {
      return;
    }
    this.#parsedBytes = from + parsed.length;
    if (this.#head.length < AnchorBytes) {
      this.#head = Buffer.concat([
        this.#head,
        parsed.subarray(0, AnchorBytes - this.#head.length),
      ]);
    }
    const joined =
      parsed.length >= AnchorBytes
        ? parsed
        : Buffer.concat([this.#tail, parsed]);
    // A copy, so the anchor doesn't hold on to the whole read
    this.#tail = Buffer.from(
      joined.subarray(Math.max(0, joined.length - AnchorBytes)),
    );
  }
}

// Where the playlist body starts: the first line that begins with #EXTINF:.
// Undefined when there is none.
async function findBody(handle: FileHandle, size: number) {
  let length = Math.min(size, HeadReadBytes);
  for (;;) {
    const bytes = await readRange(handle, 0, length);
    if (bytes.subarray(0, ExtInf.length).equals(ExtInf)) {
      return { bodyStart: 0, bytes };
    }
    const at = bytes.indexOf(NewlineExtInf);
    if (at >= 0) {
      return { bodyStart: at + 1, bytes };
    }
    if (bytes.length < length || length >= size) {
      return;
    }
    length = Math.min(size, length * 2);
  }
}

// The byte offset just after the `lineCount`th newline
function byteOffsetOfLine(bytes: Buffer, lineCount: number) {
  let offset = 0;
  for (let line = 0; line < lineCount; line++) {
    const newline = bytes.indexOf(Newline, offset);
    if (newline < 0) {
      throw new Error('A parsed playlist line has no newline');
    }
    offset = newline + 1;
  }
  return offset;
}

// Bytes [start, end) of the file, fewer if it ends sooner
async function readRange(handle: FileHandle, start: number, end: number) {
  const buffer = Buffer.alloc(Math.max(0, end - start));
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      filled,
      buffer.length - filled,
      start + filled,
    );
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}
