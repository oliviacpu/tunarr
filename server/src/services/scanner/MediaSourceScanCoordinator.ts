import type { MediaSourceId } from '@tunarr/shared';
import type { MutexInterface } from 'async-mutex';
import { E_ALREADY_LOCKED, tryAcquire } from 'async-mutex';
import { inject, injectable } from 'inversify';
import PQueue from 'p-queue';
import { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { MediaSourceType } from '../../db/schema/base.ts';
import { ReconcileProgramDurationsTask } from '../../tasks/ReconcileProgramDurationsTask.ts';
import { autoFactoryKey, KEYS } from '../../types/inject.ts';
import { Result } from '../../types/result.ts';
import type { Maybe } from '../../types/util.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { GlobalScheduler } from '../Scheduler.ts';
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';

@injectable()
export class MediaSourceScanCoordinator {
  // One scan at a time. The coordinator is a singleton, so these are shared.
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly signalById = new Map<string, AbortController>();

  @InjectLogger() declare private readonly logger: Logger;

  constructor(
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(EntityMutex) private entityMutex: EntityMutex,
    @inject(KEYS.MediaSourceLibraryScanner)
    private scannerFactory: GenericMediaSourceScannerFactory,
    @inject(KEYS.LocalMediaSourceScanner)
    private localScannerFactory: GenericLocalMediaSourceScannerFactory,
    @inject(MediaSourceProgressService)
    private progressService: MediaSourceProgressService,
    @inject(KEYS.ExternalCollectionScannerFactory)
    private collectionScannerFactory: (
      sourceType: MediaSourceType,
    ) => Maybe<GenericExternalCollectionScanner>,
    @inject(autoFactoryKey(ReconcileProgramDurationsTask))
    private reconcileDurationsTaskFactory: () => ReconcileProgramDurationsTask,
  ) {}

  async addLocal({
    mediaSourceId,
    forceScan,
    pathFilter,
  }: LocalScanRequest): Promise<boolean> {
    const mediaSource = await this.mediaSourceDB.getById(mediaSourceId);
    if (!mediaSource) {
      this.logger.error('No media source find with ID %s', mediaSourceId);
      return false;
    }

    const mediaSourceType = mediaSource.type;
    if (mediaSourceType !== 'local') {
      this.logger.error(
        'Scanning remote libraries is not supported by this scanner',
      );
      return false;
    }

    const mediaType = mediaSource.mediaType;
    if (mediaType === null) {
      this.logger.error(
        'Local media source %s has no media type; cannot scan it',
        mediaSource.uuid,
      );
      return false;
    }

    const scanner = Result.attempt(() =>
      this.localScannerFactory(mediaType),
    ).orNull();
    if (!scanner) {
      this.logger.error(
        'Could not create scanner for media source: %O',
        mediaSource,
      );
      return false;
    }

    return this.enqueue({
      id: mediaSource.uuid,
      label: `media source ${mediaSource.uuid}`,
      getLock: () => this.entityMutex.getLockForMediaSource(mediaSource),
      cancel: () => scanner.cancel(),
      run: () => scanner.scan({ mediaSource, force: forceScan, pathFilter }),
    });
  }

  async add({
    libraryId,
    forceScan,
    pathFilter,
  }: ScanRequest): Promise<boolean> {
    const library = await this.mediaSourceDB.getLibrary(libraryId);

    if (!library) {
      this.logger.error('No library found with ID %s', libraryId);
      return false;
    }

    // Scanning a library the server no longer reports would mark all of its
    // programs missing.
    if (library.unavailableSince !== null) {
      this.logger.warn(
        "Skipping scan of library '%s' (ID = %s): unavailable since %s",
        library.name,
        library.uuid,
        library.unavailableSince.toISOString(),
      );
      return false;
    }

    const mediaSourceType = library.mediaSource.type;
    if (mediaSourceType === 'local') {
      this.logger.error('Scanning local libraries is not supported by scanner');
      return false;
    }

    const scanner = Result.attempt(() =>
      this.scannerFactory(mediaSourceType, library.mediaType),
    ).orNull();
    if (!scanner) {
      this.logger.error('Could not create scanner for library: %O', library);
      return false;
    }

    const collectionScanner = this.collectionScannerFactory(
      library.mediaSource.type,
    );

    return this.enqueue({
      id: library.uuid,
      label: `library ${library.uuid}`,
      getLock: () => this.entityMutex.getLockForLibrary(library),
      cancel: () => scanner.cancel(library.uuid),
      run: async (signal) => {
        await scanner.scan({ library, force: forceScan, pathFilter });
        // A canceled scan returns normally; don't follow it with a full
        // collection scan
        if (collectionScanner && !signal.aborted) {
          await collectionScanner.scanLibrary({
            libraryId: library.uuid,
            force: forceScan,
          });
        }
      },
    });
  }

  /**
   * Takes the scan's lock and queues the scan. Whatever happens to the job,
   * the lock is released, its progress ends and its abort controller is
   * dropped; a job canceled while still queued never runs.
   */
  private async enqueue({
    id,
    label,
    getLock,
    cancel,
    run,
  }: QueuedScan): Promise<boolean> {
    let releaser: MutexInterface.Releaser;
    try {
      releaser = await tryAcquire(await getLock()).acquire();
    } catch (e) {
      if (e === E_ALREADY_LOCKED) {
        this.logger.error('Could not acquire lock for %s', label);
      } else {
        this.logger.error(e, 'Error while scheduling scan for %s', label);
      }
      return false;
    }

    const controller = new AbortController();
    this.signalById.set(id, controller);
    this.progressService.scanQueued(id);
    let started = false;

    this.queue
      .add(async () => {
        if (controller.signal.aborted) {
          this.logger.info('Scan of %s was canceled before it started', label);
          return;
        }
        started = true;
        controller.signal.addEventListener('abort', () => cancel(), {
          once: true,
        });
        await run(controller.signal);
      })
      .catch((e) => this.logger.error(e, 'Error scanning %s', label))
      .finally(() => {
        releaser();
        this.signalById.delete(id);
        // Scanners end their own progress when they finish, but not when they
        // fail or are canceled
        if (this.progressService.getScanProgress(id).state !== 'not_scanning') {
          this.progressService.scanEnded(id);
        }
        if (started) {
          this.reconcileProgramDurations();
        }
      });

    return true;
  }

  // A scan can change program durations. Channel lineups keep their own copy,
  // which streaming schedules from, so it is brought back in line here.
  private reconcileProgramDurations() {
    GlobalScheduler.runTask(this.reconcileDurationsTaskFactory(), undefined);
  }

  cancelAll() {
    for (const controller of this.signalById.values()) {
      controller.abort();
    }
  }

  // Resolves once the queue is empty and the running scan has finished
  awaitAllFinished() {
    return this.queue.onIdle();
  }
}

type QueuedScan = {
  // The library or media source ID; keys progress and cancellation
  id: string;
  label: string;
  getLock: () => Promise<MutexInterface>;
  cancel: () => void;
  run: (signal: AbortSignal) => Promise<void>;
};

type ScanRequest = {
  libraryId: string;
  forceScan: boolean;
  pathFilter?: string;
};

type LocalScanRequest = {
  mediaSourceId: MediaSourceId;
  forceScan: boolean;
  pathFilter?: string;
};
