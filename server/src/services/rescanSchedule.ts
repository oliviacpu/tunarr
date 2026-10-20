import { forEach } from 'lodash-es';
import { ScanLibrariesTask } from '../tasks/ScanLibrariesTask.ts';
import { SyncCollectionsTask } from '../tasks/SyncCollectionsTask.ts';
import { SyncCustomShowsTask } from '../tasks/SyncCustomShowsTask.ts';
import { GlobalScheduler, hoursCrontab } from './Scheduler.ts';

// The library scan runs at half past, offset from the hourly library refresh
// so scans never start while library availability is being updated.
export function scanLibrariesCrontab(rescanIntervalHours: number): string {
  return hoursCrontab(rescanIntervalHours, 30);
}

// Smart collection and custom show syncs run on the hour.
export function rescanSyncCrontab(rescanIntervalHours: number): string {
  return hoursCrontab(rescanIntervalHours);
}

/**
 * Moves every job that runs every `rescanIntervalHours` to the new interval.
 * The jobs are scheduled at startup; a run under way finishes, and the next
 * one follows the new interval.
 */
export function rescheduleRescanJobs(rescanIntervalHours: number) {
  const reschedule = (id: string, crontab: string) =>
    forEach(GlobalScheduler.getScheduledJobs(id), (job) =>
      job.reschedule(crontab),
    );

  reschedule(ScanLibrariesTask.ID, scanLibrariesCrontab(rescanIntervalHours));
  reschedule(SyncCollectionsTask.ID, rescanSyncCrontab(rescanIntervalHours));
  reschedule(SyncCustomShowsTask.ID, rescanSyncCrontab(rescanIntervalHours));
}
