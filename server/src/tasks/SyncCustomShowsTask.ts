import type { Tag } from '@tunarr/types';
import { inject, injectable } from 'inversify';
import { CustomShowDB } from '../db/CustomShowDB.ts';
import { MediaSourceScanCoordinator } from '../services/scanner/MediaSourceScanCoordinator.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import type { TaskMetadata } from './Task.ts';
import { SimpleTask } from './Task.ts';
import { simpleTaskDef } from './TaskRegistry.ts';

/**
 * Syncs every custom show linked to an external playlist. The syncs run in the
 * scan coordinator's queue, in a scan worker when there is one, so they don't
 * stall streams on the main thread. The task ends when they have run.
 */
@injectable()
@simpleTaskDef({
  description: 'Syncs all custom shows linked to external playlists',
})
export class SyncCustomShowsTask extends SimpleTask {
  static KEY = Symbol.for(SyncCustomShowsTask.name);
  static ID = SyncCustomShowsTask.name;
  public ID = SyncCustomShowsTask.ID as Tag<
    typeof SyncCustomShowsTask.name,
    TaskMetadata
  >;

  @InjectLogger() declare protected readonly logger: Logger;

  constructor(
    @inject(CustomShowDB) private customShowDB: CustomShowDB,
    @inject(MediaSourceScanCoordinator)
    private scanCoordinator: MediaSourceScanCoordinator,
  ) {
    super();
  }

  protected async runInternal(): Promise<void> {
    const syncedShows = await this.customShowDB.getSyncedShows();

    if (syncedShows.length === 0) {
      this.logger.debug('No synced custom shows to process');
      return;
    }

    this.logger.info('Syncing %d custom show(s)', syncedShows.length);

    // The coordinator logs a sync that fails, and the others still run
    await Promise.allSettled(
      syncedShows.map((show) => this.scanCoordinator.syncCustomShow(show.uuid)),
    );
  }
}
