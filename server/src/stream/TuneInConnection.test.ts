import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import { ConcatSession } from './ConcatSession.ts';
import { TuneInConnection, TuneInTimeoutMs } from './TuneInConnection.ts';

class TestSession extends ConcatSession {
  readonly output = new PassThrough();
  constructor() {
    super(
      { uuid: 'test' } as ChannelOrmWithTranscodeConfig,
      { audioOnly: false, sessionType: 'hls_concat' },
      vi.fn(),
    );
  }
  override get rawStream() {
    return this.output;
  }
}

function setup(session = new TestSession()) {
  const response = new EventEmitter() as ServerResponse;
  const first = vi.fn();
  const closed = vi.fn();
  const connection = new TuneInConnection(response, first, closed);
  session.addConnection('viewer', { ip: '127.0.0.1' });
  connection.adopt(session, 'viewer');
  return { connection, response, session, first, closed };
}

afterEach(() => vi.useRealTimers());

test('retains initial bytes while waiting for the HTTP response to attach', async () => {
  const { connection, session, first } = setup();
  const attaching = connection.attach();
  session.output.write('PAT-PMT-keyframe');
  const stream = await attaching;
  expect(stream.read().toString()).toBe('PAT-PMT-keyframe');
  expect(first).toHaveBeenCalledOnce();
  connection.close('test complete');
});

test('disconnect removes only this viewer and every session listener', async () => {
  const { connection, session, response, closed } = setup();
  session.addConnection('other', { ip: '127.0.0.2' });
  const attaching = connection.attach();
  const rejected = expect(attaching).rejects.toThrow('client disconnected');
  response.emit('close');
  await rejected;
  session.emit('end');
  expect(closed).toHaveBeenCalledOnce();
  expect(session.isKnownConnection('other')).toBe(true);
  expect(session.isKnownConnection('viewer')).toBe(false);
  expect(session.listenerCount('end')).toBe(0);
  expect(session.listenerCount('error')).toBe(0);
  expect(session.output.listenerCount('data')).toBe(0);
});

test('releases a connection whose acquisition finishes after cancellation', async () => {
  const { connection, session, response } = setup();
  response.emit('close');
  session.addConnection('late', { ip: '127.0.0.1' });
  connection.adopt(session, 'late');
  expect(session.numConnections()).toBe(0);
});

test('silent startup expires even before session acquisition finishes', async () => {
  vi.useFakeTimers();
  const { connection, closed } = setup();
  const waiting = connection.wait(new Promise<void>(() => {}));
  const rejected = expect(waiting).rejects.toThrow('startup timeout');
  await vi.advanceTimersByTimeAsync(TuneInTimeoutMs);
  await rejected;
  expect(closed).toHaveBeenCalledWith('startup timeout', 0);
});

test('first output cancels the startup deadline for a playing viewer', async () => {
  vi.useFakeTimers();
  const { connection, session, closed } = setup();
  const attaching = connection.attach();
  session.output.write('first');
  await vi.advanceTimersByTimeAsync(0);
  await attaching;
  await vi.advanceTimersByTimeAsync(TuneInTimeoutMs);
  expect(closed).not.toHaveBeenCalled();
  connection.close('test complete');
});

test.each(['end', 'error', 'cleanup'] as const)(
  '%s rejects pending startup promptly',
  async (event) => {
    const { connection, session } = setup();
    const attaching = connection.attach();
    const rejected = expect(attaching).rejects.toThrow(
      event === 'error' ? 'session error' : 'session ended',
    );
    if (event === 'error') session.emit(event, new Error('failed'));
    else session.emit(event);
    await rejected;
    expect(session.numConnections()).toBe(0);
  },
);

test('100 rapid detach/reattach cycles leave no listeners or connections behind', async () => {
  const session = new TestSession();
  for (let i = 0; i < 100; i++) {
    const { connection, response } = setup(session);
    const attaching = connection.attach();
    session.output.write('frame');
    await attaching;
    response.emit('close');
    expect(session.numConnections()).toBe(0);
    expect(session.listenerCount('end')).toBe(0);
    expect(session.output.listenerCount('data')).toBe(0);
  }
});

test('disconnecting one viewer leaves the other receiving bytes', async () => {
  const { connection, session, response } = setup();
  const other = new TuneInConnection(
    new EventEmitter() as ServerResponse,
    vi.fn(),
    vi.fn(),
  );
  session.addConnection('second', { ip: '127.0.0.2' });
  other.adopt(session, 'second');
  const firstReady = connection.attach();
  const secondReady = other.attach();
  session.output.write('first');
  await firstReady;
  const stream = await secondReady;
  response.emit('close');
  session.output.write('second');
  expect(stream.read().toString()).toBe('firstsecond');
  expect(session.output.destroyed).toBe(false);
  expect(session.isKnownConnection('second')).toBe(true);
  other.close('test complete');
});
