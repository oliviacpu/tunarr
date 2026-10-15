// The media playlist trim as it was before the incremental playlist reader
// (main at 21b15c83, server/src/stream/hls/HlsPlaylistMutator.ts), kept
// unchanged as a reference: tests check that the current implementation
// produces exactly the same playlists. Do not "fix" this file.
import { isNonEmptyString } from '@/util/index.js';
import { seq } from '@tunarr/shared/util';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  filter,
  first,
  isEmpty,
  last,
  nth,
  reject,
  take,
  takeRight,
  trimEnd,
} from 'lodash-es';
import { basename } from 'node:path';
import { match } from 'ts-pattern';
import { SegmentNameRegex } from '../../stream/hls/BaseHlsSession.ts';

type MutateOptions = {
  maxSegmentsToKeep: number;
  endWithDiscontinuity: boolean;
  targetDuration: number;
  previousDiscontinuitySequence?: number;
};

type FilterBeforeDate = {
  type: 'before_date';
  before: Dayjs;
};

export type FilterBeforeSegmentNumber = {
  type: 'before_segment_number';
  segmentNumber: number;
  segmentsToKeepBefore: number;
  // Hard floor: never include segments below this number. Prevents the
  // playlist from referencing segments that have been deleted from disk.
  segmentFloor?: number;
};

export type HlsPlaylistFilterOptions =
  | FilterBeforeDate
  | FilterBeforeSegmentNumber;

export class ReferenceHlsPlaylistTrim {
  trimPlaylist(
    start: Dayjs,
    filter: HlsPlaylistFilterOptions,
    playlistLines: string[],
    opts: MutateOptions,
  ): TrimPlaylistResult {
    const items = this.parsePlaylist(
      start,
      playlistLines,
      opts.endWithDiscontinuity,
    );

    const generateResult = this.generatePlaylist(
      items,
      filter,
      opts.maxSegmentsToKeep,
      opts.targetDuration,
      opts.previousDiscontinuitySequence,
    );

    return {
      playlistStart: generateResult.nextPlaylistStart,
      sequence: generateResult.startSequence,
      playlist: generateResult.playlist,
      segmentCount: generateResult.count,
      discontinuitySequence: generateResult.discontinuitySequence,
    };
  }

  parsePlaylist(
    start: Dayjs,
    playlistLines: string[],
    endWithDiscontinuity: boolean,
  ): PlaylistLine[] {
    const items: PlaylistLine[] = [];

    let i = 0;
    // Milliseconds, not Dayjs: this runs once per segment of the whole
    // session's playlist on every playlist request.
    let currentMs = start.valueOf();

    while (
      i < playlistLines.length &&
      !playlistLines[i]!.startsWith('#EXTINF:')
    ) {
      // Skip header lines — DISCs in the header are FFmpeg artifacts from
      // process restarts (discont_start), not actual program boundaries.
      // The DISC-SEQ header is also ignored because with hls_list_size=0
      // all DISCs are in the body; counting both would double-count.
      // This is beacuse Tunarr has discrete ffmpeg processes continuouly write
      // to the same underlying playlist file.
      // TODO: We could consider writing out the trimmed playlist periodically
      // in the session manager to keep things cleaner
      i++;
    }

    while (i < playlistLines.length) {
      const line = playlistLines[i];
      if (!isNonEmptyString(line)) {
        i++;
        continue;
      }

      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        items.push(PlaylistDiscontinuity());
        i++;
        continue;
      }

      // EXTINF
      const duration = parseFloat(trimEnd(line.trim(), ',').split(':')[1]!);
      items.push(
        new PlaylistSegment(start, currentMs, line, playlistLines[i + 2]!),
      );

      // What dayjs's add(duration, 'seconds') did at each step: a Date holds
      // whole milliseconds, so the sum is truncated every time.
      currentMs = Math.trunc(currentMs + duration * 1000);
      i += 3;
    }

    if (endWithDiscontinuity && last(items)?.type !== 'discontinuity') {
      items.push(PlaylistDiscontinuity());
    }

    return items;
  }

  private generatePlaylist(
    items: PlaylistLine[],
    filterOptions: HlsPlaylistFilterOptions,
    maxSegmentsToKeep: number,
    targetDuration: number,
    previousDiscontinuitySequence?: number,
  ) {
    // Count and remove leading discontinuities
    let leadingDiscontinuities = 0;
    let discontinuitySequence = 0;
    while (items[leadingDiscontinuities]?.type === 'discontinuity') {
      leadingDiscontinuities++;
    }
    discontinuitySequence += leadingDiscontinuities;
    items = items.slice(leadingDiscontinuities);

    let allSegments = filter(
      items,
      (item): item is PlaylistSegment => item.type === 'segment',
    );

    if (allSegments.length > maxSegmentsToKeep) {
      const filtered = match(filterOptions)
        .with({ type: 'before_date' }, ({ before }) =>
          reject(allSegments, (segment) => segment.startTime.isBefore(before)),
        )
        .with(
          {
            type: 'before_segment_number',
          },
          (beforeSeg) => {
            const minSeg = Math.max(
              beforeSeg.segmentNumber - beforeSeg.segmentsToKeepBefore,
              beforeSeg.segmentFloor ?? 0,
            );
            return seq.collect(allSegments, (segment) => {
              const fileName = basename(segment.line);
              const matches = fileName.match(SegmentNameRegex);
              if (!matches || matches.length < 2) {
                return;
              }
              const int = parseInt(matches[1]!);
              if (isNaN(int)) {
                return;
              }
              if (int < minSeg) {
                return;
              }
              return segment;
            });
          },
        )
        .exhaustive();

      allSegments =
        filtered.length >= maxSegmentsToKeep
          ? take(filtered, maxSegmentsToKeep)
          : takeRight(allSegments, maxSegmentsToKeep);
    }

    const startSequence = first(allSegments)?.startSequence ?? 0;
    // The kept segments are the parsed objects themselves, so membership is
    // identity. Comparing every item of a long session's playlist against
    // each kept segment by value made this O(items x kept) date comparisons
    // on every playlist request.
    const selected = new Set<PlaylistLine>(allSegments);

    if (!isEmpty(allSegments)) {
      const firstSeg = first(allSegments)!;
      const firstSegIndex = items.indexOf(firstSeg);
      // ALL discontinuities before the first selected segment are folded into
      // the discontinuity sequence number. They must never be emitted as tags
      // because there are no selected segments before them — emitting a tag
      // would create an empty leading period which confuses clients like Kodi
      // (inputstream.adaptive maps each discontinuity to a "period" and
      // errors with "No segments in the manifest" when a period is empty).
      for (let i = 0; i < firstSegIndex; i++) {
        if (items[i]!.type === 'discontinuity') {
          discontinuitySequence++;
        }
      }
    }

    // Cap disc-seq so it never jumps by more than 1 between consecutive polls.
    // When a short program is entirely filtered out of the sliding window between
    // client polls, all its boundary DISCs are folded at once, jumping by >1.
    // The client never saw the intermediate period, so it errors. Cap at +1 and
    // emit a trailing DISC to pre-create the next period for the following poll.
    let emitTrailingDisc = false;
    if (
      previousDiscontinuitySequence !== undefined &&
      discontinuitySequence > previousDiscontinuitySequence + 1
    ) {
      discontinuitySequence = previousDiscontinuitySequence + 1;
      emitTrailingDisc = true;
    }

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${startSequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];

    // Track whether we've emitted at least one selected segment.
    // A DISC tag is only emitted when it separates two groups of selected
    // segments — never before the first selected segment (that case is
    // handled above by incrementing discontinuitySequence).
    let hasEmittedSegment = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      switch (item.type) {
        case 'discontinuity': {
          if (!hasEmittedSegment) {
            // Before the first selected segment — already counted in
            // discontinuitySequence above, do not emit a tag.
            break;
          }
          const next = items[i + 1];
          const nextIsSelected = next !== undefined && selected.has(next);
          if (i === items.length - 1 || nextIsSelected) {
            lines.push('#EXT-X-DISCONTINUITY');
          }
          break;
        }
        case 'segment':
          if (selected.has(item)) {
            lines.push(item.extInf);
            lines.push(
              `#EXT-X-PROGRAM-DATE-TIME:${item.startTime.format(
                'YYYY-MM-DDTHH:mm:ss.SSSZZ',
              )}`,
            );
            lines.push(item.line);
            hasEmittedSegment = true;
          }
          break;
      }
    }

    if (emitTrailingDisc && hasEmittedSegment) {
      lines.push('#EXT-X-DISCONTINUITY');
    }

    const playlist = lines.join('\n');
    const nextPlaylistStart = first(allSegments)?.startTime ?? dayjs();
    return {
      playlist,
      nextPlaylistStart,
      startSequence,
      count: allSegments.length,
      discontinuitySequence,
    };
  }
}

class PlaylistSegment {
  public readonly type = 'segment' as const;
  #startTime?: Dayjs;

  /**
   * `startMs` is the segment's start as a timestamp; `playlistStart` is the
   * time the parse began from. The Dayjs start time is only built when read:
   * a long session's playlist has thousands of segments, and a request keeps
   * about twenty of them.
   */
  constructor(
    private readonly playlistStart: Dayjs,
    public readonly startMs: number,
    public extInf: string,
    public line: string,
  ) {}

  /** The same value (and Dayjs settings) as adding each duration to the start. */
  get startTime(): Dayjs {
    this.#startTime ??= this.playlistStart.add(
      this.startMs - this.playlistStart.valueOf(),
      'millisecond',
    );
    return this.#startTime;
  }

  get startSequence() {
    const matches = basename(this.line).match(SegmentNameRegex);
    const match = nth(matches, 1);
    return match ? parseInt(match) : null;
  }

  equals(other: PlaylistSegment) {
    return (
      this === other ||
      (this.startMs === other.startMs &&
        this.extInf === other.extInf &&
        this.line === other.line)
    );
  }
}

type PlaylistDiscontinuity = {
  type: 'discontinuity';
};

function PlaylistDiscontinuity(): PlaylistDiscontinuity {
  return {
    type: 'discontinuity',
  };
}

type PlaylistLine = PlaylistSegment | PlaylistDiscontinuity;

export type TrimPlaylistResult = {
  playlistStart: Dayjs;
  sequence: number;
  playlist: string;
  segmentCount: number;
  discontinuitySequence: number;
};
