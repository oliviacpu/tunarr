import type { ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type { ConcatSession } from './ConcatSession.ts';
import { CountingPassThrough } from './TuneInTimer.ts';

export const TuneInTimeoutMs = 20_000;

/** Owns one HTTP viewer, including a session that arrives after cancellation. */
export class TuneInConnection {
  private readonly controller = new AbortController();
  readonly stream: CountingPassThrough;
  private timeout: NodeJS.Timeout;
  private session?: ConcatSession;
  private source?: Readable;
  private token?: string;
  private closed = false;
  private reason?: string;
  private failure = new Error('Tune-in cancelled');

  constructor(
    private response: ServerResponse,
    onFirstByte: () => void,
    private onClose: (reason: string, bytes: number) => void,
  ) {
    this.stream = new CountingPassThrough(() => {
      clearTimeout(this.timeout);
      onFirstByte();
    });
    this.timeout = setTimeout(
      () => this.close('startup timeout'),
      TuneInTimeoutMs,
    ).unref();
    response.once('close', this.disconnected);
    this.stream.once('close', this.disconnected);
  }

  get timedOut() {
    return this.reason === 'startup timeout';
  }

  get signal() {
    return this.controller.signal;
  }

  async wait<T>(work: Promise<T>): Promise<T> {
    if (this.signal.aborted) {
      void work.catch(() => {});
      this.signal.throwIfAborted();
    }
    let aborted: () => void = () => {};
    const cancellation = new Promise<never>((_, reject) => {
      aborted = () => reject(this.failure);
      this.signal.addEventListener('abort', aborted, { once: true });
    });
    try {
      return await Promise.race([work, cancellation]);
    } finally {
      this.signal.removeEventListener('abort', aborted);
    }
  }

  adopt(session: ConcatSession, token: string) {
    if (this.closed) {
      session.removeConnection(token);
      return;
    }
    this.session = session;
    this.token = token;
  }

  async attach(): Promise<CountingPassThrough> {
    const session = this.session;
    const source = session?.rawStream;
    if (
      !session ||
      !source ||
      source.destroyed ||
      source.readableEnded ||
      session.hasError ||
      session.stoppingOrStopped
    ) {
      throw new Error('Stream session ended before attachment');
    }
    this.source = source;
    session.once('end', this.ended);
    session.once('cleanup', this.ended);
    session.once('error', this.failed);
    source.once('end', this.ended);
    source.once('close', this.ended);
    source.once('error', this.failed);
    const ready = new Promise<void>((resolve) =>
      this.stream.once('readable', resolve),
    );
    try {
      source.pipe(this.stream);
      await this.wait(ready);
      return this.stream;
    } finally {
      this.stream.removeAllListeners('readable');
    }
  }

  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.reason = reason;
    this.failure = new Error(reason);
    clearTimeout(this.timeout);
    this.response.off('close', this.disconnected);
    this.stream.off('close', this.disconnected);
    this.source?.unpipe(this.stream);
    this.source?.off('end', this.ended);
    this.source?.off('close', this.ended);
    this.source?.off('error', this.failed);
    this.session?.off('end', this.ended);
    this.session?.off('cleanup', this.ended);
    this.session?.off('error', this.failed);
    if (this.token !== undefined) this.session?.removeConnection(this.token);
    this.controller.abort(this.failure);
    if (reason === 'session ended') this.stream.end();
    else this.stream.destroy();
    this.onClose(reason, this.stream.bytes);
  }

  private disconnected = () => this.close('client disconnected');
  private ended = () => this.close('session ended');
  private failed = () => this.close('session error');
}
