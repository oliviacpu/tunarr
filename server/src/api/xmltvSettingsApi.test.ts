/**
 * Route tests for `PUT /xmltv-settings` and `POST /xmltv-settings`: the
 * rebuild's start hour is kept on a partial update, and a save moves the
 * scheduled rebuild to the new hours before rebuilding once.
 */
import type { XmlTvSettings } from '@tunarr/types';
import { XmlTvSettingsSchema } from '@tunarr/types/schemas';
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

const job = vi.hoisted(() => ({
  reschedule: vi.fn(),
  runNow: vi.fn(async () => undefined),
}));

vi.mock('@/services/Scheduler.js', () => ({
  GlobalScheduler: { getScheduledJob: () => job },
}));

vi.mock('@/tasks/UpdateXmlTvTask.js', () => ({
  UpdateXmlTvTask: { ID: 'update-xmltv' },
}));

vi.mock('@/db/SettingsDB.js', async () => {
  const { XmlTvSettingsSchema } = await import('@tunarr/types/schemas');
  return {
    defaultXmlTvSettings: (dir: string) => ({
      ...XmlTvSettingsSchema.parse({}),
      outputPath: `${dir}/xmltv.xml`,
    }),
  };
});

vi.mock('@/globals.js', () => ({
  serverOptions: () => ({ databaseDirectory: '/data' }),
}));

import { xmlTvSettingsRouter } from './xmltvSettingsApi.js';

describe('XMLTV settings API', () => {
  let app: ReturnType<typeof Fastify>;
  let stored: XmlTvSettings;

  beforeEach(async () => {
    job.reschedule.mockClear();
    job.runNow.mockClear();
    stored = XmlTvSettingsSchema.parse({
      refreshHours: 4,
      refreshStartHour: 3,
      outputPath: '/data/xmltv.xml',
    });

    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        settings: {
          xmlTvSettings: () => stored,
          updateSettings: async (_key: string, value: XmlTvSettings) => {
            stored = { ...stored, ...value };
          },
        },
        eventService: { push: () => {} },
      };
      done();
    });
    await app.register(xmlTvSettingsRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps the start hour when a save leaves it out', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/xmltv-settings',
      payload: { refreshHours: 24 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ refreshHours: 24, refreshStartHour: 3 });
    expect(stored.refreshStartHour).toBe(3);
  });

  it('saves a new start hour and leaves the other fields alone', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/xmltv-settings',
      payload: { refreshStartHour: 4 },
    });

    expect(res.statusCode).toBe(200);
    expect(stored).toMatchObject({ refreshHours: 4, refreshStartHour: 4 });
  });

  it('moves the scheduled rebuild to the new hours, then rebuilds once', async () => {
    await app.inject({
      method: 'PUT',
      url: '/xmltv-settings',
      payload: { refreshHours: 24, refreshStartHour: 3 },
    });

    expect(job.reschedule).toHaveBeenCalledExactlyOnceWith('0 0 3 * * *');
    expect(job.runNow).toHaveBeenCalledOnce();
    expect(job.reschedule.mock.invocationCallOrder[0]).toBeLessThan(
      job.runNow.mock.invocationCallOrder[0] ?? -1,
    );
  });

  it('refuses an hour outside 0-23', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/xmltv-settings',
      payload: { refreshStartHour: 24 },
    });

    expect(res.statusCode).toBe(400);
    expect(stored.refreshStartHour).toBe(3);
    expect(job.runNow).not.toHaveBeenCalled();
  });

  it('a reset goes back to midnight and every 4 hours', async () => {
    const res = await app.inject({ method: 'POST', url: '/xmltv-settings' });

    expect(res.statusCode).toBe(200);
    expect(stored).toMatchObject({ refreshHours: 4, refreshStartHour: 0 });
    expect(job.reschedule).toHaveBeenCalledExactlyOnceWith(
      '0 0 0,4,8,12,16,20 * * *',
    );
  });
});
