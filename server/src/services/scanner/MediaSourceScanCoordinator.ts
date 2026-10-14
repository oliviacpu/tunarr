import type { MediaSourceId } from '@tunarr/shared';
import type { MutexInterface } from 'async-mutex';
import { E_ALREADY_LOCKED, tryAcquire } from 'async-mutex';
import { inject, injectable } from 'inversify';
import PQueue from 'p-queue';
import { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import { ReconcileProgramDurationsTask } from '../../tasks/ReconcileProgramDurationsTask.ts';
import { autoFactoryKey, KEYS } from '../../types/inject.ts';
import { Result } from '../../types/result.ts';
import type { Maybe } from '../../types/util.ts';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { GlobalScheduler } from '../Scheduler.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';

@injectable()
export class MediaSourceScanCoordinator {
  // One scan at a time. The coordinator is a singleton, so these are shared.
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly signalById = new Map<string, AbortController>();
  // Each queued job including its cleanup, so callers can wait for both
  private readonly inFlight = new Set<Promise<void>>();
  private shuttingDown = false;

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
    @inject(KEYS.ScanJobRunner) private runner: ScanJobRunner,
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

    // Only to refuse unsupported sources up front; the runner makes its own
    if (Result.attempt(() => this.localScannerFactory(mediaType)).isFailure()) {
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
      job: {
        kind: 'local',
        mediaSourceId: mediaSource.uuid,
        force: forceScan,
        pathFilter,
      },
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

    // Only to refuse unsupported libraries up front; the runner makes its own
    if (
      Result.attempt(() =>
        this.scannerFactory(mediaSourceType, library.mediaType),
      ).isFailure()
    ) {
      this.logger.error('Could not create scanner for library: %O', library);
      return false;
    }

    return this.enqueue({
      id: library.uuid,
      label: `library ${library.uuid}`,
      getLock: () => this.entityMutex.getLockForLibrary(library),
      job: {
        kind: 'library',
        libraryId: library.uuid,
        force: forceScan,
        pathFilter,
      },
    });
  }

  /**
   * Queues a sync of a remote media source's collections. It shares the queue
   * with library scans, so only one scan job writes to the database at a time.
   */
  async addCollections({
    mediaSourceId,
  }: CollectionsScanRequest): Promise<boolean> {
    const mediaSource = await this.mediaSourceDB.getById(mediaSourceId);
    if (!mediaSource) {
      this.logger.error('No media source found with ID %s', mediaSourceId);
      return false;
    }
    if (mediaSource.type === 'local') {
      this.logger.error(
        'Local media source %s has no collections to sync',
        mediaSource.uuid,
      );
      return false;
    }

    return this.enqueue({
      id: `collections.${mediaSource.uuid}`,
      label: `collections of media source ${mediaSource.uuid}`,
      getLock: () => this.entityMutex.getLockForCollections(mediaSource.uuid),
      job: { kind: 'collections', mediaSourceId: mediaSource.uuid },
      // Collections change tags, not program durations
      reconcileDurations: false,
    });
  }

  /**
   * Takes the scan's lock and queues the job for the runner. Whatever happens
   * to the job, the lock is released, its progress ends and its abort
   * controller is dropped; a job canceled while still queued never runs.
   */
  private async enqueue({
    id,
    label,
    getLock,
    job,
    reconcileDurations = true,
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
    let outcome: Maybe<ScanOutcome>;

    const done = this.queue
      .add(async () => {
        if (controller.signal.aborted) {
          this.logger.info('Scan of %s was canceled before it started', label);
          return;
        }
        started = true;
        outcome = await this.runner.run(job, controller.signal);
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
        // A skipped job (library gone or unavailable by the time it ran)
        // changed nothing
        if (
          started &&
          outcome !== 'skipped' &&
          reconcileDurations &&
          !this.shuttingDown
        ) {
          this.reconcileProgramDurations();
        }
      });
    this.inFlight.add(done);
    void done.finally(() => this.inFlight.delete(done));

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

  // Resolves once every queued job has run and been cleaned up
  async awaitAllFinished() {
    await this.queue.onIdle();
    await Promise.all(this.inFlight);
  }

  /**
   * Server shutdown: cancels every job and gives the running one graceMs to
   * stop before the runner ends it (a scan worker is terminated).
   */
  async shutdown(graceMs: number) {
    this.shuttingDown = true;
    // Queued jobs see the abort when they come up and return at once
    const stopping = this.runner.shutdown(graceMs);
    this.cancelAll();
    await Promise.race([
      this.awaitAllFinished(),
      new Promise<void>((resolve) => setTimeout(resolve, graceMs).unref()),
    ]);
    await stopping;
  }
}

type QueuedScan = {
  // The library or media source ID; keys progress and cancellation
  id: string;
  label: string;
  getLock: () => Promise<MutexInterface>;
  job: ScanJob;
  // Reconcile channel durations after the job runs (default true)
  reconcileDurations?: boolean;
};

type CollectionsScanRequest = {
  mediaSourceId: MediaSourceId;
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
