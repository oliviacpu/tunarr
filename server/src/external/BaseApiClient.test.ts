import { tag } from '@tunarr/types';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { v4 } from 'uuid';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { z } from 'zod/v4';
import type { MediaSourceName } from '../db/schema/base.ts';
import { BaseApiClient } from './BaseApiClient.ts';

const { fakeLogger } = vi.hoisted(() => {
  const fakeLogger = {
    trace: vi.fn(),
    http_out: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => fakeLogger,
  };
  return { fakeLogger };
});

vi.mock('@/util/logging/LoggerFactory.js', () => ({
  LoggerFactory: { child: () => fakeLogger, root: fakeLogger },
}));

class TestApiClient extends BaseApiClient {}

const ResponseSchema = z.object({ ok: z.boolean() });

let server: http.Server;
let client: TestApiClient;

// `/status/<code>` echoes that status; `/ok` and `/wrong-shape` return 200.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const status = url.startsWith('/status/')
      ? Number(url.slice('/status/'.length))
      : 200;

    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(url === '/wrong-shape' ? { ok: 'yes' } : { ok: true }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;
  client = new TestApiClient({
    mediaSource: {
      uri: `http://127.0.0.1:${port}`,
      accessToken: 'token',
      name: tag<MediaSourceName>('test'),
      uuid: tag(v4()),
      userId: null,
      username: null,
      type: 'jellyfin',
      mediaType: null,
      libraries: [],
      paths: [],
      replacePaths: [],
      sendPlayStatusUpdates: false,
      consecutiveAuthFailures: 0,
    },
  });
});

afterAll(() => {
  server.close();
});

describe('doTypeCheckedGet', () => {
  test('returns a success result for a well formed response', async () => {
    const result = await client.doTypeCheckedGet('/ok', ResponseSchema);

    expect(result.isSuccess()).toBe(true);
    expect(result.get()).toEqual({ ok: true });
  });

  // These statuses used to escape as thrown AxiosErrors, so every isFailure()
  // branch downstream was unreachable.
  test.each([
    [401, 'auth_error'],
    [403, 'auth_error'],
    [404, 'not_found'],
    [500, 'generic_request_error'],
    [503, 'generic_request_error'],
  ])('maps status %i to a %s failure', async (status, expected) => {
    const result = await client.doTypeCheckedGet(
      `/status/${status}`,
      ResponseSchema,
    );

    expect(result.isFailure()).toBe(true);
    expect(result.error.type).toBe(expected);
  });

  test('reports a schema mismatch as a parse error', async () => {
    const result = await client.doTypeCheckedGet(
      '/wrong-shape',
      ResponseSchema,
    );

    expect(result.isFailure()).toBe(true);
    expect(result.error.type).toBe('parse_error');
  });
});

describe('doGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('warns about a 404 by default', async () => {
    await expect(client.doGet({ url: '/status/404' })).rejects.toThrow();

    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Not found: '),
    );
  });

  test('logs a 404 the caller expects at debug only', async () => {
    await expect(
      client.doGet({ url: '/status/404' }, { notFoundIsExpected: true }),
    ).rejects.toThrow();

    expect(fakeLogger.debug).toHaveBeenCalledTimes(1);
    expect(fakeLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Not found: '),
    );
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });

  test('still warns about other statuses when a 404 is expected', async () => {
    await expect(
      client.doGet({ url: '/status/500' }, { notFoundIsExpected: true }),
    ).rejects.toThrow();

    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('API client response error'),
      '/status/500',
      500,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
