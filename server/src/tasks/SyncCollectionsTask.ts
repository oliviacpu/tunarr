import type { Tag } from '@tunarr/types';
import { inject, injectable } from 'inversify';
import { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { MediaSourceType } from '../db/schema/base.ts';
import type { GenericExternalCollectionScanner } from '../services/scanner/ExternalCollectionScanner.ts';
import { MediaSourceScanCoordinator } from '../services/scanner/MediaSourceScanCoordinator.ts';
import { KEYS } from '../types/inject.ts';
import type { Maybe } from '../types/util.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import type { TaskMetadata } from './Task.ts';
import { SimpleTask } from './Task.ts';
import { simpleTaskDef } from './TaskRegistry.ts';

/**
 * Queues a collection sync for every remote media source. The syncs run in
 * the scan coordinator's queue, in a scan worker when there is one, so they
 * don't stall streams on the main thread.
 */
@injectable()
@simpleTaskDef({
  description:
    'Syncs collections from all configured external media sources (Plex, Jellyfin, Emby)',
})
export class SyncCollectionsTask extends SimpleTask {
  static KEY = Symbol.for(SyncCollectionsTask.name);
  static ID = SyncCollectionsTask.name;
  public ID = SyncCollectionsTask.ID as Tag<
    typeof SyncCollectionsTask.name,
    TaskMetadata
  >;

  @InjectLogger() declare protected readonly logger: Logger;

  constructor(
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(KEYS.ExternalCollectionScannerFactory)
    private collectionScannerFactory: (
      sourceType: MediaSourceType,
    ) => Maybe<GenericExternalCollectionScanner>,
    @inject(MediaSourceScanCoordinator)
    private scanCoordinator: MediaSourceScanCoordinator,
  ) {
    super();
  }

  protected async runInternal(): Promise<void> {
    const allSources = await this.mediaSourceDB.getAll();

    for (const source of allSources) {
      if (source.type === 'local') {
        continue;
      }

      if (!this.collectionScannerFactory(source.type)) {
        this.logger.warn(
          'No collection scanner available for media source type %s',
          source.type,
        );
        continue;
      }

      this.logger.info(
        'Queueing a collection sync for %s media source %s (ID = %s)',
        source.type,
        source.name,
        source.uuid,
      );
      // False when one is already queued; the coordinator logs why
      await this.scanCoordinator.addCollections({ mediaSourceId: source.uuid });
    }
  }
}
