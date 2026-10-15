import type { Dayjs } from 'dayjs';
import type {
  HlsPlaylistFilterOptions,
  MutateOptions,
} from '../../stream/hls/HlsPlaylistMutator.ts';

/** A seeded random number generator (mulberry32), so failures reproduce */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next() {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max] */
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number) {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) {
      throw new Error('Nothing to pick from');
    }
    return item;
  }
}

export const RandomDurations = [2, 2.002, 1.5, 4.004, 0.04, 3.2, 1.001001];

export function segmentUri(n: number, extension = 'ts') {
  return `/stream/channels/x/hls/data${String(n).padStart(6, '0')}.${extension}`;
}

/** A filter like the ones trimPlaylist gets, around the segments listed so far */
export function randomFilter(
  random: SeededRandom,
  start: Dayjs,
  segmentCount: number,
): HlsPlaylistFilterOptions {
  if (random.chance(0.2)) {
    return {
      type: 'before_date',
      before: start.add(random.int(-10, segmentCount * 3), 'seconds'),
    };
  }
  return {
    type: 'before_segment_number',
    segmentNumber: random.int(0, segmentCount + 5),
    segmentsToKeepBefore: random.int(0, 12),
    segmentFloor: random.chance(0.5)
      ? random.int(0, segmentCount + 5)
      : undefined,
  };
}

export function randomOptions(random: SeededRandom): MutateOptions {
  return {
    maxSegmentsToKeep: random.chance(0.05) ? 0 : random.int(1, 25),
    endWithDiscontinuity: random.chance(0.15),
    targetDuration: random.pick([2, 4]),
    previousDiscontinuitySequence: random.chance(0.4)
      ? random.int(0, 6)
      : undefined,
  };
}
