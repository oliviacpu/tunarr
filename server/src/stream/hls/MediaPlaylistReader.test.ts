import dayjs from 'dayjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrimPlaylistResult as ReferenceTrimResult } from '../../testing/hls/ReferenceHlsPlaylistTrim.ts';
import { ReferenceHlsPlaylistTrim } from '../../testing/hls/ReferenceHlsPlaylistTrim.ts';
import {
  RandomDurations,
  SeededRandom,
  randomFilter,
  randomOptions,
  segmentUri,
} from '../../testing/hls/randomPlaylists.ts';
import type {
  HlsPlaylistFilterOptions,
  MutateOptions,
  TrimPlaylistResult,
} from './HlsPlaylistMutator.ts';
import { MediaPlaylistReader } from './MediaPlaylistReader.ts';

const start = dayjs('2026-10-15T12:00:00.000-0500');

const opts: MutateOptions = {
  maxSegmentsToKeep: 20,
  endWithDiscontinuity: false,
  targetDuration: 2,
};

function afterSegment(segmentNumber: number): HlsPlaylistFilterOptions {
  return {
    type: 'before_segment_number',
    segmentNumber,
    segmentsToKeepBefore: 10,
    segmentFloor: 0,
  };
}

// Writes stream.m3u8 the way ffmpeg's hls muxer does: the whole file each
// time, to a temporary file renamed over the playlist
class FakeFfmpegPlaylist {
  header = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-DISCONTINUITY',
  ];
  body: string[] = [];
  next = 0;
  #dateMs = Date.parse('2026-10-15T17:00:00.000Z');

  constructor(readonly path: string) {}

  segments(count: number, seconds = 2) {
    for (let i = 0; i < count; i++) {
      this.body.push(
        `#EXTINF:${seconds.toFixed(6)},`,
        `#EXT-X-PROGRAM-DATE-TIME:${new Date(this.#dateMs).toISOString()}`,
        `/stream/channels/x/hls/data${String(this.next++).padStart(6, '0')}.ts`,
      );
      this.#dateMs += seconds * 1000;
    }
    return this;
  }

  discontinuity() {
    this.body.push('#EXT-X-DISCONTINUITY');
    return this;
  }

  // The next program's ffmpeg (discont_start) rewrites the header with
  // another discontinuity tag and marks its first segment as one
  newProgram() {
    this.header.splice(4, 0, '#EXT-X-DISCONTINUITY');
    return this.discontinuity();
  }

  text() {
    return [...this.header, ...this.body].join('\n') + '\n';
  }

  async write(content = this.text()) {
    await fs.writeFile(`${this.path}.tmp`, content);
    await fs.rename(`${this.path}.tmp`, this.path);
  }
}

type Comparable = Omit<TrimPlaylistResult, 'playlistStart'> & {
  playlistStart: number | undefined;
};

function comparable(
  result: TrimPlaylistResult | ReferenceTrimResult,
): Comparable {
  return {
    ...result,
    // dayjs() when nothing is listed
    playlistStart:
      result.segmentCount > 0 ? result.playlistStart.valueOf() : undefined,
  };
}

async function settle<T>(
  run: () => Promise<T>,
): Promise<{ value?: T; failed: boolean }> {
  try {
    return { value: await run(), failed: false };
  } catch {
    return { failed: true };
  }
}

async function trimWholeFile(
  file: string,
  filter: HlsPlaylistFilterOptions,
  options = opts,
) {
  const lines = (await fs.readFile(file, 'utf-8')).split('\n');
  return comparable(
    new ReferenceHlsPlaylistTrim().trimPlaylist(start, filter, lines, options),
  );
}

describe('MediaPlaylistReader', () => {
  let dir: tmp.DirResult;
  let file: string;
  let reader: MediaPlaylistReader;
  let playlist: FakeFfmpegPlaylist;

  beforeEach(() => {
    dir = tmp.dirSync({ unsafeCleanup: true });
    file = path.join(dir.name, 'stream.m3u8');
    reader = new MediaPlaylistReader(file);
    playlist = new FakeFfmpegPlaylist(file);
  });

  afterEach(() => {
    dir.removeCallback();
  });

  // Both trims, or that both failed. Trimming an entry cut off before its URI
  // fails when the filter reads its segment number.
  async function expectSameAsWholeFile(
    filter: HlsPlaylistFilterOptions,
    options = opts,
  ) {
    const actual = await settle(async () => {
      const result = await reader.trim(start, filter, options);
      return result === undefined ? undefined : comparable(result);
    });
    const expected = await settle(() => trimWholeFile(file, filter, options));
    expect(actual).toEqual(expected);
    expect(actual.failed || actual.value !== undefined).toBe(true);
  }

  it('returns undefined while there is no playlist', async () => {
    expect(await reader.trim(start, afterSegment(0), opts)).toBeUndefined();
  });

  it('parses only what was appended to a long playlist', async () => {
    await playlist.segments(20_000).write();
    await expectSameAsWholeFile(afterSegment(19_990));
    const first = { ...reader.stats };
    expect(first.fullParses).toBe(1);
    expect(first.parsedLines).toBeGreaterThan(60_000);

    await playlist.segments(2).write();
    await expectSameAsWholeFile(afterSegment(19_992));

    // Two entries of three lines, and the empty text after the last newline
    expect(reader.stats.fullParses).toBe(1);
    expect(reader.stats.parsedLines - first.parsedLines).toBe(7);
  });

  it('matches the whole file across appends, program boundaries and new ffmpeg processes', async () => {
    let watching = 0;
    for (let step = 0; step < 60; step++) {
      if (step % 15 === 14) {
        // A new program, from its own ffmpeg process
        playlist.newProgram();
      }
      playlist.segments(1 + (step % 3), step % 2 === 0 ? 2.002 : 1.5);
      await playlist.write();
      watching = Math.max(0, playlist.next - 12);
      await expectSameAsWholeFile(afterSegment(watching));
    }
    expect(reader.stats.fullParses).toBe(1);
  });

  it('follows the body when the header changes length', async () => {
    await playlist.segments(30).write();
    await expectSameAsWholeFile(afterSegment(25));

    playlist.header[2] = '#EXT-X-TARGETDURATION:10';
    playlist.header.splice(1, 0, '#EXT-X-ALLOW-CACHE:NO');
    await playlist.segments(2).write();
    await expectSameAsWholeFile(afterSegment(27));

    playlist.header.splice(1, 1);
    await playlist.segments(1).write();
    await expectSameAsWholeFile(afterSegment(28));
    expect(reader.stats.fullParses).toBe(1);
  });

  it('parses the whole file again when an entry it parsed changes', async () => {
    await playlist.segments(30).write();
    await expectSameAsWholeFile(afterSegment(25));

    // The last parsed entry is rewritten with another duration
    const lastExtInf = playlist.body.length - 3;
    playlist.body[lastExtInf] = '#EXTINF:1.000000,';
    await playlist.segments(2).write();
    await expectSameAsWholeFile(afterSegment(27));
    expect(reader.stats.fullParses).toBe(2);
  });

  it('parses the whole file again when the first entry changes', async () => {
    await playlist.segments(30).write();
    await expectSameAsWholeFile(afterSegment(25));

    // Same length, so only the comparison of the first bytes can tell
    playlist.body[0] = '#EXTINF:3.000000,';
    await playlist.write();
    await expectSameAsWholeFile(afterSegment(25));
    expect(reader.stats.fullParses).toBe(2);
  });

  it('parses the whole file again when it shrinks', async () => {
    await playlist.segments(40).write();
    await expectSameAsWholeFile(afterSegment(35));

    playlist.body.splice(30 * 3);
    playlist.next = 30;
    await playlist.write();
    await expectSameAsWholeFile(afterSegment(25));
    expect(reader.stats.fullParses).toBe(2);

    // Empty, then a fresh start
    await playlist.write('');
    await expectSameAsWholeFile(afterSegment(0));
    playlist.body = [];
    playlist.next = 0;
    await playlist.segments(3).write();
    await expectSameAsWholeFile(afterSegment(0));
  });

  it('parses an entry cut off by a partial write only once it is complete', async () => {
    await playlist.segments(30).write();
    await expectSameAsWholeFile(afterSegment(25));

    playlist.segments(1);
    const whole = playlist.text();
    // Cut in the URI, after its EXTINF line, and with no final newline
    for (const cut of [
      whole.length - 10,
      whole.length - 60,
      whole.length - 1,
    ]) {
      await playlist.write(whole.slice(0, cut));
      await expectSameAsWholeFile(afterSegment(25));
      // Few enough segments that the cut one is listed
      await expectSameAsWholeFile(afterSegment(0), {
        ...opts,
        maxSegmentsToKeep: 40,
      });
    }

    await playlist.write(whole);
    await expectSameAsWholeFile(afterSegment(26));
    expect(reader.stats.fullParses).toBe(1);
  });

  it('parses the whole file when a filter reaches below the discarded segments', async () => {
    await playlist.segments(30).newProgram().segments(30).write();
    await expectSameAsWholeFile(afterSegment(50));
    reader.discardSegmentsBelow(40, 20);

    // Still above the discarded segments
    await playlist.segments(1).write();
    await expectSameAsWholeFile(afterSegment(50));
    expect(reader.stats.fullParses).toBe(1);

    // A client rewinds below them
    await expectSameAsWholeFile(afterSegment(20));
    expect(reader.stats.fullParses).toBe(2);

    reader.discardSegmentsBelow(40, 20);
    await expectSameAsWholeFile({
      type: 'before_date',
      before: start.add(10, 'seconds'),
    });
    expect(reader.stats.fullParses).toBe(3);

    // More segments than are kept
    reader.discardSegmentsBelow(60, 5);
    await expectSameAsWholeFile(afterSegment(100), {
      ...opts,
      maxSegmentsToKeep: 10,
    });
  });

  it('keeps the discontinuity sequence of discarded programs', async () => {
    await playlist
      .segments(25)
      .newProgram()
      .segments(25)
      .newProgram()
      .segments(25)
      .write();
    reader.discardSegmentsBelow(60, 10);
    for (const watching of [62, 70, 80]) {
      await playlist.segments(5).write();
      await expectSameAsWholeFile(afterSegment(watching), {
        ...opts,
        previousDiscontinuitySequence: 1,
      });
    }
    expect(reader.stats.fullParses).toBe(1);
  });

  it('parses the whole file again when the start time changes', async () => {
    await playlist.segments(30).write();
    await reader.trim(start, afterSegment(25), opts);
    const later = start.add(1, 'hour');
    const result = await reader.trim(later, afterSegment(25), opts);
    const lines = (await fs.readFile(file, 'utf-8')).split('\n');
    expect(result?.playlist).toEqual(
      new ReferenceHlsPlaylistTrim().trimPlaylist(
        later,
        afterSegment(25),
        lines,
        opts,
      ).playlist,
    );
    expect(reader.stats.fullParses).toBe(2);
  });

  it('lists nothing for a playlist with only a header', async () => {
    await playlist.write();
    await expectSameAsWholeFile(afterSegment(0));
    await playlist.segments(2).write();
    await expectSameAsWholeFile(afterSegment(0));
  });

  it('needs a start time once the playlist exists', async () => {
    await playlist.segments(3).write();
    await expect(
      reader.trim(undefined, afterSegment(0), opts),
    ).rejects.toThrow();
  });

  // Appends, program boundaries, odd lines, partial writes, rewrites,
  // truncations and discards in random order, each followed by a request
  // with a random filter
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'matches the whole-file trim through random changes (seed %i)',
    async (seed) => {
      const random = new SeededRandom(seed);
      for (let step = 0; step < 150; step++) {
        const change = random.next();
        let partial: string | undefined;
        if (change < 0.4) {
          playlist.segments(random.int(1, 3), random.pick(RandomDurations));
        } else if (change < 0.45) {
          // An entry ffmpeg wouldn't write: a duration that doesn't parse, a
          // URI without a number, or one numbered out of order
          playlist.body.push(
            random.chance(0.3) ? '#EXTINF:abc,' : '#EXTINF:2.000000,',
            '#EXT-X-PROGRAM-DATE-TIME:2026-10-15T17:00:00.000Z',
            random.chance(0.5)
              ? '/stream/channels/x/hls/promo.ts'
              : segmentUri(random.int(0, playlist.next + 5)),
          );
        } else if (change < 0.53) {
          playlist.discontinuity();
        } else if (change < 0.6) {
          playlist.newProgram();
        } else if (change < 0.63) {
          playlist.body.push(random.pick(['', '   ']));
        } else if (change < 0.67) {
          playlist.header[2] = `#EXT-X-TARGETDURATION:${random.int(1, 12)}`;
        } else if (change < 0.74) {
          // ffmpeg's next write isn't complete yet
          playlist.segments(random.int(1, 2));
          const whole = playlist.text();
          partial = whole.slice(0, random.int(0, whole.length));
        } else if (change < 0.78 && playlist.body.length > 0) {
          const line = random.int(0, playlist.body.length - 1);
          playlist.body[line] = random.pick([
            '#EXTINF:1.000000,',
            '#EXT-X-DISCONTINUITY',
            segmentUri(random.int(0, 99)),
            '',
          ]);
        } else if (change < 0.82) {
          playlist.body.splice(
            Math.max(0, playlist.body.length - random.int(1, 30)),
          );
        } else if (change < 0.9) {
          reader.discardSegmentsBelow(
            random.int(0, playlist.next + 5),
            random.int(0, 25),
          );
        }

        await playlist.write(partial);
        await expectSameAsWholeFile(
          randomFilter(random, start, playlist.next),
          randomOptions(random),
        );
      }
      expect(reader.stats.incrementalReads).toBeGreaterThan(0);
    },
  );
});
