import dayjs from 'dayjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FfmpegHlsPlaylist } from '../../testing/hls/FfmpegHlsPlaylist.ts';
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

// ffmpeg with a bounded hls_list_size writes only its newest entries. The
// reader keeps the session's history itself, so what it serves must match
// trimming the playlist ffmpeg would have written with hls_list_size 0.
describe('MediaPlaylistReader on a window of the playlist', () => {
  let dir: tmp.DirResult;
  let file: string;
  let warn: ReturnType<typeof vi.fn>;
  let reader: MediaPlaylistReader;
  let session: FfmpegHlsPlaylist;

  beforeEach(() => {
    dir = tmp.dirSync({ unsafeCleanup: true });
    file = path.join(dir.name, 'stream.m3u8');
    warn = vi.fn();
    reader = new MediaPlaylistReader(file, { warn });
    session = new FfmpegHlsPlaylist();
  });

  afterEach(() => {
    dir.removeCallback();
  });

  // Like ffmpeg: the whole file, renamed over the playlist
  async function write(content: string) {
    await fs.writeFile(`${file}.tmp`, content);
    await fs.rename(`${file}.tmp`, file);
  }

  // Writes the window ffmpeg writes with hls_list_size `size`, less the last
  // `cut` bytes (a partial write), and checks that the reader serves from it
  // what the reference trim gives for the whole session's playlist, less the
  // same bytes. Both ends are the same entries, byte for byte.
  async function expectWindowSameAsWholeSession(
    size: number,
    filter: HlsPlaylistFilterOptions,
    options = opts,
    cut = 0,
  ) {
    const window = session.window(size);
    const whole = session.whole();
    await write(window.slice(0, window.length - cut));
    const actual = await settle(async () => {
      const result = await reader.trim(start, filter, options);
      return result === undefined ? undefined : comparable(result);
    });
    const expected = await settle(async () =>
      comparable(
        new ReferenceHlsPlaylistTrim().trimPlaylist(
          start,
          filter,
          whole.slice(0, whole.length - cut).split('\n'),
          options,
        ),
      ),
    );
    expect(actual).toEqual(expected);
    expect(actual.failed || actual.value !== undefined).toBe(true);
    return actual.value;
  }

  // Random sessions, read after every change with a random filter, while
  // ffmpeg keeps 5 to 40 entries
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    'serves from the window what the whole playlist gives (seed %i)',
    async (seed) => {
      const random = new SeededRandom(seed);
      const size = random.int(5, 40);
      let fullParsesBeforeSliding: number | undefined;
      for (let step = 0; step < 200; step++) {
        const change = random.next();
        let cut = 0;
        if (change < 0.55) {
          session.segments(random.int(1, 3), random.pick(RandomDurations));
          if (random.chance(0.15)) {
            // ffmpeg's write of the newest segment isn't complete yet
            cut = random.int(1, session.lastEntryBytes());
          }
        } else if (change < 0.62) {
          session.discontinuity();
        } else if (change < 0.75) {
          session.newProgram();
        }
        if (
          session.segmentCount > size &&
          fullParsesBeforeSliding === undefined
        ) {
          fullParsesBeforeSliding = reader.stats.fullParses;
        }
        await expectWindowSameAsWholeSession(
          size,
          randomFilter(random, start, session.segmentCount),
          randomOptions(random),
          cut,
        );
      }
      // The window slid well past its size, without parsing it whole again
      expect(session.segmentCount).toBeGreaterThan(size + 100);
      expect(reader.stats.fullParses).toBe(fullParsesBeforeSliding);
      expect(reader.stats.gaps).toBe(0);
      expect(reader.stats.clampedTrims).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  // Requests as HlsSession makes them: the default filter with the pruning
  // floor, and old segments dropped from memory after each request
  it.each([1, 2, 3, 4, 5, 6])(
    'serves from the window what the whole playlist gives while dropping old segments (seed %i)',
    async (seed) => {
      const random = new SeededRandom(seed);
      const size = random.int(5, 40);
      let floor = 0;
      let previousDiscontinuitySequence: number | undefined;
      for (let step = 0; step < 200; step++) {
        const change = random.next();
        if (change < 0.6) {
          session.segments(random.int(1, 3), random.pick(RandomDurations));
        } else if (change < 0.75) {
          session.newProgram();
        }
        const result = await expectWindowSameAsWholeSession(
          size,
          {
            type: 'before_segment_number',
            segmentNumber: Math.max(
              0,
              session.segmentCount - random.int(1, 15),
            ),
            segmentsToKeepBefore: 10,
            segmentFloor: floor,
          },
          { ...opts, previousDiscontinuitySequence },
        );
        if (result !== undefined) {
          previousDiscontinuitySequence = result.discontinuitySequence;
          floor = Math.max(floor, result.sequence);
          reader.discardSegmentsBelow(floor, opts.maxSegmentsToKeep);
        }
      }
      expect(session.segmentCount).toBeGreaterThan(size + 100);
      expect(reader.stats.clampedTrims).toBe(0);
    },
  );

  it('parses only the entries after the last one it read', async () => {
    for (let count = 5; count <= 40; count += 5) {
      session.segments(5);
      await expectWindowSameAsWholeSession(10, afterSegment(count - 5));
    }
    const before = { ...reader.stats };

    session.segments(2);
    await expectWindowSameAsWholeSession(10, afterSegment(38));
    expect(reader.stats.fullParses).toBe(1);
    expect(reader.stats.incrementalReads).toBe(before.incrementalReads + 1);
    // Two entries of three lines, and the empty text after the last newline
    expect(reader.stats.parsedLines - before.parsedLines).toBe(7);
  });

  it('continues after a new ffmpeg process whose window starts mid-program', async () => {
    session.segments(8);
    await expectWindowSameAsWholeSession(10, afterSegment(0));
    // 14 segments: the window starts at 4, in the middle of the program
    session.segments(6);
    await expectWindowSameAsWholeSession(10, afterSegment(4));

    // The next program's ffmpeg reads the window back, continues its
    // numbering and marks its first segment as a discontinuity
    session.newProgram().segments(3);
    expect(session.window(10)).toContain('#EXT-X-MEDIA-SEQUENCE:7\n');
    const result = await expectWindowSameAsWholeSession(10, afterSegment(17), {
      ...opts,
      maxSegmentsToKeep: 8,
    });
    expect(result?.sequence).toBe(7);
    expect(result?.discontinuitySequence).toBe(0);
    expect(result?.playlistStart).toBe(start.add(14, 'seconds').valueOf());
    expect(result?.playlist).toContain(
      'data000013.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2.000000,',
    );
    // Segments the window no longer lists are still served
    const early = await expectWindowSameAsWholeSession(10, afterSegment(10));
    expect(early?.sequence).toBe(0);
    expect(reader.stats.fullParses).toBe(1);
  });

  it("ignores tags at the window's head at session start, and counts one later when its entry is new", async () => {
    // At session start: discont_start's header tag and the first segment's
    // own tag
    session.newProgram().segments(5);
    expect(session.window(5)).toContain(
      '#EXT-X-DISCONTINUITY\n#EXT-X-DISCONTINUITY\n#EXTINF',
    );
    const first = await expectWindowSameAsWholeSession(5, afterSegment(0));
    expect(first?.discontinuitySequence).toBe(0);
    expect(first?.playlist).not.toContain('#EXT-X-DISCONTINUITY\n');

    // Five new entries, the window's whole length: the first one starts a
    // program, and its tag comes before the window's first entry
    session.newProgram().segments(5);
    expect(session.window(5)).toContain(
      '#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-DISCONTINUITY\n#EXTINF',
    );
    const result = await expectWindowSameAsWholeSession(5, afterSegment(15), {
      ...opts,
      maxSegmentsToKeep: 6,
    });
    expect(result?.sequence).toBe(4);
    expect(result?.discontinuitySequence).toBe(0);
    expect(result?.playlist).toContain(
      'data000004.ts\n#EXT-X-DISCONTINUITY\n#EXTINF',
    );
    expect(reader.stats.gaps).toBe(0);
  });

  it("doesn't count a tag at the window's head again when its entry was read", async () => {
    for (let i = 0; i < 8; i++) {
      session.segments(1);
      await expectWindowSameAsWholeSession(5, afterSegment(0));
    }
    session.newProgram().segments(1);
    await expectWindowSameAsWholeSession(5, afterSegment(0));
    // The program's first segment, already read, now heads the window
    session.segments(4);
    expect(session.window(5)).toContain(
      '#EXT-X-MEDIA-SEQUENCE:8\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-DISCONTINUITY\n#EXTINF',
    );
    for (const watching of [8, 20]) {
      const result = await expectWindowSameAsWholeSession(
        5,
        afterSegment(watching),
        { ...opts, maxSegmentsToKeep: 4 },
      );
      expect(result?.discontinuitySequence).toBe(watching === 8 ? 0 : 1);
    }
    expect(reader.stats.fullParses).toBe(1);
  });

  describe('a gap in the numbering', () => {
    // A filter that lists segments from `segmentNumber` on
    function from(segmentNumber: number): HlsPlaylistFilterOptions {
      return {
        type: 'before_segment_number',
        segmentNumber,
        segmentsToKeepBefore: 0,
        segmentFloor: segmentNumber,
      };
    }

    it('counts one discontinuity and the target duration per missing segment, and warns once', async () => {
      session.segments(5, 1.5);
      await expectWindowSameAsWholeSession(5, afterSegment(0));
      // Segments 5 to 9 leave the window before the reader sees them
      session.segments(10, 1.5);
      await write(session.window(5));

      const result = await reader.trim(start, from(10), {
        ...opts,
        maxSegmentsToKeep: 5,
      });
      expect(result?.sequence).toBe(10);
      expect(result?.discontinuitySequence).toBe(1);
      // 5 x 1.5 s read, then 5 x 2 s (the target duration) estimated
      expect(result?.playlistStart.valueOf()).toBe(
        start.add(17_500, 'milliseconds').valueOf(),
      );
      const across = await reader.trim(start, afterSegment(14), opts);
      expect(across?.playlist).toContain(
        'data000004.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:1.500000,',
      );
      expect(across?.playlist).not.toContain('data000005.ts');
      expect(reader.stats.gaps).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.slice(2, 5)).toEqual([5, 9, 10]);

      // The next read continues normally
      session.segments(1, 1.5);
      await write(session.window(5));
      const next = await reader.trim(start, from(15), {
        ...opts,
        maxSegmentsToKeep: 1,
      });
      expect(next?.discontinuitySequence).toBe(1);
      expect(next?.playlistStart.valueOf()).toBe(
        start.add(17_500 + 7_500, 'milliseconds').valueOf(),
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(reader.stats.fullParses).toBe(1);
    });

    it('counts one discontinuity when the first new entry starts a program', async () => {
      session.segments(5);
      await expectWindowSameAsWholeSession(5, afterSegment(0));
      session.segments(3).newProgram().segments(5);
      await write(session.window(5));

      const result = await reader.trim(start, from(8), {
        ...opts,
        maxSegmentsToKeep: 5,
      });
      expect(result?.sequence).toBe(8);
      expect(result?.discontinuitySequence).toBe(1);
      expect(result?.playlistStart.valueOf()).toBe(
        start.add(16, 'seconds').valueOf(),
      );
      expect(reader.stats.gaps).toBe(1);
    });
  });

  it('lists from the kept segments when a filter reaches below them and the window', async () => {
    for (let count = 5; count <= 40; count += 5) {
      session.segments(5);
      await expectWindowSameAsWholeSession(10, afterSegment(count - 5));
    }
    reader.discardSegmentsBelow(30, 5);

    // Segments 0 to 29 are neither in the index nor in the file
    const options = { ...opts, maxSegmentsToKeep: 10 };
    const clamped = await reader.trim(start, afterSegment(5), options);
    const wholeLines = session.whole().split('\n');
    const kept = new ReferenceHlsPlaylistTrim().trimPlaylist(
      start,
      {
        type: 'before_segment_number',
        segmentNumber: 30,
        segmentsToKeepBefore: 0,
      },
      wholeLines,
      options,
    );
    expect(clamped?.sequence).toBe(30);
    expect(clamped?.playlist).toBe(kept.playlist);

    const byDate = await reader.trim(
      start,
      { type: 'before_date', before: start },
      options,
    );
    expect(byDate?.playlist).toBe(kept.playlist);
    expect(reader.stats.clampedTrims).toBe(2);
    expect(reader.stats.fullParses).toBe(1);
  });

  it('estimates where a window starts when no earlier entry was read', async () => {
    session.segments(30);
    await write(session.window(10));

    const result = await reader.trim(start, afterSegment(30), {
      ...opts,
      maxSegmentsToKeep: 10,
    });
    expect(result?.sequence).toBe(20);
    expect(result?.playlistStart.valueOf()).toBe(
      start.add(40, 'seconds').valueOf(),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reader.stats.fullParses).toBe(1);

    // And continues from it
    session.segments(2);
    await expectWindowSameAsWholeSession(10, afterSegment(32), {
      ...opts,
      maxSegmentsToKeep: 10,
    });
    expect(reader.stats.fullParses).toBe(1);
  });

  // Reads ten windows of five new segments each, so segments 0 to 49 are
  // known and the file lists 40 to 49
  async function readFiftySegments() {
    for (let count = 5; count <= 50; count += 5) {
      session.segments(5);
      await expectWindowSameAsWholeSession(10, afterSegment(count - 5));
    }
  }

  it('keeps its history when a read fails', async () => {
    await readFiftySegments();
    const probe = await fs.open(file, 'r');
    const fileHandle = Object.getPrototypeOf(probe) as typeof probe;
    await probe.close();
    const read = vi
      .spyOn(fileHandle, 'read')
      .mockRejectedValueOnce(new Error('EIO'));
    try {
      session.segments(2);
      await write(session.window(10));
      await expect(reader.trim(start, afterSegment(50), opts)).rejects.toThrow(
        'EIO',
      );
    } finally {
      read.mockRestore();
    }

    await expectWindowSameAsWholeSession(10, afterSegment(51));
    expect(warn).not.toHaveBeenCalled();
    expect(reader.stats.fullParses).toBe(1);
  });

  it('keeps its history when the window has no complete entry', async () => {
    await readFiftySegments();
    const served = await reader.trim(start, afterSegment(45), opts);
    const window = session.window(10);
    const header = window.slice(0, window.indexOf('#EXTINF'));

    // A header alone, then a header and part of an entry
    for (const content of [header, header + '#EXTINF:2.000000,\n#EXT-X-PRO']) {
      await write(content);
      const result = await reader.trim(start, afterSegment(45), opts);
      expect(result?.playlist).toBe(served?.playlist);
    }

    session.segments(1);
    await expectWindowSameAsWholeSession(10, afterSegment(46));
    expect(warn).not.toHaveBeenCalled();
    expect(reader.stats.fullParses).toBe(1);
  });

  it('keeps listing the last segment it read when a partial write cuts it off', async () => {
    await readFiftySegments();
    const served = await reader.trim(start, afterSegment(45), opts);
    const window = session.window(10);
    await write(window.slice(0, window.length - 10));
    const result = await reader.trim(start, afterSegment(45), opts);
    expect(result?.playlist).toBe(served?.playlist);
    expect(result?.playlist).toContain('data000049.ts');

    session.segments(1);
    await expectWindowSameAsWholeSession(10, afterSegment(46));
    expect(reader.stats.fullParses).toBe(1);
  });

  it('parses a window afresh when its numbering goes back', async () => {
    await readFiftySegments();
    // Segments 5 to 14 of a numbering that started again
    const restarted = new FfmpegHlsPlaylist().segments(15);
    await write(restarted.window(10));

    const result = await reader.trim(start, afterSegment(14), {
      ...opts,
      maxSegmentsToKeep: 10,
    });
    expect(result?.sequence).toBe(5);
    expect(result?.segmentCount).toBe(10);
    expect(result?.playlistStart.valueOf()).toBe(
      start.add(10, 'seconds').valueOf(),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reader.stats.fullParses).toBe(2);
  });
});
