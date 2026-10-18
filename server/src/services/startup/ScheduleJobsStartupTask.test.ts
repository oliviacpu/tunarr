/**
 * The scheduled full guide rebuild (UpdateXmlTvTask) runs at the XMLTV
 * settings' start hour and every refreshHours after it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../util/logging/LoggerFactory.ts', () => {
  const stubLogger: Record<string, unknown> = {};
  for (const level of ['error', 'warn', 'info', 'debug', 'trace', 'fatal']) {
    stubLogger[level] = () => {};
  }
  stubLogger.child = () => stubLogger;
  return {
    LoggerFactory: { child: () => stubLogger, root: stubLogger },
  };
});

vi.mock('../../util/inject.ts', () => ({
  InjectLogger: () => () => {},
}));

vi.mock('../../container.ts', () => ({
  container: { get: () => () => ({}) },
}));

const scheduled = vi.hoisted(() => [] as { name: string; schedule: unknown }[]);

vi.mock('../../tasks/ScheduledTask.ts', () => ({
  ScheduledTask: class {
    name: string;
    schedule: unknown;
    runAtStartup = false;
    constructor(ctor: { name: string }, schedule: unknown) {
      this.name = ctor.name;
      this.schedule = schedule;
    }
  },
}));

vi.mock('../Scheduler.ts', () => ({
  GlobalScheduler: {
    scheduleTask: (_id: string, task: { name: string; schedule: unknown }) => {
      scheduled.push(task);
      return true;
    },
    scheduledJobsById: {},
  },
  hoursCrontab: (hours: number, minute = 0) => `0 ${minute} */${hours} * * *`,
  minutesCrontab: (mins: number) => `*/${mins} * * * *`,
  scheduleBackupJobs: () => {},
}));

function stubTask(name: string) {
  return {
    [name]: class {
      static ID = name;
      static KEY = name;
    },
  };
}
vi.mock('../../tasks/CleanupSessionsTask.ts', () =>
  stubTask('CleanupSessionsTask'),
);
vi.mock('../../tasks/OnDemandChannelStateTask.ts', () =>
  stubTask('OnDemandChannelStateTask'),
);
vi.mock('../../tasks/RefreshMediaSourceLibraryTask.ts', () =>
  stubTask('RefreshMediaSourceLibraryTask'),
);
vi.mock('../../tasks/ScanLibrariesTask.ts', () =>
  stubTask('ScanLibrariesTask'),
);
vi.mock('../../tasks/SubtitleExtractorTask.ts', () =>
  stubTask('SubtitleExtractorTask'),
);
vi.mock('../../tasks/SyncCollectionsTask.ts', () =>
  stubTask('SyncCollectionsTask'),
);
vi.mock('../../tasks/SyncCustomShowsTask.ts', () =>
  stubTask('SyncCustomShowsTask'),
);
vi.mock('../../tasks/UpdateXmlTvTask.ts', () => stubTask('UpdateXmlTvTask'));

import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { ScheduleJobsStartupTask } from './ScheduleJobsStartupTask.ts';

function settingsWith(refreshHours: number, refreshStartHour: number) {
  return {
    xmlTvSettings: () => ({ refreshHours, refreshStartHour }),
    globalMediaSourceSettings: () => ({ rescanIntervalHours: 6 }),
    backup: { configurations: [] },
  } as unknown as ISettingsDB;
}

async function guideSchedule(refreshHours: number, refreshStartHour: number) {
  scheduled.length = 0;
  await new ScheduleJobsStartupTask(
    settingsWith(refreshHours, refreshStartHour),
  ).getPromise();
  return scheduled.find((task) => task.name === 'UpdateXmlTvTask')?.schedule;
}

describe('ScheduleJobsStartupTask', () => {
  it('schedules the guide rebuild from the settings start hour', async () => {
    expect(await guideSchedule(24, 3)).toBe('0 0 3 * * *');
    expect(await guideSchedule(4, 3)).toBe('0 0 3,7,11,15,19,23 * * *');
  });

  it('with the default start hour, runs at the hours it always did', async () => {
    expect(await guideSchedule(4, 0)).toBe('0 0 0,4,8,12,16,20 * * *');
  });
});
