// Speed is judged over the last minute of output: long enough that one late
// segment barely moves it, short enough to report a problem while the program
// is still on.
export const SpeedWindowMs = 60_000;

// Under -readrate 1 a transcode that keeps up averages 1.00x over a minute:
// it never runs slower unless it can't keep up, and after a hiccup readrate
// lets it read ahead until it has caught up. Segments end on keyframes, so
// each one lands a frame or two early or late, which is well under 1% across
// a minute. Below 0.98x the stream loses more than a second per minute and
// players run dry within a few minutes; 0.95x loses one 2 s segment every
// 40 s.
export const SlowBelowSpeed = 0.98;

// A little above the warning threshold, so a speed hovering right at it
// doesn't read as a recovery.
export const RecoveredAtSpeed = 0.99;

// A stall from a slow disk or network source drags the minute's average down
// until ffmpeg catches up, which takes a few seconds when the encoder has
// headroom. The speed must stay low this long before it counts.
export const SlowSustainMs = 20_000;

export type TranscodeSpeedEvent =
  // The transcode has stayed below real time
  | { type: 'behind'; speed: number }
  // It is back at real time after falling behind
  | { type: 'recovered'; speed: number };

type Sample = {
  finishedAtMs: number;
  seconds: number;
};

type MonitorState = 'measuring' | 'behind' | 'done';

export type TranscodeSpeedMonitorOptions = {
  windowMs: number;
  slowBelow: number;
  recoveredAt: number;
  sustainMs: number;
};

const DefaultOptions: TranscodeSpeedMonitorOptions = {
  windowMs: SpeedWindowMs,
  slowBelow: SlowBelowSpeed,
  recoveredAt: RecoveredAtSpeed,
  sustainMs: SlowSustainMs,
};

/**
 * Measures how much video one transcode produces against wall-clock time,
 * from the segments it finishes. Reports at most one 'behind' event and, after
 * it, at most one 'recovered' event, so one program logs no more than two
 * lines.
 *
 * Time is counted from the first segment onward. That segment's duration is
 * never counted, because it started before anything could be measured: ffmpeg
 * spawning and probing its input, which says nothing about encoding speed.
 */
export class TranscodeSpeedMonitor {
  #options: TranscodeSpeedMonitorOptions;
  // The oldest sample is the window's anchor: only the segments finished
  // after it count, over the time since it finished.
  #samples: Sample[] = [];
  #state: MonitorState = 'measuring';
  #slowSinceMs: number | undefined;

  constructor(options: Partial<TranscodeSpeedMonitorOptions> = {}) {
    this.#options = { ...DefaultOptions, ...options };
  }

  /**
   * Records a segment of `seconds` of video that finished at `finishedAtMs`.
   * Returns an event when the transcode falls behind or recovers.
   */
  addSegment(
    seconds: number,
    finishedAtMs: number,
  ): TranscodeSpeedEvent | undefined {
    this.#samples.push({ finishedAtMs, seconds });

    const windowStartMs = finishedAtMs - this.#options.windowMs;
    // Keep the newest sample at or before the window start as the anchor
    while (
      this.#samples.length > 2 &&
      (this.#samples[1]?.finishedAtMs ?? Infinity) <= windowStartMs
    ) {
      this.#samples.shift();
    }

    const speed = this.speed();
    if (speed === undefined) {
      return;
    }

    switch (this.#state) {
      case 'measuring': {
        if (speed >= this.#options.slowBelow) {
          this.#slowSinceMs = undefined;
          return;
        }
        this.#slowSinceMs ??= finishedAtMs;
        if (finishedAtMs - this.#slowSinceMs < this.#options.sustainMs) {
          return;
        }
        this.#state = 'behind';
        return { type: 'behind', speed };
      }
      case 'behind': {
        if (speed < this.#options.recoveredAt) {
          return;
        }
        this.#state = 'done';
        return { type: 'recovered', speed };
      }
      case 'done':
        return;
    }
  }

  /**
   * Seconds of video produced per second of wall-clock time over the window.
   * Undefined until a full window has passed since the first segment.
   */
  speed(): number | undefined {
    const anchor = this.#samples[0];
    const newest = this.#samples.at(-1);
    if (anchor === undefined || newest === undefined) {
      return;
    }
    const elapsedMs = newest.finishedAtMs - anchor.finishedAtMs;
    if (elapsedMs < this.#options.windowMs) {
      return;
    }
    let produced = 0;
    for (const sample of this.#samples.slice(1)) {
      produced += sample.seconds;
    }
    return produced / (elapsedMs / 1000);
  }
}

// The parts of a StreamLineupItem the log line names
export type TranscodeSpeedLogItem =
  | {
      type: 'program' | 'commercial' | 'fallback';
      program: { title: string; showTitle?: string | null };
    }
  | { type: 'offline' | 'error' }
  | { type: 'redirect'; channel: string };

export type TranscodeSpeedLogDetails = {
  channel: { number: number; name: string };
  item: TranscodeSpeedLogItem;
  transcodeConfig: { name: string; threadCount: number };
};

function itemTitle(item: TranscodeSpeedLogItem): string {
  switch (item.type) {
    case 'program':
    case 'commercial':
    case 'fallback': {
      const { title, showTitle } = item.program;
      return showTitle ? `${showTitle} - ${title}` : title;
    }
    case 'offline':
      return 'the offline screen';
    case 'error':
      return 'the error screen';
    case 'redirect':
      return `a redirect to channel ${item.channel}`;
  }
}

/** The log line for a speed event, naming the channel, program and config */
export function describeTranscodeSpeedEvent(
  event: TranscodeSpeedEvent,
  { channel, item, transcodeConfig }: TranscodeSpeedLogDetails,
): string {
  const where = `Channel ${channel.number} (${channel.name}) is transcoding "${itemTitle(item)}"`;
  const speed = `${event.speed.toFixed(2)}x`;
  if (event.type === 'recovered') {
    return `${where} at real time again (${speed}).`;
  }
  const threads =
    transcodeConfig.threadCount > 0
      ? `${transcodeConfig.threadCount}`
      : '0 (automatic)';
  return (
    `${where} at ${speed} real time over the last ${SpeedWindowMs / 1000} s, so players run out of video and pause. ` +
    `Transcode config "${transcodeConfig.name}" has thread count ${threads}; ` +
    'a higher thread count, a faster video preset or a lower output resolution helps.'
  );
}
