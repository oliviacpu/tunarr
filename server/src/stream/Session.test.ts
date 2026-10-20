import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import { Result } from '@/types/result.js';
import { Session } from './Session.ts';
import { DirectStreamSession } from './DirectStreamSession.ts';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import { PassThrough } from 'node:stream';

class TestSession extends Session {
  readonly sessionType = 'hls';
  readonly failure = new Error('readiness failed');
  failSetup = false;
  failReady = false;
  markFailureEarly = false;
  stopWhileStarting = false;
  constructor() {
    super({ uuid: 'test' } as ChannelOrmWithTranscodeConfig, {});
  }
  protected async startInternal() {
    if (this.failSetup) throw this.failure;
  }
  protected async stopInternal() {}
  protected override async waitForStreamReady() {
    if (this.markFailureEarly) this.state = 'error';
    if (this.stopWhileStarting) this.state = 'stopping';
    return this.failReady
      ? Result.forError(this.failure)
      : Result.success(void 0);
  }
}

test.each(['failSetup', 'failReady'] as const)(
  '%s stays failed and retains its cause',
  async (flag) => {
    const session = new TestSession();
    session[flag] = true;
    const error = vi.fn();
    const ready = vi.fn();
    session.on('error', error);
    session.on('start', ready);
    await session.start();
    expect(session.hasError).toBe(true);
    expect(
      session.error === session.failure ||
        session.error?.cause === session.failure,
    ).toBe(true);
    expect(error).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  },
);

test('readiness cannot resurrect a stopping session', async () => {
  const session = new TestSession();
  session.stopWhileStarting = true;
  await session.start();
  expect(session.state).toBe('stopping');
});

test('successful readiness emits start exactly once', async () => {
  const session = new TestSession();
  const ready = vi.fn();
  session.on('start', ready);
  await session.start();
  expect(session.started).toBe(true);
  expect(ready).toHaveBeenCalledOnce();
});

test('direct-session timing does not consume initial data before a viewer attaches', async () => {
  const output = new PassThrough();
  class Direct extends DirectStreamSession {
    readonly sessionType = 'hls_concat';
    constructor() {
      super({ uuid: 'test' } as ChannelOrmWithTranscodeConfig, {});
    }
    protected async stopStream() {}
    protected async initializeStream() {
      return { start: () => output } as unknown as FfmpegTranscodeSession;
    }
  }
  const session = new Direct();
  await session.start();
  output.write('initial transport tables and keyframe');
  await new Promise((resolve) => setImmediate(resolve));
  expect(session.rawStream?.read().toString()).toBe(
    'initial transport tables and keyframe',
  );
  await session.stop();
  output.destroy();
});

test('a readiness poller that already set error still publishes its cause', async () => {
  const session = new TestSession();
  session.failReady = session.markFailureEarly = true;
  const error = vi.fn();
  session.on('error', error);
  await session.start();
  expect(session.hasError).toBe(true);
  expect(session.error?.cause).toBe(session.failure);
  expect(error).toHaveBeenCalledOnce();
});
