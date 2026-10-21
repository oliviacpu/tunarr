import 'reflect-metadata';
import type { BulkChannelDeleteItemResult } from '@tunarr/types/api';
import { BulkChannelDeleteResponseSchema } from '@tunarr/types/api';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { v4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import { channelsApi } from './channelsApi.ts';

vi.mock('../container.ts', () => ({ container: { get: vi.fn() } }));
vi.mock('@/util/logging/LoggerFactory.js', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return {
    LoggerFactory: { child: () => logger, get: () => logger, root: logger },
    getEnvironmentLogLevel: () => undefined,
    getPrettyStreamOpts: () => ({}),
  };
});

describe('bulk channel deletion API', () => {
  let app: ReturnType<typeof Fastify>;
  const deleteChannelChecked =
    vi.fn<(id: string) => Promise<BulkChannelDeleteItemResult>>();
  const removeCachedChannels = vi.fn();
  const regenerateCacheChecked = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    setGlobalOptionsUnchecked({
      database: '/tmp',
      log_level: 'error',
      verbose: 0,
    });
    deleteChannelChecked.mockImplementation((id) =>
      Promise.resolve({ id, success: true, cleanup: { status: 'succeeded' } }),
    );
    removeCachedChannels.mockResolvedValue(undefined);
    regenerateCacheChecked.mockResolvedValue(undefined);
    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler);
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      Object.assign(req, {
        serverCtx: {
          channelDB: { deleteChannelChecked },
          guideService: { removeCachedChannels },
          m3uService: { regenerateCacheChecked },
        },
      });
      done();
    });
    await app.register(channelsApi, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
  });

  const send = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/channels/bulk/delete',
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

  test.each([
    null,
    {},
    { ids: [] },
    { ids: ['not-a-uuid'] },
    { ids: Array.from({ length: 101 }, () => v4()) },
  ])('rejects invalid input before any writes: %j', async (payload) => {
    const response = await send(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: expect.any(String) });
    expect(deleteChannelChecked).not.toHaveBeenCalled();
    expect(removeCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test('rejects duplicate IDs before any writes', async () => {
    const id = v4();
    expect((await send({ ids: [id, id] })).statusCode).toBe(400);
    expect(deleteChannelChecked).not.toHaveBeenCalled();
    expect(removeCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test('retains ordered deletion and cleanup outcomes and publishes only committed removals once', async () => {
    const missing = v4();
    const deleted = v4();
    const cleanupFailed = v4();
    const restoreFailed = v4();
    const alsoDeleted = v4();
    const results: BulkChannelDeleteItemResult[] = [
      {
        id: missing,
        success: false,
        statusCode: 404,
        message: 'Channel not found',
        cleanup: { status: 'not_needed' },
      },
      { id: deleted, success: true, cleanup: { status: 'succeeded' } },
      {
        id: cleanupFailed,
        success: true,
        cleanup: { status: 'failed', message: 'Could not remove redirects' },
      },
      {
        id: restoreFailed,
        success: false,
        statusCode: 500,
        message: 'Could not delete channel',
        cleanup: {
          status: 'failed',
          message: 'Could not restore channel lineup',
        },
      },
      { id: alsoDeleted, success: true, cleanup: { status: 'succeeded' } },
    ];
    for (const result of results) {
      deleteChannelChecked.mockResolvedValueOnce(result);
    }
    const ids = results.map(({ id }) => id);
    const response = await send({ ids });
    expect(response.statusCode).toBe(200);
    expect(BulkChannelDeleteResponseSchema.parse(response.json())).toEqual({
      results,
      refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
    });
    expect(deleteChannelChecked.mock.calls).toEqual(ids.map((id) => [id]));
    expect(removeCachedChannels).toHaveBeenCalledExactlyOnceWith([
      deleted,
      cleanupFailed,
      alsoDeleted,
    ]);
    expect(regenerateCacheChecked).toHaveBeenCalledOnce();
  });

  test('accepts the 100-ID boundary', async () => {
    const ids = Array.from({ length: 100 }, () => v4());
    const response = await send({ ids });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toHaveLength(100);
    expect(deleteChannelChecked.mock.calls).toEqual(ids.map((id) => [id]));
    expect(removeCachedChannels).toHaveBeenCalledExactlyOnceWith(ids);
    expect(regenerateCacheChecked).toHaveBeenCalledOnce();
  });

  test('continues after an unexpected rejection without exposing its reason or retrying', async () => {
    const ids = [v4(), v4(), v4()];
    deleteChannelChecked
      .mockResolvedValueOnce({
        id: ids[0],
        success: true,
        cleanup: { status: 'succeeded' },
      })
      .mockRejectedValueOnce(new Error('SQL/private/path secret'));
    const response = await send({ ids });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      { id: ids[0], success: true, cleanup: { status: 'succeeded' } },
      {
        id: ids[1],
        success: false,
        statusCode: 500,
        message: 'Could not delete channel',
        cleanup: {
          status: 'failed',
          message: 'Could not confirm channel cleanup',
        },
      },
      { id: ids[2], success: true, cleanup: { status: 'succeeded' } },
    ]);
    expect(deleteChannelChecked.mock.calls).toEqual(ids.map((id) => [id]));
    expect(removeCachedChannels).toHaveBeenCalledExactlyOnceWith([
      ids[0],
      ids[2],
    ]);
  });

  test('waits for each checked deletion before starting the next or publishing', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    deleteChannelChecked.mockImplementationOnce(async (id) => {
      await firstFinished;
      return { id, success: true, cleanup: { status: 'succeeded' } };
    });
    const ids = [v4(), v4()];
    const responsePromise = send({ ids }).then((response) => response);
    await vi.waitFor(() => expect(deleteChannelChecked).toHaveBeenCalledOnce());
    expect(deleteChannelChecked).toHaveBeenCalledWith(ids[0]);
    expect(removeCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
    if (releaseFirst === undefined) {
      throw new Error('First deletion was not initialized');
    }
    releaseFirst();
    expect((await responsePromise).statusCode).toBe(200);
    expect(deleteChannelChecked.mock.calls).toEqual(ids.map((id) => [id]));
  });

  test('skips both publications when every deletion fails', async () => {
    const ids = [v4(), v4()];
    deleteChannelChecked
      .mockResolvedValueOnce({
        id: ids[0],
        success: false,
        statusCode: 404,
        message: 'Channel not found',
        cleanup: { status: 'not_needed' },
      })
      .mockResolvedValueOnce({
        id: ids[1],
        success: false,
        statusCode: 500,
        message: 'Could not delete channel',
        cleanup: {
          status: 'failed',
          message: 'Could not restore channel lineup',
        },
      });
    const response = await send({ ids });
    expect(response.json().refresh).toEqual({
      xmltv: 'not_needed',
      m3u: 'not_needed',
    });
    expect(removeCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test.each(['xmltv', 'm3u', 'both'])(
    'retains committed successes and independently tries publications when %s fails',
    async (failure) => {
      const id = v4();
      if (failure !== 'm3u')
        removeCachedChannels.mockRejectedValue(new Error('XMLTV failed'));
      if (failure !== 'xmltv')
        regenerateCacheChecked.mockRejectedValue(new Error('M3U failed'));
      const response = await send({ ids: [id] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        results: [{ id, success: true, cleanup: { status: 'succeeded' } }],
        refresh: {
          xmltv: failure === 'm3u' ? 'succeeded' : 'failed',
          m3u: failure === 'xmltv' ? 'succeeded' : 'failed',
        },
      });
      expect(removeCachedChannels).toHaveBeenCalledExactlyOnceWith([id]);
      expect(regenerateCacheChecked).toHaveBeenCalledOnce();
    },
  );
});
