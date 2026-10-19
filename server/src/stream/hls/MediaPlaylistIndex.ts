import { isNonEmptyString } from '@/util/index.js';
import type { Dayjs } from 'dayjs';
import { trimEnd } from 'lodash-es';
import { basename } from 'node:path';
import { SegmentNameRegex } from './BaseHlsSession.ts';

export class PlaylistSegment {
  public readonly type = 'segment' as const;
  #startTime?: Dayjs;
  #number?: number | null;

  /**
   * `startMs` is the segment's start as a timestamp; `playlistStart` is the
   * time the parse began from. The Dayjs start time is only built when read:
   * a long session's playlist has thousands of segments, and a request keeps
   * about twenty of them.
   *
   * `line` (the segment's URI) is undefined only for an entry cut off at the
   * end of the file.
   */
  constructor(
    private readonly playlistStart: Dayjs,
    public readonly startMs: number,
    public readonly extInf: string,
    public readonly line: string | undefined,
    // Discontinuity tags anywhere before this segment
    public readonly discontinuitiesBefore: number,
    // Whether the entry just before this one is a discontinuity tag
    public readonly afterDiscontinuity: boolean,
  ) {}

  /** The same value (and Dayjs settings) as adding each duration to the start. */
  get startTime(): Dayjs {
    this.#startTime ??= this.playlistStart.add(
      this.startMs - this.playlistStart.valueOf(),
      'millisecond',
    );
    return this.#startTime;
  }

  /** The number in the segment's file name, or null when it has none. */
  get number(): number | null {
    if (this.#number === undefined) {
      if (this.line === undefined) {
        // What basename() threw before segments were numbered once
        throw new TypeError('A playlist entry has no segment URI');
      }
      this.#number = segmentNumberOf(this.line);
    }
    return this.#number;
  }
}

/** The number in a segment URI's file name, or null when it has none */
export function segmentNumberOf(uri: string): number | null {
  const match = basename(uri).match(SegmentNameRegex)?.[1];
  return match ? parseInt(match) : null;
}

export type PlaylistDiscontinuity = {
  type: 'discontinuity';
};

export type PlaylistLine = PlaylistSegment | PlaylistDiscontinuity;

export type MediaPlaylistSavepoint = {
  segmentCount: number;
  discontinuities: number;
  endsWithDiscontinuity: boolean;
  leadingDiscontinuities: number | undefined;
  nextStartMs: number;
  lastSegment: PlaylistSegment | undefined;
  nextStartMsAfterLast: number;
};

/**
 * The entries of an HLS session's ffmpeg media playlist (`stream.m3u8`): the
 * session's history, every segment listed so far in order. Every program's
 * ffmpeg appends to the same file. Lines can be added as the file grows, so
 * a request parses only what was appended, and segments that can no longer
 * be listed can be dropped, so a long session holds only the recent ones.
 *
 * The file need not list the whole session. When ffmpeg keeps only its
 * newest entries (a bounded hls_list_size), the index keeps what it already
 * parsed and is continued from its last segment (rewindToLastSegment), so
 * the history outlives the file's window.
 *
 * Start times are the parse's start plus every earlier EXTINF duration,
 * truncated to the millisecond at each step, which is what adding each
 * duration to a Dayjs did.
 */
export class MediaPlaylistIndex {
  // Kept segments, oldest first. The first `#discarded` segments are gone.
  #segments: PlaylistSegment[] = [];
  #discarded = 0;
  // What trimming must know about the discarded segments: whether any of
  // them could still pass a filter
  #discardedMaxNumber = -Infinity;
  #discardedMaxStartMs = -Infinity;
  #discardedInvalidStart = false;
  // Discontinuity tags parsed so far
  #discontinuities = 0;
  // Whether the last entry parsed is a discontinuity tag
  #endsWithDiscontinuity = false;
  // Discontinuity tags before the first segment, once there is one
  #leadingDiscontinuities: number | undefined;
  #nextStartMs: number;
  // The last segment parsed, discarded or not, and where the segment after
  // it starts: where parsing a newer window of the file continues from
  #lastSegment: PlaylistSegment | undefined;
  #nextStartMsAfterLast: number;

  constructor(readonly start: Dayjs) {
    this.#nextStartMs = start.valueOf();
    this.#nextStartMsAfterLast = this.#nextStartMs;
  }

  /**
   * The index of the first line of the playlist's body, the first line that
   * starts with #EXTINF:, or the line count when there is none. Lines before
   * it are the header, and a DISCONTINUITY-SEQUENCE there is ignored: ffmpeg
   * never writes one. While the file starts at the session's first segment,
   * the discontinuity tags before its first entry are ffmpeg artifacts from
   * process restarts (discont_start), not program boundaries. Once ffmpeg
   * drops old entries, a tag there marks the first listed entry, which only
   * MediaPlaylistReader can tell is new or already parsed.
   */
  static bodyStart(lines: readonly string[]) {
    let i = 0;
    while (i < lines.length && !lines[i]?.startsWith('#EXTINF:')) {
      i++;
    }
    return i;
  }

  /** Parses a whole playlist, header included. */
  static fromLines(start: Dayjs, lines: readonly string[]) {
    const index = new MediaPlaylistIndex(start);
    index.parseLines(lines, MediaPlaylistIndex.bodyStart(lines), true);
    return index;
  }

  /** Every segment, discarded ones included */
  get segmentCount() {
    return this.#discarded + this.#segments.length;
  }

  /** Segments dropped by discardSegmentsBelow */
  get discardedCount() {
    return this.#discarded;
  }

  /** The kept segments, oldest first */
  get segments(): readonly PlaylistSegment[] {
    return this.#segments;
  }

  /** The last segment parsed, even when it was discarded */
  get lastSegment(): PlaylistSegment | undefined {
    return this.#lastSegment;
  }

  get discontinuities() {
    return this.#discontinuities;
  }

  get endsWithDiscontinuity() {
    return this.#endsWithDiscontinuity;
  }

  /**
   * Discontinuity tags before the first segment, or all of them when there
   * is no segment
   */
  get leadingDiscontinuities() {
    return this.#leadingDiscontinuities ?? this.#discontinuities;
  }

  /** Whether a discarded segment is numbered `segmentNumber` or higher */
  discardedSegmentNumberedFrom(segmentNumber: number) {
    return this.#discarded > 0 && !(this.#discardedMaxNumber < segmentNumber);
  }

  /** Whether a discarded segment doesn't start before `ms` */
  discardedSegmentStartingFrom(ms: number) {
    return (
      this.#discarded > 0 &&
      (this.#discardedInvalidStart || !(this.#discardedMaxStartMs < ms))
    );
  }

  /**
   * Parses body lines (see bodyStart) from `lines[from]` on, continuing from
   * the entries already parsed.
   *
   * With `final`, every line is parsed. Otherwise the last line is taken to
   * be unfinished (the text after the file's last newline), and parsing stops
   * before the first entry that reaches it, so an entry is never parsed from
   * a partial write. Returns the index of the first line not parsed.
   * findContinuation reads lines the same way.
   */
  parseLines(lines: readonly string[], from: number, final: boolean): number {
    // Lines at or after this one may still grow
    const unfinished = final ? Infinity : lines.length - 1;
    let i = from;
    while (i < lines.length) {
      const line = lines[i];
      if (!isNonEmptyString(line)) {
        if (i >= unfinished) {
          break;
        }
        i++;
        continue;
      }

      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        if (i >= unfinished) {
          break;
        }
        this.#discontinuities++;
        this.#endsWithDiscontinuity = true;
        i++;
        continue;
      }

      // An EXTINF line, a program date-time line, and the segment URI
      if (i + 2 >= unfinished) {
        break;
      }
      // NaN when the line has no duration, as parseFloat(undefined) was
      const duration = parseFloat(
        trimEnd(line.trim(), ',').split(':')[1] ?? '',
      );
      this.#leadingDiscontinuities ??= this.#discontinuities;
      const segment = new PlaylistSegment(
        this.start,
        this.#nextStartMs,
        line,
        lines[i + 2],
        this.#discontinuities,
        this.#endsWithDiscontinuity,
      );
      this.#segments.push(segment);
      this.#endsWithDiscontinuity = false;
      // What dayjs's add(duration, 'seconds') did at each step: a Date holds
      // whole milliseconds, so the sum is truncated every time.
      this.#nextStartMs = Math.trunc(this.#nextStartMs + duration * 1000);
      this.#lastSegment = segment;
      this.#nextStartMsAfterLast = this.#nextStartMs;
      i += 3;
    }
    return i;
  }

  /**
   * Where the entries after the last one parsed start in lines read from a
   * newer version of the file, which may begin anywhere in it. It reads
   * lines as parseLines does (keep the two in step), without parsing them.
   *
   * ffmpeg numbers segments in order, so the entries after the last complete
   * one numbered `lastNumber` or lower (the boundary) are new: `from` is the
   * line after the boundary's URI, `boundary` its number, and `next` the
   * first complete entry after it. Without a boundary, `from` is undefined
   * and `next` is the first complete entry. Lines from `firstLine` up to the
   * first #EXTINF line are skipped, and the last line is taken to be
   * unfinished.
   */
  static findContinuation(
    lines: readonly string[],
    firstLine: number,
    lastNumber: number,
  ): {
    from: number | undefined;
    boundary: number | undefined;
    next: { number: number | null; tagged: boolean } | undefined;
  } {
    const unfinished = lines.length - 1;
    let i = firstLine;
    while (i < unfinished && !lines[i]?.startsWith('#EXTINF:')) {
      i++;
    }
    let from: number | undefined;
    let boundary: number | undefined;
    let next: { number: number | null; tagged: boolean } | undefined;
    // Whether a discontinuity tag came since the previous entry
    let tagged = false;
    while (i < unfinished) {
      const line = lines[i];
      if (!isNonEmptyString(line)) {
        i++;
        continue;
      }
      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        tagged = true;
        i++;
        continue;
      }
      // An EXTINF line, a program date-time line, and the segment URI
      const uri = lines[i + 2];
      if (i + 2 >= unfinished || uri === undefined) {
        break;
      }
      const number = segmentNumberOf(uri);
      if (number !== null && number <= lastNumber) {
        from = i + 3;
        boundary = number;
        next = undefined;
      } else {
        next ??= { number, tagged };
      }
      tagged = false;
      i += 3;
    }
    return { from, boundary, next };
  }

  /**
   * Forgets what was parsed after the last segment (discontinuity tags and
   * blank lines), so that parsing can continue from the line after that
   * segment's URI in a newer version of the file.
   */
  rewindToLastSegment() {
    const last = this.#lastSegment;
    if (last === undefined) {
      return;
    }
    this.#discontinuities = last.discontinuitiesBefore;
    this.#endsWithDiscontinuity = false;
    this.#nextStartMs = this.#nextStartMsAfterLast;
  }

  /** Counts a discontinuity before the next segment, as a tag line does */
  addDiscontinuity() {
    this.#discontinuities++;
    this.#endsWithDiscontinuity = true;
  }

  /**
   * Moves the next segment's start on by `ms`, for segments that were never
   * parsed because the file no longer lists them
   */
  skipTime(ms: number) {
    this.#nextStartMs = Math.trunc(this.#nextStartMs + ms);
  }

  /** Marks the current state, to undo parsing past it with rollback() */
  savepoint(): MediaPlaylistSavepoint {
    return {
      segmentCount: this.#segments.length,
      discontinuities: this.#discontinuities,
      endsWithDiscontinuity: this.#endsWithDiscontinuity,
      leadingDiscontinuities: this.#leadingDiscontinuities,
      nextStartMs: this.#nextStartMs,
      lastSegment: this.#lastSegment,
      nextStartMsAfterLast: this.#nextStartMsAfterLast,
    };
  }

  rollback(savepoint: MediaPlaylistSavepoint) {
    this.#segments.length = savepoint.segmentCount;
    this.#discontinuities = savepoint.discontinuities;
    this.#endsWithDiscontinuity = savepoint.endsWithDiscontinuity;
    this.#leadingDiscontinuities = savepoint.leadingDiscontinuities;
    this.#nextStartMs = savepoint.nextStartMs;
    this.#lastSegment = savepoint.lastSegment;
    this.#nextStartMsAfterLast = savepoint.nextStartMsAfterLast;
  }

  /**
   * Drops the oldest segments while they are numbered below `segmentNumber`,
   * keeping at least the newest `keep`. Trimming reports when a filter would
   * select a dropped segment.
   */
  discardSegmentsBelow(segmentNumber: number, keep: number) {
    let count = 0;
    while (count < this.#segments.length - keep) {
      const segment = this.#segments[count];
      if (segment === undefined || segment.line === undefined) {
        break;
      }
      const number = segment.number;
      if (number === null || !(number < segmentNumber)) {
        break;
      }
      this.#discardedMaxNumber = Math.max(this.#discardedMaxNumber, number);
      if (Number.isNaN(segment.startMs)) {
        this.#discardedInvalidStart = true;
      } else {
        this.#discardedMaxStartMs = Math.max(
          this.#discardedMaxStartMs,
          segment.startMs,
        );
      }
      count++;
    }
    if (count > 0) {
      this.#segments.splice(0, count);
      this.#discarded += count;
    }
  }
}
