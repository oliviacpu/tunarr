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
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';

/**
 * Runs one scan job: re-reads the library or media source, scans it, then (for
 * remote libraries) its collections. Runs the same in-process and in a scan
 * worker. Aborting the signal cancels the scanner at its next item.
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
