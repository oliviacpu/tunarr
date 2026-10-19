import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { filter, first, max, take, takeRight, trimEnd } from 'lodash-es';
import { match } from 'ts-pattern';
import type { PlaylistSegment } from './MediaPlaylistIndex.ts';
import type { MediaPlaylistIndex } from './MediaPlaylistIndex.ts';
import { segmentNumberOf } from './MediaPlaylistIndex.ts';

export type MutateOptions = {
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

export class HlsPlaylistMutator {
  /**
   * The playlist to serve from a parsed media playlist. Its work grows with
   * the segments the index keeps, not with the whole playlist.
   *
   * Undefined when the filter would list a segment the index has discarded.
   * Trim an index of the whole playlist then, or, when the file no longer
   * lists those segments either, pass `clampToKept`: the filter then selects
   * from the kept segments as if they were all there ever was.
   */
  trimIndex(
    index: MediaPlaylistIndex,
    filterOptions: HlsPlaylistFilterOptions,
    opts: MutateOptions,
    { clampToKept = false }: { clampToKept?: boolean } = {},
  ): TrimPlaylistResult | undefined {
    const selected = this.selectSegments(
      index,
      filterOptions,
      opts.maxSegmentsToKeep,
      clampToKept,
    );
    if (selected === undefined) {
      return;
    }

    const firstSegment = first(selected);
    const startSequence = firstSegment?.number ?? 0;

    // ALL discontinuities before the first selected segment are folded into
    // the discontinuity sequence number. They must never be emitted as tags
    // because there are no selected segments before them — emitting a tag
    // would create an empty leading period which confuses clients like Kodi
    // (inputstream.adaptive maps each discontinuity to a "period" and
    // errors with "No segments in the manifest" when a period is empty).
    let discontinuitySequence: number;
    if (firstSegment !== undefined) {
      discontinuitySequence = firstSegment.discontinuitiesBefore;
    } else if (index.segmentCount > 0) {
      discontinuitySequence = index.leadingDiscontinuities;
    } else {
      discontinuitySequence =
        index.discontinuities +
        (opts.endWithDiscontinuity && !index.endsWithDiscontinuity ? 1 : 0);
    }

    // Cap disc-seq so it never jumps by more than 1 between consecutive polls.
    // When a short program is entirely filtered out of the sliding window between
    // client polls, all its boundary DISCs are folded at once, jumping by >1.
    // The client never saw the intermediate period, so it errors. Cap at +1 and
    // emit a trailing DISC to pre-create the next period for the following poll.
    let emitTrailingDisc = false;
    if (
      opts.previousDiscontinuitySequence !== undefined &&
      discontinuitySequence > opts.previousDiscontinuitySequence + 1
    ) {
      discontinuitySequence = opts.previousDiscontinuitySequence + 1;
      emitTrailingDisc = true;
    }

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-TARGETDURATION:${opts.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${startSequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];

    selected.forEach((segment, i) => {
      // A DISC tag is only emitted when it separates two selected segments,
      // never before the first one (that case is counted in the
      // discontinuity sequence above).
      if (i > 0 && segment.afterDiscontinuity) {
        lines.push('#EXT-X-DISCONTINUITY');
      }
      lines.push(
        segment.extInf,
        `#EXT-X-PROGRAM-DATE-TIME:${segment.startTime.format(
          'YYYY-MM-DDTHH:mm:ss.SSSZZ',
        )}`,
        // A URI cut off at the end of the file was joined as an empty line
        segment.line ?? '',
      );
    });

    if (firstSegment !== undefined) {
      // A playlist that ends with a discontinuity keeps it after the last
      // listed segment
      if (index.endsWithDiscontinuity || opts.endWithDiscontinuity) {
        lines.push('#EXT-X-DISCONTINUITY');
      }
      if (emitTrailingDisc) {
        lines.push('#EXT-X-DISCONTINUITY');
      }
    }

    return {
      playlistStart: firstSegment?.startTime ?? dayjs(),
      sequence: startSequence,
      playlist: lines.join('\n'),
      segmentCount: selected.length,
      discontinuitySequence,
    };
  }

  // The segments to list, oldest first: the first maxSegmentsToKeep that pass
  // the filter, or the newest maxSegmentsToKeep when fewer pass. Undefined
  // when that takes a discarded segment, unless clampToKept leaves the
  // discarded segments out.
  private selectSegments(
    index: MediaPlaylistIndex,
    filterOptions: HlsPlaylistFilterOptions,
    maxSegmentsToKeep: number,
    clampToKept: boolean,
  ): readonly PlaylistSegment[] | undefined {
    const kept = index.segments;
    const hasDiscarded = !clampToKept && index.discardedCount > 0;
    const segmentCount = clampToKept ? kept.length : index.segmentCount;
    if (!(segmentCount > maxSegmentsToKeep)) {
      return hasDiscarded ? undefined : kept;
    }

    const filtered = match(filterOptions)
      .with({ type: 'before_date' }, ({ before }) => {
        // What Dayjs's isBefore compares: the timestamps
        const beforeMs = before.valueOf();
        return hasDiscarded && index.discardedSegmentStartingFrom(beforeMs)
          ? undefined
          : filter(kept, (segment) => !(segment.startMs < beforeMs));
      })
      .with({ type: 'before_segment_number' }, (beforeSeg) => {
        const minSeg = Math.max(
          beforeSeg.segmentNumber - beforeSeg.segmentsToKeepBefore,
          beforeSeg.segmentFloor ?? 0,
        );
        return hasDiscarded && index.discardedSegmentNumberedFrom(minSeg)
          ? undefined
          : filter(kept, (segment) => {
              const number = segment.number;
              return number !== null && !(number < minSeg);
            });
      })
      .exhaustive();

    if (filtered === undefined) {
      return;
    }
    if (filtered.length >= maxSegmentsToKeep) {
      return take(filtered, maxSegmentsToKeep);
    }
    if (hasDiscarded && maxSegmentsToKeep > kept.length) {
      return;
    }
    return takeRight(kept, maxSegmentsToKeep);
  }

  // Subtitle playlists have no program-date-time requirement, but may carry
  // the same discontinuity boundaries as their associated video playlist.
  parseSubtitlePlaylist(playlistLines: string[]): SubtitlePlaylistSegment[] {
    const items: SubtitlePlaylistSegment[] = [];
    let discontinuitySequence = 0;
    let extInf: string | undefined;
    for (const rawLine of playlistLines) {
      const line = rawLine.trimEnd();
      if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
        const value = line.slice(line.indexOf(':') + 1);
        const sequence = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(sequence)) {
          throw new Error('Invalid subtitle discontinuity sequence');
        }
        discontinuitySequence = sequence;
      } else if (line === '#EXT-X-DISCONTINUITY') {
        discontinuitySequence++;
      } else if (line.startsWith('#EXTINF:')) {
        extInf = line;
      } else if (
        extInf !== undefined &&
        line.length > 0 &&
        !line.startsWith('#')
      ) {
        items.push(
          new SubtitlePlaylistSegment(extInf, line, discontinuitySequence),
        );
        extInf = undefined;
      }
    }

    return items;
  }

  trimSubtitlePlaylist(
    playlistLines: string[],
    filterOptions: FilterBeforeSegmentNumber,
    opts: SubtitleTrimOptions,
  ): SubtitleTrimResult {
    let allSegments = this.parseSubtitlePlaylist(playlistLines);

    if (allSegments.length > opts.maxSegmentsToKeep) {
      const minSeg = Math.max(
        filterOptions.segmentNumber - filterOptions.segmentsToKeepBefore,
        filterOptions.segmentFloor ?? 0,
      );
      const filtered = filter(allSegments, (segment) => {
        const n = segment.segmentNumber;
        return n !== null && n >= minSeg;
      });

      allSegments =
        filtered.length >= opts.maxSegmentsToKeep
          ? take(filtered, opts.maxSegmentsToKeep)
          : takeRight(allSegments, opts.maxSegmentsToKeep);
    }

    const startSequence = first(allSegments)?.segmentNumber ?? 0;

    // Segment durations here are genuinely variable (unlike the fixed-cadence
    // video segments above), so the target duration must be derived from the
    // actual retained segments rather than the nominal segment_time -- an
    // under-reported #EXT-X-TARGETDURATION is a spec violation.
    const targetDuration = Math.max(
      1,
      Math.ceil(max(allSegments.map((s) => s.duration)) ?? 0),
    );

    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${startSequence}`,
    ];

    let discontinuitySequence = first(allSegments)?.discontinuitySequence ?? 0;
    if (
      playlistLines.some(
        (line) =>
          line.trimEnd() === '#EXT-X-DISCONTINUITY' ||
          line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:'),
      )
    ) {
      lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`);
    }
    for (const segment of allSegments) {
      while (discontinuitySequence < segment.discontinuitySequence) {
        lines.push('#EXT-X-DISCONTINUITY');
        discontinuitySequence++;
      }
      lines.push(segment.extInf, segment.line);
    }

    return {
      playlist: lines.join('\n'),
      sequence: startSequence,
      segmentCount: allSegments.length,
    };
  }
}

export class SubtitlePlaylistSegment {
  public readonly duration: number;

  constructor(
    public extInf: string,
    public line: string,
    public discontinuitySequence = 0,
  ) {
    this.duration = parseFloat(trimEnd(extInf.trim(), ',').split(':')[1]!);
  }

  get segmentNumber(): number | null {
    return segmentNumberOf(this.line);
  }
}

export type SubtitleTrimOptions = {
  maxSegmentsToKeep: number;
};

export type SubtitleTrimResult = {
  playlist: string;
  sequence: number;
  segmentCount: number;
};

export type TrimPlaylistResult = {
  playlistStart: Dayjs;
  sequence: number;
  playlist: string;
  segmentCount: number;
  discontinuitySequence: number;
};
