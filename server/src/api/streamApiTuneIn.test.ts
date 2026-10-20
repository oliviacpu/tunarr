import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { PassThrough } from 'node:stream';
import { get } from 'node:http';
import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import { Result } from '@/types/result.js';
import { GenericError } from '@/types/errors.js';
import { ConcatSession } from '@/stream/ConcatSession.ts';

vi.mock('../container.js', () => ({ container: { get: vi.fn() } }));
vi.mock('@/stream/VideoStream.js', () => ({ VideoStream: class {} }));
const { streamApi } = await import('./streamApi.js');
const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
class TestSession extends ConcatSession {
  readonly output = new PassThrough();
  constructor() {
    super(
      { uuid: id } as ChannelOrmWithTranscodeConfig,
      { sessionType: 'hls_concat', audioOnly: false },
      vi.fn(),
    );
  }
  override get rawStream() {
    return this.output;
  }
}

async function appWith(
  acquire: (token: string) => Promise<Result<TestSession, GenericError>>,
) {
  const app = Fastify()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);
  app.decorateRequest('serverCtx', null);
  app.addHook('onRequest', (req, _, done) => {
    (req as unknown as { serverCtx: unknown }).serverCtx = {
      channelDB: {
        getChannel: async () => ({ uuid: id, number: 1, streamMode: 'hls' }),
        loadLineup: async () => ({}),
      },
      sessionManager: {
        getOrCreateConcatSession: (_: string, token: string) => acquire(token),
        endSessionInBackground: vi.fn(),
      },
    };
    done();
  });
  await app.register(streamApi);
  await app.ready();
  return app;
}

test('the MPEG-TS route delivers the first chunk and releases the viewer at EOF', async () => {
  const session = new TestSession();
  const app = await appWith(async (token) => {
    session.addConnection(token, { ip: '127.0.0.1' });
    setImmediate(() => session.output.end('initial transport tables'));
    return Result.success(session);
  });
  try {
    const res = await app.inject(`/stream/channels/${id}.ts`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp2t');
    expect(res.body).toBe('initial transport tables');
    expect(session.numConnections()).toBe(0);
  } finally {
    await app.close();
  }
});

test('session acquisition failure returns an error without a streaming response', async () => {
  const app = await appWith(async () =>
    Result.failure(new GenericError('startup failed')),
  );
  try {
    const res = await app.inject(`/stream/channels/${id}.ts`);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Unable to start session');
  } finally {
    await app.close();
  }
});

test('client cancellation while acquiring a session does not leave a late connection', async () => {
  const session = new TestSession();
  let release: () => void = () => {};
  let requested: () => void = () => {};
  let registered: () => void = () => {};
  const acquired = new Promise<void>((resolve) => {
    registered = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await appWith(async (token) => {
    requested();
    await ready;
    session.addConnection(token, { ip: '127.0.0.1' });
    registered();
    return Result.success(session);
  });
  try {
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const request = get(`${base}/stream/channels/${id}.ts`);
    request.on('error', () => {});
    await started;
    const closed = new Promise<void>((resolve) =>
      request.once('close', resolve),
    );
    request.destroy();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await acquired;
    await vi.waitFor(() => expect(session.numConnections()).toBe(0));
    expect(session.listenerCount('end')).toBe(0);
  } finally {
    release();
    await app.close();
  }
});
