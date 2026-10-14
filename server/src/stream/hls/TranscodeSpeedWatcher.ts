import { isNodeError } from '@/util/index.js';
import fs from 'node:fs/promises';
import path, { basename, extname } from 'node:path';
import { SegmentNameRegex } from './BaseHlsSession.ts';
import type { TranscodeSpeedEvent } from './TranscodeSpeedMonitor.ts';
import { TranscodeSpeedMonitor } from './TranscodeSpeedMonitor.ts';

// The playlist lists every segment of the session, so only its end is read.
// A segment entry is about 130 bytes; 64 KiB holds the last ~500, minutes
// more than one poll ever adds.
const PlaylistTailBytes = 64 * 1024;

// Segment times come from file mtimes, so the poll interval only delays
// the log line, never the measurement.
const DefaultPollMs = 2_000;

export type CompletedSegment = {
  number: number;
  file: string;
  seconds: number;
};

/**
 * The video segments a media playlist lists, with their EXTINF durations.
 * Lines before the first complete entry are skipped, so a playlist cut off
 * at the start parses cleanly.
 */
export function parsePlaylistSegments(lines: string[]): CompletedSegment[] {
  const segments: CompletedSegment[] = [];
  let seconds: number | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const parsed = parseFloat(line.slice('#EXTINF:'.length));
      seconds = Number.isFinite(parsed) ? parsed : undefined;
      continue;
    }
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const file = basename(line);
    const number = file.match(SegmentNameRegex)?.[1];
    const ext = extname(file);
    if (
      seconds !== undefined &&
      number !== undefined &&
      (ext === '.ts' || ext === '.mp4')
    ) {
      segments.push({ number: parseInt(number), file, seconds });
    }
    seconds = undefined;
  }
  return segments;
}

async function readPlaylistTail(playlistPath: string): Promise<string[]> {
  const handle = await fs.open(playlistPath, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - PlaylistTailBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf-8').split('\n');
    // The first line may be cut off
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await handle.close();
  }
}

export type TranscodeSpeedWatcherOptions = {
  pollMs?: number;
  onError?: (e: unknown) => void;
};

/**
 * Follows the media playlist of one transcode and feeds each segment it
 * finishes, timed by the segment file's mtime, to a TranscodeSpeedMonitor.
 * Segments already listed when it starts belong to earlier transcodes, whose
 * ffmpeg appended to the same playlist, and are skipped.
 */
export class TranscodeSpeedWatcher {
  #monitor = new TranscodeSpeedMonitor();
  // Highest segment number already seen
  #lastSegment: number | undefined;
  #timer: NodeJS.Timeout | undefined;
  #stopped = false;

  constructor(
    private playlistPath: string,
    private onEvent: (event: TranscodeSpeedEvent) => void,
    private options: TranscodeSpeedWatcherOptions = {},
  ) {}

  /** Call before the transcode starts, so its segments aren't skipped. */
  async start() {
    this.#lastSegment = (await this.readSegments()).at(-1)?.number;
    this.schedule();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  async poll() {
    for (const segment of await this.readSegments()) {
      // A poll still running when its transcode ended goes no further: the
      // next program appends its segments to the same playlist
      if (this.#stopped) {
        return;
      }
      if (
        this.#lastSegment !== undefined &&
        segment.number <= this.#lastSegment
      ) {
        continue;
      }
      this.#lastSegment = segment.number;
      const finishedAtMs = await this.finishedAt(segment);
      if (this.#stopped) {
        return;
      }
      const event = this.#monitor.addSegment(segment.seconds, finishedAtMs);
      if (event) {
        this.onEvent(event);
      }
    }
  }

  private schedule() {
    if (this.#stopped) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.poll()
        .catch((e) => this.options.onError?.(e))
        .finally(() => this.schedule());
    }, this.options.pollMs ?? DefaultPollMs);
    this.#timer.unref();
  }

  private async readSegments() {
    try {
      return parsePlaylistSegments(await readPlaylistTail(this.playlistPath));
    } catch (e) {
      // No playlist until the session's first segment
      if (!isNodeError(e) || e.code !== 'ENOENT') {
        this.options.onError?.(e);
      }
      return [];
    }
  }

  // ffmpeg closes a segment file when the segment ends
  private async finishedAt(segment: CompletedSegment) {
    try {
      const stat = await fs.stat(
        path.join(path.dirname(this.playlistPath), segment.file),
      );
      return stat.mtimeMs;
    } catch {
      return Date.now();
    }
  }
}
