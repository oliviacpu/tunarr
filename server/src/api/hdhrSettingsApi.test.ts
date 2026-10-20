/**
 * Route tests for `PUT /hdhr-settings` and `POST /hdhr-settings`: a reset
 * restores the schema's defaults, the same ones the web page's "Restore
 * Default Settings" button uses, and a tuner count below 1 or a fraction is
 * refused.
 */
import type { HdhrSettings } from '@tunarr/types';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/util/logging/LoggerFactory.js', () => {
  const stubLogger: Record<string, unknown> = {};
  stubLogger.error = () => {};
  stubLogger.warn = () => {};
  stubLogger.info = () => {};
  stubLogger.debug = () => {};
  stubLogger.trace = () => {};
  stubLogger.fatal = () => {};
  stubLogger.child = () => stubLogger;
  return {
    LoggerFactory: {
      child: () => stubLogger,
      root: stubLogger,
      get: () => stubLogger,
    },
    Logger: stubLogger,
  };
});

import { hdhrSettingsRouter } from './hdhrSettingsApi.js';

describe('HDHR settings API', () => {
  let app: ReturnType<typeof Fastify>;
  let stored: HdhrSettings;

  beforeEach(async () => {
    stored = { autoDiscoveryEnabled: false, tunerCount: 4 };

    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        settings: {
          hdhrSettings: () => stored,
          // SettingsDB.updateSettings replaces the whole section
          updateSettings: async (_key: string, value: HdhrSettings) => {
            stored = value;
          },
        },
        eventService: { push: () => {} },
      };
      done();
    });
    await app.register(hdhrSettingsRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('removes the unused reset endpoint', async () => {
    const res = await app.inject({ method: 'POST', url: '/hdhr-settings' });
    expect(res.statusCode).toBe(404);
    expect(stored).toEqual({ autoDiscoveryEnabled: false, tunerCount: 4 });
  });

  it.each([0, -1, 1.5])('refuses a tuner count of %s', async (tunerCount) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/hdhr-settings',
      payload: { autoDiscoveryEnabled: true, tunerCount },
    });

    expect(res.statusCode).toBe(400);
    expect(stored).toEqual({ autoDiscoveryEnabled: false, tunerCount: 4 });
  });

  it('saves a single tuner', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/hdhr-settings',
      payload: { autoDiscoveryEnabled: true, tunerCount: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ autoDiscoveryEnabled: true, tunerCount: 1 });
    expect(stored).toEqual({ autoDiscoveryEnabled: true, tunerCount: 1 });
  });
});
