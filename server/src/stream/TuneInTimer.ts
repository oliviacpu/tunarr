import { PassThrough, type TransformCallback } from 'node:stream';

/**
 * Marks the moments of a tune-in (request received, session obtained, first
 * byte sent, request closed) so one log line can say how long each step took.
 * Before this, Tunarr never logged a tune-in's timing; it had to be read off
 * Plex's logs.
 */
export class TuneInTimer {
  readonly #start: number;
  readonly #marks = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {
    this.#start = now();
  }

  /** Records the first time `name` is marked; later marks of the same name are ignored. */
  mark(name: string): this {
    if (!this.#marks.has(name)) {
      this.#marks.set(name, this.now() - this.#start);
    }
    return this;
  }

  has(name: string) {
    return this.#marks.has(name);
  }

  /** Milliseconds from the start to the mark, rounded; undefined when it was never marked. */
  ms(name: string): number | undefined {
    const v = this.#marks.get(name);
    return v === undefined ? undefined : Math.round(v);
  }

  elapsedMs(): number {
    return Math.round(this.now() - this.#start);
  }

  /** "session 12 ms, first byte 2834 ms" in the order the marks were made. */
  summary(): string {
    return [...this.#marks.entries()]
      .map(([name, v]) => `${name} ${Math.round(v)} ms`)
      .join(', ');
  }
}

/**
 * A pass-through that counts the bytes it carries and reports the first chunk,
 * for the stream a tuner reads. Counting inside the stream, rather than with a
 * 'data' listener on it, leaves its flowing state to whoever pipes it to the
 * response.
 */
export class CountingPassThrough extends PassThrough {
  bytes = 0;
  #onFirst?: () => void;

  constructor(onFirstChunk?: () => void) {
    super({ allowHalfOpen: false });
    this.#onFirst = onFirstChunk;
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, encoding);
    if (this.#onFirst) {
      const f = this.#onFirst;
      this.#onFirst = undefined;
      f();
    }
    callback(null, chunk);
  }
}
