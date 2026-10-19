/**
 * Route tests for `PUT /settings/media-source`: saving a new rescan interval
 * moves the scheduled library scan and the collection and custom show syncs
 * to it at once, without a restart, and an interval the scheduler can't run
 * is refused.
 *
 * The scheduler and its jobs are real; only the tasks they would run are
 * stubs.
 */
import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/util/logging/LoggerFactory.js', () => {
  const stubLogger: Record<string, unknown> = {};
  for (const level of ['error', 'warn', 'info', 'debug', 'trace', 'fatal']) {
    stubLogger[level] = () => {};
  }
  stubLogger.child = () => stubLogger;
  return {
    LoggerFactory: { child: () => stubLogger, root: stubLogger },
  };
});

// The scheduler's imports that would pull in the whole server
vi.mock('@/container.js', () => ({ container: { get: () => undefined } }));
vi.mock('@/tasks/BackupTask.js', () => ({ BackupTask: class {} }));
vi.mock('@/util/schedulingUtil.js', () => ({
  scheduleRuleToCronString: () => '',
}));

function stubTask(name: string) {
  return {
    [name]: class {
      static ID = name;
    },
  };
}
vi.mock('@/tasks/ScanLibrariesTask.js', () => stubTask('ScanLibrariesTask'));
vi.mock('@/tasks/SyncCollectionsTask.js', () =>
  stubTask('SyncCollectionsTask'),
);
vi.mock('@/tasks/SyncCustomShowsTask.js', () =>
  stubTask('SyncCustomShowsTask'),
);

import { GlobalScheduler } from '@/services/Scheduler.js';
import {
  rescanSyncCrontab,
  scanLibrariesCrontab,
} from '@/services/rescanSchedule.js';
import { ScheduledTask } from '@/tasks/ScheduledTask.js';
import type z from 'zod';
import { settingsApi } from './settingsApi.js';

const RescanJobs = [
  'ScanLibrariesTask',
  'SyncCollectionsTask',
  'SyncCustomShowsTask',
] as const;

type RescanJob = (typeof RescanJobs)[number];

// 10:10 local time; the crontabs count hours from local midnight
const Now = new Date(2026, 9, 19, 10, 10);

function nextRun(id: RescanJob) {
  const jobs = GlobalScheduler.getScheduledJobs(id);
  expect(jobs).toHaveLength(1);
  return dayjs(jobs[0]?.nextExecution()).format('HH:mm');
}

describe('PUT /settings/media-source', () => {
  let app: ReturnType<typeof Fastify>;
  let stored: GlobalMediaSourceSettings;

  beforeEach(async () => {
    // Only the clock: the jobs' timers stay real, and are cleared after
    vi.useFakeTimers({ now: Now, toFake: ['Date'] });
    stored = { rescanIntervalHours: 6 };

    // As ScheduleJobsStartupTask schedules them at startup
    const neverRun = () => {
      throw new Error('a stub job ran');
    };
    for (const id of RescanJobs) {
      const crontab =
        id === 'ScanLibrariesTask'
          ? scanLibrariesCrontab(stored.rescanIntervalHours)
          : rescanSyncCrontab(stored.rescanIntervalHours);
      GlobalScheduler.scheduleTask(
        id,
        new ScheduledTask<z.ZodUnknown, void>(id, crontab, neverRun, undefined),
      );
    }

    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        settings: {
          globalMediaSourceSettings: () => stored,
          updateSettings: async (
            _key: string,
            value: GlobalMediaSourceSettings,
          ) => {
            stored = { ...stored, ...value };
          },
        },
      };
      done();
    });
    await app.register(settingsApi);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    for (const id of RescanJobs) {
      GlobalScheduler.clearTasks(id);
    }
    vi.useRealTimers();
  });

  it('every 6 hours from midnight, the next scan is at 12:30 and the syncs at 12:00', () => {
    expect(nextRun('ScanLibrariesTask')).toBe('12:30');
    expect(nextRun('SyncCollectionsTask')).toBe('12:00');
    expect(nextRun('SyncCustomShowsTask')).toBe('12:00');
  });

  it('saving a new interval moves the next scan and syncs to it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media-source',
      payload: { rescanIntervalHours: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rescanIntervalHours: 1 });
    expect(nextRun('ScanLibrariesTask')).toBe('10:30');
    expect(nextRun('SyncCollectionsTask')).toBe('11:00');
    expect(nextRun('SyncCustomShowsTask')).toBe('11:00');
  });

  it('a longer interval moves them later', async () => {
    await app.inject({
      method: 'PUT',
      url: '/settings/media-source',
      payload: { rescanIntervalHours: 8 },
    });

    expect(nextRun('ScanLibrariesTask')).toBe('16:30');
    expect(nextRun('SyncCollectionsTask')).toBe('16:00');
    expect(nextRun('SyncCustomShowsTask')).toBe('16:00');
  });

  it.each([0, 1.5])(
    'refuses %d hours, which the scheduler cannot run, and keeps the jobs where they were',
    async (rescanIntervalHours) => {
      const res = await app.inject({
        method: 'PUT',
        url: '/settings/media-source',
        payload: { rescanIntervalHours },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        message: `The rescan interval must be a whole number of hours, 1 or more (got ${rescanIntervalHours}).`,
      });
      expect(stored.rescanIntervalHours).toBe(6);
      expect(nextRun('ScanLibrariesTask')).toBe('12:30');
      expect(nextRun('SyncCollectionsTask')).toBe('12:00');
    },
  );
});
