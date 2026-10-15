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
      const match = basename(this.line).match(SegmentNameRegex)?.[1];
      this.#number = match ? parseInt(match) : null;
    }
    return this.#number;
  }
}

export type PlaylistDiscontinuity = {
  type: 'discontinuity';
};

export type PlaylistLine = PlaylistSegment | PlaylistDiscontinuity;

const Discontinuity: PlaylistDiscontinuity = { type: 'discontinuity' };

export type MediaPlaylistSavepoint = {
  segmentCount: number;
  discontinuities: number;
  endsWithDiscontinuity: boolean;
  leadingDiscontinuities: number | undefined;
  nextStartMs: number;
};

/**
 * The entries of an ffmpeg media playlist (`stream.m3u8`), which grows as
 * long as its session runs: every program's ffmpeg appends to it and nothing
 * trims it. Lines can be added as the file grows, so a request parses only
 * what was appended, and segments that can no longer be listed can be
 * dropped, so a long session holds only the recent ones.
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

  constructor(readonly start: Dayjs) {
    this.#nextStartMs = start.valueOf();
  }

  /**
   * The index of the first line of the playlist's body, the first line that
   * starts with #EXTINF:, or the line count when there is none. Lines before
   * it are the header. Its discontinuity tags are ffmpeg artifacts from
   * process restarts (discont_start), not program boundaries, and its
   * DISCONTINUITY-SEQUENCE is ignored because with hls_list_size=0 every
   * program boundary is in the body.
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
      this.#segments.push(
        new PlaylistSegment(
          this.start,
          this.#nextStartMs,
          line,
          lines[i + 2],
          this.#discontinuities,
          this.#endsWithDiscontinuity,
        ),
      );
      this.#endsWithDiscontinuity = false;
      // What dayjs's add(duration, 'seconds') did at each step: a Date holds
      // whole milliseconds, so the sum is truncated every time.
      this.#nextStartMs = Math.trunc(this.#nextStartMs + duration * 1000);
      i += 3;
    }
    return i;
  }

  /** Marks the current state, to undo parsing past it with rollback() */
  savepoint(): MediaPlaylistSavepoint {
    return {
      segmentCount: this.#segments.length,
      discontinuities: this.#discontinuities,
      endsWithDiscontinuity: this.#endsWithDiscontinuity,
      leadingDiscontinuities: this.#leadingDiscontinuities,
      nextStartMs: this.#nextStartMs,
    };
  }

  rollback(savepoint: MediaPlaylistSavepoint) {
    this.#segments.length = savepoint.segmentCount;
    this.#discontinuities = savepoint.discontinuities;
    this.#endsWithDiscontinuity = savepoint.endsWithDiscontinuity;
    this.#leadingDiscontinuities = savepoint.leadingDiscontinuities;
    this.#nextStartMs = savepoint.nextStartMs;
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

  /**
   * The entries in playlist order, with `endWithDiscontinuity` adding a
   * discontinuity tag at the end when the last entry isn't one. Only for an
   * index that has discarded nothing.
   */
  toLines(endWithDiscontinuity: boolean): PlaylistLine[] {
    if (this.#discarded > 0) {
      throw new Error('This playlist index has discarded segments');
    }
    const items: PlaylistLine[] = [];
    let discontinuities = 0;
    for (const segment of this.#segments) {
      while (discontinuities < segment.discontinuitiesBefore) {
        items.push(Discontinuity);
        discontinuities++;
      }
      items.push(segment);
    }
    while (discontinuities < this.#discontinuities) {
      items.push(Discontinuity);
      discontinuities++;
    }
    if (endWithDiscontinuity && !this.#endsWithDiscontinuity) {
      items.push(Discontinuity);
    }
    return items;
  }
}
