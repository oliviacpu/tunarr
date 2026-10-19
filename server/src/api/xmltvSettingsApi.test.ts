/**
 * Route tests for `PUT /xmltv-settings` and `POST /xmltv-settings`: the
 * rebuild's start hour is kept on a partial update, a save moves the
 * scheduled rebuild to the new hours before rebuilding once, and a refresh
 * timer the guide can't last is refused.
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
      programmingHours: 48,
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

  describe('the guide must last until the next rebuild, up to two hours late', () => {
    it('refuses a refresh timer the guide is too short for', async () => {
      stored = { ...stored, programmingHours: 12 };

      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshHours: 12 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toBe(
        'EPG (Hours) is 12, too short for a 12-hour refresh timer: the guide ' +
          'would run out before the next rebuild. It has to be at least 14 ' +
          'hours, two hours longer than the time between rebuilds, since that ' +
          'wait is up to two hours longer on the night the clocks go back.',
      );
      expect(stored.refreshHours).toBe(4);
      expect(job.reschedule).not.toHaveBeenCalled();
      expect(job.runNow).not.toHaveBeenCalled();
    });

    it('refuses a guide too short for the saved refresh timer', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { programmingHours: 4 },
      });

      expect(res.statusCode).toBe(400);
      expect(stored.programmingHours).toBe(48);
      expect(job.runNow).not.toHaveBeenCalled();
    });

    it('refuses both at once, and saves none of the request', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshHours: 12, programmingHours: 6, refreshStartHour: 5 },
      });

      expect(res.statusCode).toBe(400);
      expect(stored).toMatchObject({
        programmingHours: 48,
        refreshHours: 4,
        refreshStartHour: 3,
      });
    });

    it('saves a guide two hours longer than the timer', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshHours: 12, programmingHours: 14 },
      });

      expect(res.statusCode).toBe(200);
      expect(stored).toMatchObject({ programmingHours: 14, refreshHours: 12 });
      expect(job.runNow).toHaveBeenCalledOnce();
    });

    it('a timer of a day or more rebuilds once a day, so a 26-hour guide covers it', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshHours: 48, programmingHours: 26 },
      });

      expect(res.statusCode).toBe(200);
      expect(job.reschedule).toHaveBeenCalledExactlyOnceWith('0 0 3 * * *');
    });

    it('a timer under 1 hour is saved as 1, and checked as 1', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshHours: 0, programmingHours: 3 },
      });

      expect(res.statusCode).toBe(200);
      expect(stored).toMatchObject({ programmingHours: 3, refreshHours: 1 });
    });

    it('settings saved before the check keep working, rebuilt often enough for their guide', async () => {
      stored = { ...stored, programmingHours: 12, refreshHours: 24 };

      const res = await app.inject({
        method: 'PUT',
        url: '/xmltv-settings',
        payload: { refreshStartHour: 5 },
      });

      expect(res.statusCode).toBe(200);
      expect(stored).toMatchObject({
        programmingHours: 12,
        refreshHours: 24,
        refreshStartHour: 5,
      });
      // Every 11 hours from 5, not once a day
      expect(job.reschedule).toHaveBeenCalledExactlyOnceWith(
        '0 0 1,5,15 * * *',
      );
    });
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
