import {
  minimumXmlTvGuideHours,
  xmlTvRefreshIntervalHours,
  xmlTvScheduledIntervalHours,
} from '@tunarr/shared/util';
import { inject, injectable } from 'inversify';
import { filter, flatten, forEach, values } from 'lodash-es';
import { container } from '../../container.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { CleanupSessionsTask } from '../../tasks/CleanupSessionsTask.ts';
import { OnDemandChannelStateTask } from '../../tasks/OnDemandChannelStateTask.ts';
import { RefreshMediaSourceLibraryTask } from '../../tasks/RefreshMediaSourceLibraryTask.ts';
import { ScanLibrariesTask } from '../../tasks/ScanLibrariesTask.ts';
import { ScheduledTask } from '../../tasks/ScheduledTask.ts';
import { SubtitleExtractorTask } from '../../tasks/SubtitleExtractorTask.ts';
import { SyncCollectionsTask } from '../../tasks/SyncCollectionsTask.ts';
import { SyncCustomShowsTask } from '../../tasks/SyncCustomShowsTask.ts';
import { UpdateXmlTvTask } from '../../tasks/UpdateXmlTvTask.ts';
import { autoFactoryKey, KEYS } from '../../types/inject.ts';
import { InjectLogger } from '../../util/inject.ts';
import { xmlTvRefreshCrontab } from '../../util/schedulingUtil.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { rescanSyncCrontab, scanLibrariesCrontab } from '../rescanSchedule.ts';
import {
  GlobalScheduler,
  hoursCrontab,
  minutesCrontab,
  scheduleBackupJobs,
} from '../Scheduler.ts';
import { ChannelLineupMigratorStartupTask } from './ChannelLineupMigratorStartupTask.ts';
import { SimpleStartupTask } from './IStartupTask.ts';

@injectable()
export class ScheduleJobsStartupTask extends SimpleStartupTask {
  id = ScheduleJobsStartupTask.name;
  dependencies = [ChannelLineupMigratorStartupTask.name];

  @InjectLogger() declare private readonly logger: Logger;

  constructor(@inject(KEYS.SettingsDB) private settingsDB: ISettingsDB) {
    super();
  }

  getPromise(): Promise<void> {
    const xmlTvSettings = this.settingsDB.xmlTvSettings();
    const scheduledHours = xmlTvScheduledIntervalHours(xmlTvSettings);
    if (
      scheduledHours < xmlTvRefreshIntervalHours(xmlTvSettings.refreshHours)
    ) {
      // Saved before the API refused a timer the guide can't cover
      this.logger.warn(
        'EPG (Hours) is %d, too short for the %d-hour refresh timer, so the guide is rebuilt every %d hours instead. Set EPG (Hours) to at least %d, or shorten the timer, in Settings > XMLTV.',
        xmlTvSettings.programmingHours,
        xmlTvSettings.refreshHours,
        scheduledHours,
        minimumXmlTvGuideHours(xmlTvSettings.refreshHours),
      );
    }

    GlobalScheduler.scheduleTask(
      UpdateXmlTvTask.ID,
      new ScheduledTask(
        UpdateXmlTvTask,
        xmlTvRefreshCrontab(xmlTvSettings),
        container.get<() => UpdateXmlTvTask>(KEYS.UpdateXmlTvTaskFactory),
        {},
      ),
    );

    GlobalScheduler.scheduleTask(
      CleanupSessionsTask.ID,
      new ScheduledTask(
        CleanupSessionsTask,
        minutesCrontab(1),
        container.get<() => CleanupSessionsTask>(CleanupSessionsTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      OnDemandChannelStateTask.ID,
      new ScheduledTask(
        OnDemandChannelStateTask,
        minutesCrontab(1),
        container.get<() => OnDemandChannelStateTask>(
          OnDemandChannelStateTask.KEY,
        ),
        undefined,
        { runAtStartup: true },
      ),
    );

    GlobalScheduler.scheduleTask(
      SubtitleExtractorTask.ID,
      new ScheduledTask(
        SubtitleExtractorTask,
        hoursCrontab(1),
        container.get<() => SubtitleExtractorTask>(
          autoFactoryKey(SubtitleExtractorTask),
        ),
        {},
        {
          runAtStartup: true,
        },
      ),
    );

    GlobalScheduler.scheduleTask(
      RefreshMediaSourceLibraryTask.ID,
      new ScheduledTask(
        RefreshMediaSourceLibraryTask,
        hoursCrontab(1),
        () =>
          container.get<RefreshMediaSourceLibraryTask>(
            RefreshMediaSourceLibraryTask,
          ),
        undefined,
      ),
    );

    // Saving the Scanner settings moves these three to the new interval
    // (rescheduleRescanJobs)
    const { rescanIntervalHours } = this.settingsDB.globalMediaSourceSettings();

    GlobalScheduler.scheduleTask(
      ScanLibrariesTask.ID,
      new ScheduledTask(
        ScanLibrariesTask,
        scanLibrariesCrontab(rescanIntervalHours),
        container.get<() => ScanLibrariesTask>(ScanLibrariesTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      SyncCollectionsTask.ID,
      new ScheduledTask(
        SyncCollectionsTask,
        rescanSyncCrontab(rescanIntervalHours),
        container.get<() => SyncCollectionsTask>(SyncCollectionsTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      SyncCustomShowsTask.ID,
      new ScheduledTask(
        SyncCustomShowsTask,
        rescanSyncCrontab(rescanIntervalHours),
        container.get<() => SyncCustomShowsTask>(SyncCustomShowsTask.KEY),
        undefined,
      ),
    );

    scheduleBackupJobs(this.settingsDB.backup);

    forEach(
      filter(
        flatten(values(GlobalScheduler.scheduledJobsById)),
        (job) => job.runAtStartup,
      ),
      (job) => {
        this.logger.debug('Running startup task %s', job.name);
        job
          .runNow(true)
          .catch((e) =>
            LoggerFactory.root.error(
              e,
              'Error running job %s at startup',
              job.name,
            ),
          );
      },
    );

    return Promise.resolve();
  }
}
