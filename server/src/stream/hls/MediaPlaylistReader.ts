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
import { MediaPlaylistIndex, segmentNumberOf } from './MediaPlaylistIndex.ts';

// The header is a few hundred bytes. More is read when it is longer.
const HeadReadBytes = 4096;
// Bytes compared at each end of the parsed part, about two entries
const AnchorBytes = 256;
// The end of a windowed playlist read to find the last segment parsed: about
// 14 entries, more than ffmpeg adds between two playlist requests. The whole
// window is read when it isn't there.
const TailReadBytes = 2048;
const ExtInf = Buffer.from('#EXTINF:');
const NewlineExtInf = Buffer.from('\n#EXTINF:');
const Newline = 0x0a;
const MediaSequenceTag = /^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m;

export type MediaPlaylistReaderStats = {
  // Reads that parsed the whole body into a new index
  fullParses: number;
  // Reads that continued the index, parsing only the entries added since
  // the previous read. A windowed read may still scan the whole window to
  // find where they start.
  incrementalReads: number;
  // Lines handed to the parser
  parsedLines: number;
  // Reads of a window that skipped segment numbers never parsed
  gaps: number;
  // Trims whose filter reached segments that neither the index nor the file
  // still holds, served from the kept segments
  clampedTrims: number;
};

export type MediaPlaylistReaderLogger = {
  warn(message: string, ...args: unknown[]): void;
};

type IndexUpdate = {
  index: MediaPlaylistIndex;
  // The lines after the last complete entry, which may still be growing
  rest: string[];
  // Whether the file's first entry is past the session's first segment
  // (#EXT-X-MEDIA-SEQUENCE above 0), so it no longer lists the whole session
  windowed: boolean;
};

type PlaylistHead = { bodyStart: number; bytes: Buffer };

/**
 * Trims an HLS session's media playlist the way HlsPlaylistMutator.trimPlaylist
 * trims the whole session's playlist, but parses only what ffmpeg appended
 * since the last read, and keeps the session's history itself.
 *
 * Every program's ffmpeg rewrites the whole playlist (append_list) from its
 * in-memory list of segments. Two cases:
 *
 * - While the file starts at the session's first segment
 *   (#EXT-X-MEDIA-SEQUENCE 0, always so with hls_list_size 0), ffmpeg leaves
 *   the entries it already wrote unchanged, and only its header (before the
 *   first #EXTINF line) changes, when a new process starts. So this keeps the
 *   parsed entries and the body bytes they came from, and on each read checks
 *   that the body still starts and continues with those bytes before parsing
 *   the rest. When it doesn't (the file shrank or was rewritten), it parses
 *   the whole file again.
 * - Once ffmpeg drops its oldest entries (a bounded hls_list_size), the file
 *   is a window: #EXT-X-MEDIA-SEQUENCE is its first entry's number, ffmpeg
 *   writes no #EXT-X-DISCONTINUITY-SEQUENCE, and a dropped entry's
 *   discontinuity tag leaves the file with it. Parsing the window again would
 *   lose the session's earlier start times and discontinuities, so this
 *   anchors on segment numbers instead: it finds the last segment it parsed
 *   near the end of the file, keeps the entries it already has, and appends
 *   only the ones after it. A discontinuity tag counts only between a known
 *   entry and a new one. When the numbering skips segments it never parsed,
 *   it logs a warning and counts one discontinuity and their estimated time.
 */
export class MediaPlaylistReader {
  #mutator = new HlsPlaylistMutator();
  #index: MediaPlaylistIndex | undefined;
  // Whether the byte anchors below describe #index. A windowed read parses
  // by segment number and leaves them stale.
  #byteAnchored = false;
  // Length of the body prefix (from the first #EXTINF line) parsed into #index
  #parsedBytes = 0;
  // The first and last (up to) AnchorBytes of that prefix
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  #stats: MediaPlaylistReaderStats = {
    fullParses: 0,
    incrementalReads: 0,
    parsedLines: 0,
    gaps: 0,
    clampedTrims: 0,
  };

  constructor(
    private readonly path: string,
    private readonly logger?: MediaPlaylistReaderLogger,
  ) {}

  get stats(): Readonly<MediaPlaylistReaderStats> {
    return this.#stats;
  }

  /**
   * The trimmed playlist, as HlsPlaylistMutator.trimPlaylist returns it for
   * the whole session's playlist. Undefined when the file doesn't exist.
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
      const update = await this.#update(handle, size, start, opts, false);
      const result = this.#trimLatest(update, filter, opts);
      if (result !== undefined) {
        return result;
      }
      // The filter reaches back past what the index has discarded
      if (update.windowed) {
        // Parsing a window again can't rebuild their start times and
        // discontinuities, which came from entries it no longer lists. And
        // HlsSession discards only segments below its pruning floor, whose
        // files are deleted. So list from the segments the index kept.
        this.#stats.clampedTrims++;
        const clamped = this.#trimLatest(update, filter, opts, true);
        if (clamped === undefined) {
          throw new Error('A clamped trim selected a discarded segment');
        }
        return clamped;
      }
      const fullUpdate = await this.#update(handle, size, start, opts, true);
      const fullResult = this.#trimLatest(fullUpdate, filter, opts);
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
   * trim whose filter reaches below parses the whole file again while it
   * lists the whole session, and lists from the kept segments once it is a
   * window.
   */
  discardSegmentsBelow(segmentNumber: number, keep: number) {
    this.#index?.discardSegmentsBelow(segmentNumber, keep);
  }

  // Trims the parsed entries plus the file's unfinished last line, if any,
  // which is parsed for this read only
  #trimLatest(
    { index, rest }: IndexUpdate,
    filter: HlsPlaylistFilterOptions,
    opts: MutateOptions,
    clampToKept = false,
  ) {
    // Usually the empty string after the final newline
    if (rest.length === 0 || (rest.length === 1 && rest[0] === '')) {
      return this.#mutator.trimIndex(index, filter, opts, { clampToKept });
    }
    const savepoint = index.savepoint();
    try {
      index.parseLines(rest, 0, true);
      return this.#mutator.trimIndex(index, filter, opts, { clampToKept });
    } finally {
      index.rollback(savepoint);
    }
  }

  // Brings #index up to date with the file
  async #update(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    opts: MutateOptions,
    forceFullParse: boolean,
  ): Promise<IndexUpdate> {
    try {
      return await this.#updateIndex(handle, size, start, opts, forceFullParse);
    } catch (e) {
      // A byte-anchored index may no longer match #parsedBytes: start over
      // next time. A windowed read changes the index only once its reads
      // succeed, and a window can't rebuild the history, so it is kept.
      if (this.#byteAnchored) {
        this.#index = undefined;
      }
      throw e;
    }
  }

  async #updateIndex(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    opts: MutateOptions,
    forceFullParse: boolean,
  ): Promise<IndexUpdate> {
    const head = await findBody(handle, size);
    if (head === undefined) {
      const index = this.#continuableIndex(start);
      if (!this.#byteAnchored && index?.lastSegment !== undefined) {
        // A window with no entries can't take back what was listed
        return { index, rest: [], windowed: true };
      }
      // No entries yet
      this.#reset(start);
      return { index: this.#requireIndex(), rest: [], windowed: false };
    }

    const mediaSequence = parseMediaSequence(
      head.bytes.subarray(0, head.bodyStart),
    );
    if (mediaSequence > 0) {
      return await this.#updateFromWindow(
        handle,
        size,
        start,
        head,
        mediaSequence,
        opts.targetDuration,
      );
    }

    const { bodyStart } = head;
    let from = 0;
    let chunk: Buffer | undefined;
    if (
      !forceFullParse &&
      this.#byteAnchored &&
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
    return { index, rest: lines.slice(parsedLines), windowed: false };
  }

  // Continues the index after the last segment it parsed, from a file that
  // lists only ffmpeg's newest entries
  async #updateFromWindow(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    head: PlaylistHead,
    mediaSequence: number,
    targetDuration: number,
  ): Promise<IndexUpdate> {
    const index = this.#continuableIndex(start);
    const last = index?.lastSegment;
    // Tunarr names every segment with its number (data%06d.ts)
    const lastNumber =
      last?.line === undefined ? null : segmentNumberOf(last.line);
    if (index === undefined || lastNumber === null) {
      return await this.#parseWindow(
        handle,
        size,
        start,
        head,
        mediaSequence,
        targetDuration,
        'no earlier segment was read',
      );
    }
    this.#byteAnchored = false;

    // The last segment parsed is usually among the last few entries
    let from = Math.max(head.bodyStart, size - TailReadBytes);
    for (;;) {
      const chunk = await readFrom(handle, head, from, size);
      const lines = chunk.toString('utf-8').split('\n');
      // The first line may be cut off, unless the read starts at the body
      const {
        from: after,
        boundary,
        next,
      } = MediaPlaylistIndex.findContinuation(
        lines,
        from > head.bodyStart ? 1 : 0,
        lastNumber,
      );
      if (after === undefined && from > head.bodyStart) {
        from = head.bodyStart;
        continue;
      }

      if (next === undefined && boundary !== lastNumber) {
        if (boundary === undefined || boundary === lastNumber - 1) {
          // No complete entry, or the last one read is cut off: a partial
          // write. Nothing is new, and what was listed stays listed.
          this.#stats.incrementalReads++;
          return { index, rest: [], windowed: true };
        }
        // Every entry is older than the last one read
        return await this.#parseWindow(
          handle,
          size,
          start,
          head,
          mediaSequence,
          targetDuration,
          `it lists nothing after segment ${boundary}, and segment ${lastNumber} was read`,
        );
      }

      this.#stats.incrementalReads++;
      index.rewindToLastSegment();
      let parseFrom: number;
      let tagged: boolean;
      if (after === undefined) {
        // Every entry listed is new. Tags before the first one mark it.
        const leading = countLeadingDiscontinuities(head);
        for (let i = 0; i < leading; i++) {
          index.addDiscontinuity();
        }
        parseFrom = 0;
        tagged = leading > 0;
      } else {
        parseFrom = after;
        tagged = next?.tagged ?? false;
      }

      const nextNumber = next?.number ?? null;
      if (nextNumber !== null && nextNumber > lastNumber + 1) {
        const missing = nextNumber - lastNumber - 1;
        this.#stats.gaps++;
        this.logger?.warn(
          'The HLS playlist %s skips segments %d to %d, which were never read. Counting a discontinuity and about %d s for them.',
          this.path,
          lastNumber + 1,
          nextNumber - 1,
          missing * targetDuration,
        );
        if (!tagged) {
          index.addDiscontinuity();
        }
        index.skipTime(missing * targetDuration * 1000);
      }

      this.#stats.parsedLines += lines.length - parseFrom;
      const parsedLines = index.parseLines(lines, parseFrom, false);
      return { index, rest: lines.slice(parsedLines), windowed: true };
    }
  }

  // Parses a window that doesn't continue the entries read before. The
  // segments before it are taken to have lasted the target duration each,
  // and their discontinuities are unknown.
  async #parseWindow(
    handle: FileHandle,
    size: number,
    start: Dayjs,
    head: PlaylistHead,
    mediaSequence: number,
    targetDuration: number,
    why: string,
  ): Promise<IndexUpdate> {
    this.logger?.warn(
      'The HLS playlist %s starts at segment %d, and %s. Parsing it afresh and estimating its start time.',
      this.path,
      mediaSequence,
      why,
    );
    this.#reset(start);
    this.#byteAnchored = false;
    const index = this.#requireIndex();
    index.skipTime(mediaSequence * targetDuration * 1000);
    const chunk = await readFrom(handle, head, head.bodyStart, size);
    const lines = chunk.toString('utf-8').split('\n');
    this.#stats.fullParses++;
    this.#stats.parsedLines += lines.length;
    const parsedLines = index.parseLines(lines, 0, false);
    return { index, rest: lines.slice(parsedLines), windowed: true };
  }

  // The index, when it was parsed from the same start
  #continuableIndex(start: Dayjs) {
    return this.#index?.start.valueOf() === start.valueOf()
      ? this.#index
      : undefined;
  }

  #reset(start: Dayjs) {
    this.#index = new MediaPlaylistIndex(start);
    this.#byteAnchored = true;
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

  async #headMatches(handle: FileHandle, { bodyStart, bytes }: PlaylistHead) {
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

// The playlist's #EXT-X-MEDIA-SEQUENCE, 0 when it has none
function parseMediaSequence(header: Buffer) {
  const match = MediaSequenceTag.exec(header.toString('utf-8'))?.[1];
  return match === undefined ? 0 : parseInt(match);
}

// Discontinuity tags right before the first #EXTINF line. In a window they
// belong to its first entry: ffmpeg writes discont_start's header tag only
// while #EXT-X-MEDIA-SEQUENCE is 0.
function countLeadingDiscontinuities({ bodyStart, bytes }: PlaylistHead) {
  const lines = bytes.subarray(0, bodyStart).toString('utf-8').split('\n');
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? '';
    if (line === '#EXT-X-DISCONTINUITY') {
      count++;
    } else if (line !== '') {
      break;
    }
  }
  return count;
}

// Where the playlist body starts: the first line that begins with #EXTINF:.
// Undefined when there is none.
async function findBody(
  handle: FileHandle,
  size: number,
): Promise<PlaylistHead | undefined> {
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

// Bytes [start, end) of the file, from the head's bytes when they hold them
async function readFrom(
  handle: FileHandle,
  head: PlaylistHead,
  start: number,
  end: number,
) {
  return end <= head.bytes.length
    ? head.bytes.subarray(start, end)
    : await readRange(handle, start, end);
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
