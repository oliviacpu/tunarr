import type { MediaSourceId } from '@tunarr/shared';
import { tag } from '@tunarr/types';
import { inject, injectable } from 'inversify';
import { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { MediaSourceType } from '../../db/schema/base.ts';
import { KEYS } from '../../types/inject.ts';
import type { Maybe } from '../../types/util.ts';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { CustomShowSyncService } from '../CustomShowSyncService.ts';
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';

/**
 * Runs one scan job: re-reads the library or media source, scans it, then (for
 * remote libraries) its collections. A collections job syncs a remote media
 * source's collections, and a custom-show job syncs a custom show from its
 * playlist. Runs the same in-process and in a scan worker. Aborting the signal
 * cancels the scanner at its next item.
 */
@injectable()
export class ScanJobExecutor {
  @InjectLogger() declare private readonly logger: Logger;

  constructor(
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(KEYS.MediaSourceLibraryScanner)
    private scannerFactory: GenericMediaSourceScannerFactory,
    @inject(KEYS.LocalMediaSourceScanner)
    private localScannerFactory: GenericLocalMediaSourceScannerFactory,
    @inject(KEYS.ExternalCollectionScannerFactory)
    private collectionScannerFactory: (
      sourceType: MediaSourceType,
    ) => Maybe<GenericExternalCollectionScanner>,
    @inject(CustomShowSyncService)
    private customShowSync: CustomShowSyncService,
  ) {}

  async run(job: ScanJob, signal: AbortSignal): Promise<ScanOutcome> {
    if (signal.aborted) {
      return 'canceled';
    }
    switch (job.kind) {
      case 'library':
        return this.runLibrary(job, signal);
      case 'local':
        return this.runLocal(job, signal);
      case 'collections':
        return this.runCollections(job, signal);
      case 'custom-show':
        // Re-reads the show, and skips it if it's gone or no longer synced
        return this.customShowSync.syncShow(job.customShowId, signal);
    }
  }

  private async runLibrary(
    job: Extract<ScanJob, { kind: 'library' }>,
    signal: AbortSignal,
  ): Promise<ScanOutcome> {
    const library = await this.mediaSourceDB.getLibrary(job.libraryId);
    if (!library) {
      this.logger.warn('Library %s no longer exists; skipping', job.libraryId);
      return 'skipped';
    }
    // The job may have waited in the queue for hours. Scanning a library the
    // server no longer reports would mark all of its programs missing.
    if (library.unavailableSince !== null) {
      this.logger.warn(
        "Skipping scan of library '%s' (ID = %s): unavailable since %s",
        library.name,
        library.uuid,
        library.unavailableSince.toISOString(),
      );
      return 'skipped';
    }
    const sourceType = library.mediaSource.type;
    if (sourceType === 'local') {
      this.logger.warn('Library %s belongs to a local source', library.uuid);
      return 'skipped';
    }

    const scanner = this.scannerFactory(sourceType, library.mediaType);
    const collectionScanner = this.collectionScannerFactory(sourceType);
    const onAbort = () => scanner.cancel(library.uuid);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await scanner.scan({
        library,
        force: job.force,
        pathFilter: job.pathFilter,
      });
      // A canceled scan returns normally; don't follow it with a full
      // collection scan
      if (signal.aborted) {
        return 'canceled';
      }
      if (collectionScanner) {
        await collectionScanner.scanLibrary({
          libraryId: library.uuid,
          force: job.force,
        });
      }
      return signal.aborted ? 'canceled' : 'completed';
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async runCollections(
    job: Extract<ScanJob, { kind: 'collections' }>,
    signal: AbortSignal,
  ): Promise<ScanOutcome> {
    const mediaSource = await this.mediaSourceDB.getById(
      tag<MediaSourceId>(job.mediaSourceId),
    );
    if (!mediaSource || mediaSource.type === 'local') {
      this.logger.warn(
        'Media source %s no longer exists or has no collections; skipping',
        job.mediaSourceId,
      );
      return 'skipped';
    }
    const scanner = this.collectionScannerFactory(mediaSource.type);
    if (!scanner) {
      this.logger.warn(
        'No collection scanner for %s media source %s; skipping',
        mediaSource.type,
        mediaSource.uuid,
      );
      return 'skipped';
    }

    this.logger.info(
      'Scanning collections for %s media source %s (ID = %s)',
      mediaSource.type,
      mediaSource.name,
      mediaSource.uuid,
    );
    // The collection scanner can't stop partway, so a canceled sync ends when
    // the scan does (a scan worker is terminated if that takes too long)
    await scanner.scan({ mediaSourceId: mediaSource.uuid });
    return signal.aborted ? 'canceled' : 'completed';
  }

  private async runLocal(
    job: Extract<ScanJob, { kind: 'local' }>,
    signal: AbortSignal,
  ): Promise<ScanOutcome> {
    const mediaSource = await this.mediaSourceDB.getById(
      tag<MediaSourceId>(job.mediaSourceId),
    );
    if (!mediaSource || mediaSource.type !== 'local') {
      this.logger.warn(
        'Local media source %s no longer exists; skipping',
        job.mediaSourceId,
      );
      return 'skipped';
    }
    const mediaType = mediaSource.mediaType;
    if (mediaType === null) {
      this.logger.warn('Media source %s has no media type', mediaSource.uuid);
      return 'skipped';
    }

    const scanner = this.localScannerFactory(mediaType);
    const onAbort = () => scanner.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await scanner.scan({
        mediaSource,
        force: job.force,
        pathFilter: job.pathFilter,
      });
      return signal.aborted ? 'canceled' : 'completed';
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
