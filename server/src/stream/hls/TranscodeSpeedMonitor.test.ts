import { describe, expect, test } from 'vitest';
import type {
  TranscodeSpeedEvent,
  TranscodeSpeedLogDetails,
} from './TranscodeSpeedMonitor.ts';
import {
  describeTranscodeSpeedEvent,
  TranscodeSpeedMonitor,
} from './TranscodeSpeedMonitor.ts';

// 2 s segments at 29.97 fps
const SegmentSeconds = 2.002;

type Timed = TranscodeSpeedEvent & { atMs: number };

// Drives a monitor with segments finishing at given wall-clock times
class Feed {
  monitor = new TranscodeSpeedMonitor();
  events: Timed[] = [];
  nowMs: number;

  constructor(firstSegmentAtMs = 0) {
    this.nowMs = firstSegmentAtMs;
    this.segment(firstSegmentAtMs);
  }

  segment(atMs: number, seconds = SegmentSeconds) {
    this.nowMs = atMs;
    const event = this.monitor.addSegment(seconds, atMs);
    if (event) {
      this.events.push({ ...event, atMs });
    }
  }

  // Produces video at `speed` times real time for `forMs` of wall-clock time
  run(speed: number, forMs: number, seconds = SegmentSeconds) {
    const everyMs = (seconds * 1000) / speed;
    const endMs = this.nowMs + forMs;
    while (this.nowMs + everyMs <= endMs) {
      this.segment(this.nowMs + everyMs, seconds);
    }
    return this;
  }
}

describe('TranscodeSpeedMonitor', () => {
  test('stays quiet while the transcode keeps real time', () => {
    const feed = new Feed().run(1, 10 * 60_000);
    expect(feed.events).toEqual([]);
    expect(feed.monitor.speed()).toBeCloseTo(1, 3);
  });

  test('warns once when the transcode stays at 0.95x', () => {
    // 2.002 s segments every ~2.1 s, as seen on a 4-thread libx264 transcode
    const feed = new Feed().run(0.95, 10 * 60_000);

    expect(feed.events).toHaveLength(1);
    const [event] = feed.events;
    expect(event?.type).toBe('behind');
    expect(event?.speed).toBeCloseTo(0.95, 2);
    // A full minute of output, then 20 s of staying slow
    expect(event?.atMs).toBeGreaterThanOrEqual(80_000);
    expect(event?.atMs).toBeLessThan(85_000);
  });

  test('logs one recovery when the transcode is back at real time', () => {
    const feed = new Feed().run(0.95, 3 * 60_000).run(1, 3 * 60_000);

    expect(feed.events.map((e) => e.type)).toEqual(['behind', 'recovered']);
    expect(feed.events[1]?.speed).toBeGreaterThanOrEqual(0.99);
  });

  test('says nothing more about a program after it recovered', () => {
    const feed = new Feed()
      .run(0.95, 3 * 60_000)
      .run(1, 3 * 60_000)
      .run(0.9, 5 * 60_000)
      .run(1, 3 * 60_000);

    expect(feed.events.map((e) => e.type)).toEqual(['behind', 'recovered']);
  });

  test('ignores a slow start before the first segment', () => {
    // ffmpeg spawns and probes for 15 s before its first segment
    const feed = new Feed(15_000).run(1, 5 * 60_000);
    expect(feed.events).toEqual([]);
  });

  test('ignores a long first segment', () => {
    // The first segment took 10 s of wall clock: startup, not encoding speed
    const feed = new Feed(0);
    feed.segment(10_000);
    feed.run(1, 5 * 60_000);
    expect(feed.events).toEqual([]);
  });

  test('does not warn during or after the initial read burst', () => {
    // -readrate_initial_burst 60: the first minute of input at 4x, then 1x
    const feed = new Feed().run(4, 15_000).run(1, 5 * 60_000);
    expect(feed.events).toEqual([]);
  });

  test('does not warn for a stall that ffmpeg catches up', () => {
    // A source read stalls for 5 s; readrate then lets ffmpeg catch up at 2x
    const feed = new Feed().run(1, 2 * 60_000);
    feed.segment(feed.nowMs + 2002 + 5000);
    feed.run(2, 10_000).run(1, 3 * 60_000);
    expect(feed.events).toEqual([]);
  });

  test('says nothing about a program shorter than the window', () => {
    const feed = new Feed().run(0.5, 55_000);
    expect(feed.events).toEqual([]);
    expect(feed.monitor.speed()).toBeUndefined();
  });

  test('counts a short last segment by its own length', () => {
    const monitor = new TranscodeSpeedMonitor({ windowMs: 10_000 });
    monitor.addSegment(2, 0);
    for (let at = 2000; at <= 10_000; at += 2000) {
      monitor.addSegment(2, at);
    }
    monitor.addSegment(0.5, 10_500);
    // 10.5 s of video in the 10.5 s since the first segment
    expect(monitor.speed()).toBeCloseTo(1, 5);
  });
});

describe('describeTranscodeSpeedEvent', () => {
  const details: TranscodeSpeedLogDetails = {
    channel: { number: 7, name: 'Sitcoms' },
    item: {
      type: 'program',
      program: { title: 'Pilot', showTitle: 'The Show' },
    },
    transcodeConfig: { name: 'Default', threadCount: 4 },
  };

  test('names the channel, program, speed and thread count, with remedies', () => {
    const line = describeTranscodeSpeedEvent(
      { type: 'behind', speed: 0.9512 },
      details,
    );
    expect(line).toContain('Channel 7 (Sitcoms)');
    expect(line).toContain('"The Show - Pilot"');
    expect(line).toContain('0.95x real time');
    expect(line).toContain('pause');
    expect(line).toContain('Transcode config "Default" has thread count 4');
    expect(line).toContain('higher thread count');
    expect(line).toContain('faster video preset');
    expect(line).toContain('lower output resolution');
  });

  test('marks an automatic thread count', () => {
    const line = describeTranscodeSpeedEvent(
      { type: 'behind', speed: 0.9 },
      { ...details, transcodeConfig: { name: 'Default', threadCount: 0 } },
    );
    expect(line).toContain('thread count 0 (automatic)');
  });

  test('uses the bare title of a movie', () => {
    const line = describeTranscodeSpeedEvent(
      { type: 'behind', speed: 0.9 },
      {
        ...details,
        item: {
          type: 'program',
          program: { title: 'A Movie', showTitle: null },
        },
      },
    );
    expect(line).toContain('"A Movie"');
  });

  test('names the offline screen', () => {
    const line = describeTranscodeSpeedEvent(
      { type: 'behind', speed: 0.9 },
      { ...details, item: { type: 'offline' } },
    );
    expect(line).toContain('"the offline screen"');
  });

  test('describes a recovery', () => {
    const line = describeTranscodeSpeedEvent(
      { type: 'recovered', speed: 1.004 },
      details,
    );
    expect(line).toBe(
      'Channel 7 (Sitcoms) is transcoding "The Show - Pilot" at real time again (1.00x).',
    );
  });
});
