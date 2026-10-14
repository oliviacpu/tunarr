import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TranscodeSpeedEvent } from './TranscodeSpeedMonitor.ts';
import {
  parsePlaylistSegments,
  TranscodeSpeedWatcher,
} from './TranscodeSpeedWatcher.ts';

const SegmentSeconds = 2.002;

function segmentName(n: number) {
  return `data${String(n).padStart(6, '0')}.ts`;
}

// An entry the way ffmpeg's hls muxer writes it with program_date_time
function entry(n: number, seconds = SegmentSeconds) {
  return [
    `#EXTINF:${seconds.toFixed(6)},`,
    '#EXT-X-PROGRAM-DATE-TIME:2026-10-14T14:00:00.000+0000',
    `/stream/channels/test-channel/hls/${segmentName(n)}`,
  ];
}

describe('parsePlaylistSegments', () => {
  test('lists each segment with its number and EXTINF duration', () => {
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:0',
      ...entry(0),
      '#EXT-X-DISCONTINUITY',
      ...entry(1, 0.5),
      '',
    ];
    expect(parsePlaylistSegments(lines)).toEqual([
      { number: 0, file: 'data000000.ts', seconds: 2.002 },
      { number: 1, file: 'data000001.ts', seconds: 0.5 },
    ]);
  });

  test('skips an entry cut off at the start', () => {
    const [, ...cutEntry] = entry(4);
    expect(parsePlaylistSegments([...cutEntry, ...entry(5)])).toEqual([
      { number: 5, file: 'data000005.ts', seconds: 2.002 },
    ]);
  });

  test('ignores subtitle segments', () => {
    expect(
      parsePlaylistSegments(['#EXTINF:2.002000,', 'subs000003.vtt']),
    ).toEqual([]);
  });
});

describe('TranscodeSpeedWatcher', () => {
  let dir: tmp.DirResult;
  let playlistPath: string;
  let events: TranscodeSpeedEvent[];
  let onError: ReturnType<typeof vi.fn>;
  let watcher: TranscodeSpeedWatcher;
  let entries: string[];

  beforeEach(() => {
    dir = tmp.dirSync({ unsafeCleanup: true });
    playlistPath = path.join(dir.name, 'stream.m3u8');
    events = [];
    onError = vi.fn();
    entries = [];
    watcher = new TranscodeSpeedWatcher(
      playlistPath,
      (event) => events.push(event),
      // Polled by hand
      { pollMs: 3_600_000, onError },
    );
  });

  afterEach(() => {
    watcher.stop();
    dir.removeCallback();
  });

  // Writes segments numbered from `first`, finished `everyMs` apart from
  // `startMs`, and lists them in the playlist
  async function writeSegments(
    first: number,
    count: number,
    startMs: number,
    everyMs: number,
  ) {
    for (let i = 0; i < count; i++) {
      const file = path.join(dir.name, segmentName(first + i));
      await fs.writeFile(file, '');
      const mtime = (startMs + i * everyMs) / 1000;
      await fs.utimes(file, mtime, mtime);
      entries.push(...entry(first + i));
    }
    await writePlaylist();
  }

  async function writePlaylist() {
    await fs.writeFile(
      playlistPath,
      ['#EXTM3U', '#EXT-X-TARGETDURATION:2', ...entries, ''].join('\n'),
    );
  }

  test('warns when segments finish slower than real time', async () => {
    await watcher.start();
    // Two and a half minutes at 0.95x, all found in one poll
    await writeSegments(0, 72, Date.now(), 2002 / 0.95);
    await watcher.poll();

    expect(events.map((e) => e.type)).toEqual(['behind']);
    expect(events[0]?.speed).toBeCloseTo(0.95, 2);
    expect(onError).not.toHaveBeenCalled();
  });

  test('stays quiet while segments keep real time', async () => {
    await watcher.start();
    await writeSegments(0, 72, Date.now(), 2002);
    await watcher.poll();

    expect(events).toEqual([]);
  });

  test("skips segments an earlier program's transcode listed", async () => {
    // An hour ago, so counting them would read as far below real time
    await writeSegments(0, 10, Date.now() - 3_600_000, 2002);
    await watcher.start();
    await writeSegments(10, 72, Date.now(), 2002);
    await watcher.poll();

    expect(events).toEqual([]);
  });

  test('counts each segment once across polls', async () => {
    await watcher.start();
    const startMs = Date.now();
    await writeSegments(0, 30, startMs, 2002);
    await watcher.poll();
    await watcher.poll();
    await writeSegments(30, 42, startMs + 30 * 2002, 2002);
    await watcher.poll();

    // A segment counted twice would read as faster than real time; one
    // dropped, as slower
    expect(events).toEqual([]);
  });

  test('reads the end of a playlist longer than the part it reads', async () => {
    // 1,000 entries of earlier programs, whose files are long deleted
    for (let n = 0; n < 1000; n++) {
      entries.push(...entry(n));
    }
    await writePlaylist();
    expect((await fs.stat(playlistPath)).size).toBeGreaterThan(64 * 1024);
    await watcher.start();
    await writeSegments(1000, 72, Date.now(), 2002 / 0.95);
    await watcher.poll();

    expect(events.map((e) => e.type)).toEqual(['behind']);
  });

  test('waits quietly for the first playlist', async () => {
    await watcher.start();
    await watcher.poll();
    expect(onError).not.toHaveBeenCalled();

    await writeSegments(0, 72, Date.now(), 2002 / 0.95);
    await watcher.poll();
    expect(events.map((e) => e.type)).toEqual(['behind']);
  });

  test('polls on its own until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const polling = new TranscodeSpeedWatcher(
        playlistPath,
        (event) => events.push(event),
        { pollMs: 2_000 },
      );
      const poll = vi.spyOn(polling, 'poll').mockResolvedValue();
      await polling.start();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(poll).toHaveBeenCalledTimes(3);

      polling.stop();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(poll).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
