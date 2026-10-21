import 'reflect-metadata';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { v4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BulkChannelStealthResponseSchema } from '@tunarr/types/api';
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

describe('bulk channel stealth API', () => {
  let app: ReturnType<typeof Fastify>;
  const setChannelStealth = vi.fn();
  const updateCachedChannels = vi.fn();
  const regenerateCacheChecked = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    setGlobalOptionsUnchecked({
      database: '/tmp',
      log_level: 'error',
      verbose: 0,
    });
    updateCachedChannels.mockResolvedValue(undefined);
    regenerateCacheChecked.mockResolvedValue(undefined);
    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler);
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      Object.assign(req, {
        serverCtx: {
          channelDB: { setChannelStealth },
          guideService: { updateCachedChannels },
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
      url: '/api/channels/bulk/stealth',
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });

  test.each([
    null,
    {},
    { ids: [], stealth: true },
    { ids: ['not-a-uuid'], stealth: true },
    { ids: Array.from({ length: 101 }, () => v4()), stealth: true },
    { ids: [v4()], stealth: 'true' },
    { ids: [v4()] },
  ])('rejects invalid input before any writes: %j', async (payload) => {
    const response = await send(payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: expect.any(String) });
    expect(setChannelStealth).not.toHaveBeenCalled();
    expect(updateCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test('rejects duplicate IDs before any writes', async () => {
    const id = v4();
    expect((await send({ ids: [id, id], stealth: false })).statusCode).toBe(
      400,
    );
    expect(setChannelStealth).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'returns ordered mixed results and publishes changed IDs once (stealth=%s)',
    async (stealth) => {
      const [missing, changed, alsoChanged, noop] = [v4(), v4(), v4(), v4()];
      const results = [
        {
          id: missing,
          success: false,
          statusCode: 404,
          message: 'Channel not found',
        },
        { id: changed, success: true },
        { id: alsoChanged, success: true },
        { id: noop, success: true },
      ];
      setChannelStealth.mockReturnValue({
        results,
        changedIds: [changed, alsoChanged],
      });
      const response = await send({
        ids: [missing, changed, alsoChanged, noop],
        stealth,
      });
      expect(response.statusCode).toBe(200);
      expect(BulkChannelStealthResponseSchema.parse(response.json())).toEqual({
        results,
        refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
      });
      expect(setChannelStealth).toHaveBeenCalledExactlyOnceWith(
        [missing, changed, alsoChanged, noop],
        stealth,
      );
      expect(updateCachedChannels).toHaveBeenCalledExactlyOnceWith([
        changed,
        alsoChanged,
      ]);
      expect(regenerateCacheChecked).toHaveBeenCalledOnce();
    },
  );

  test('accepts the 100-ID boundary', async () => {
    const ids = Array.from({ length: 100 }, () => v4());
    const results = ids.map((id) => ({ id, success: true }));
    setChannelStealth.mockReturnValue({ results, changedIds: ids });
    const response = await send({ ids, stealth: false });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual(results);
    expect(updateCachedChannels).toHaveBeenCalledExactlyOnceWith(ids);
    expect(regenerateCacheChecked).toHaveBeenCalledOnce();
  });

  test('skips both publications for no-op and missing IDs', async () => {
    const id = v4();
    const missing = v4();
    setChannelStealth.mockReturnValue({
      results: [
        { id, success: true },
        {
          id: missing,
          success: false,
          statusCode: 404,
          message: 'Channel not found',
        },
      ],
      changedIds: [],
    });
    const response = await send({ ids: [id, missing], stealth: true });
    expect(response.json().refresh).toEqual({
      xmltv: 'not_needed',
      m3u: 'not_needed',
    });
    expect(updateCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test('reports no committed successes or publication after a transaction failure', async () => {
    const ids = [v4(), v4()];
    setChannelStealth.mockImplementation(() => {
      throw new Error('SQL/private/path');
    });
    const response = await send({ ids, stealth: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: ids.map((id) => ({
        id,
        success: false,
        statusCode: 500,
        message: 'Could not update channel stealth',
      })),
      refresh: { xmltv: 'not_needed', m3u: 'not_needed' },
    });
    expect(updateCachedChannels).not.toHaveBeenCalled();
    expect(regenerateCacheChecked).not.toHaveBeenCalled();
  });

  test.each(['xmltv', 'm3u', 'both'])(
    'retains committed successes and independently tries publications when %s fails',
    async (failure) => {
      const id = v4();
      const results = [{ id, success: true }];
      setChannelStealth.mockReturnValue({ results, changedIds: [id] });
      if (failure !== 'm3u')
        updateCachedChannels.mockRejectedValue(new Error('XMLTV failed'));
      if (failure !== 'xmltv')
        regenerateCacheChecked.mockRejectedValue(new Error('M3U failed'));
      const response = await send({ ids: [id], stealth: true });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        results,
        refresh: {
          xmltv: failure === 'm3u' ? 'succeeded' : 'failed',
          m3u: failure === 'xmltv' ? 'succeeded' : 'failed',
        },
      });
      expect(updateCachedChannels).toHaveBeenCalledOnce();
      expect(regenerateCacheChecked).toHaveBeenCalledOnce();
    },
  );
});
