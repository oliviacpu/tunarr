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
  private readonly inFlight = new Set<Promise<unknown>>();
  // Custom show syncs queued or running, by show ID, so a second request joins
  // the first
  private readonly customShowSyncs = new Map<
    string,
    { settled: Promise<ScanOutcome>; priority: number }
  >();
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

    return this.queued({
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

    return this.queued({
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

    return this.queued({
      id: `collections.${mediaSource.uuid}`,
      label: `collections of media source ${mediaSource.uuid}`,
      getLock: () => this.entityMutex.getLockForCollections(mediaSource.uuid),
      job: { kind: 'collections', mediaSourceId: mediaSource.uuid },
      // Collections change tags, not program durations
      reconcileDurations: false,
    });
  }

  /**
   * Syncs a custom show from its external playlist, in the scan queue: in a
   * scan worker when there is one, one job at a time. Resolves with the
   * outcome once the sync has run, and rejects if it failed. A sync of the
   * same show that is already queued or running is joined, not queued again.
   *
   * `priority` puts it ahead of the jobs waiting in the queue (not the one
   * running), for a sync someone is waiting on.
   */
  syncCustomShow(
    customShowId: string,
    { priority = false }: { priority?: boolean } = {},
  ): Promise<ScanOutcome> {
    const wanted = priority ? 1 : 0;
    const jobId = `custom_show.${customShowId}`;
    const existing = this.customShowSyncs.get(customShowId);
    if (existing) {
      // Someone now waits on a sync the hourly task queued
      if (wanted > existing.priority) {
        existing.priority = wanted;
        this.raisePriority(jobId, wanted);
      }
      return existing.settled;
    }

    const settled = this.enqueue({
      id: jobId,
      label: `custom show ${customShowId}`,
      getLock: () => this.entityMutex.getLockForCustomShow(customShowId),
      job: { kind: 'custom-show', customShowId },
      // A sync never reconciled channel durations, and still doesn't
      reconcileDurations: false,
      priority: wanted,
    }).then((queued) => {
      if (queued === undefined) {
        throw new Error(
          `Could not queue a sync of custom show ${customShowId}`,
        );
      }
      // Raised by a request that joined while this one was being queued
      const raised = this.customShowSyncs.get(customShowId)?.priority ?? wanted;
      if (raised > wanted) {
        this.raisePriority(jobId, raised);
      }
      return queued.settled;
    });
    this.customShowSyncs.set(customShowId, { settled, priority: wanted });
    // Failures are logged where the job runs; callers see them too
    void settled
      .catch(() => {})
      .finally(() => {
        if (this.customShowSyncs.get(customShowId)?.settled === settled) {
          this.customShowSyncs.delete(customShowId);
        }
      });
    return settled;
  }

  // Whether a sync of the custom show is queued or running
  isCustomShowSyncing(customShowId: string) {
    return this.entityMutex.isCustomShowLocked(customShowId);
  }

  private async queued(scan: QueuedScan): Promise<boolean> {
    return (await this.enqueue(scan)) !== undefined;
  }

  // Moves a job still waiting in the queue; one that has started is left be
  private raisePriority(id: string, priority: number) {
    try {
      this.queue.setPriority(id, priority);
    } catch {
      // Not waiting in the queue any more: it's running or done
    }
  }

  /**
   * Takes the scan's lock and queues the job for the runner. Whatever happens
   * to the job, the lock is released, its progress ends and its abort
   * controller is dropped; a job canceled while still queued never runs.
   *
   * Returns undefined if the job couldn't be queued. `settled` is the job's
   * outcome (or failure) once it has run and been cleaned up; nothing has to
   * wait for it, since a failure is logged here.
   */
  private async enqueue({
    id,
    label,
    getLock,
    job,
    reconcileDurations = true,
    priority = 0,
  }: QueuedScan): Promise<Maybe<{ settled: Promise<ScanOutcome> }>> {
    let releaser: MutexInterface.Releaser;
    try {
      releaser = await tryAcquire(await getLock()).acquire();
    } catch (e) {
      if (e === E_ALREADY_LOCKED) {
        // Routine: the nightly collection sync, say, finds one still queued
        this.logger.info(
          'Not queuing %s: it is already queued or running',
          label,
        );
      } else {
        this.logger.error(e, 'Error while scheduling scan for %s', label);
      }
      return;
    }

    const controller = new AbortController();
    this.signalById.set(id, controller);
    this.progressService.scanQueued(id);
    let started = false;
    let outcome: Maybe<ScanOutcome>;

    const run = this.queue.add(
      async (): Promise<ScanOutcome> => {
        if (controller.signal.aborted) {
          this.logger.info('Scan of %s was canceled before it started', label);
          return 'canceled';
        }
        started = true;
        outcome = await this.runner.run(job, controller.signal);
        return outcome;
      },
      // The job's ID, so a waiting job can be moved up
      { priority, id },
    );
    const done = run
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

    const settled = done.then(() => run.then((result) => result ?? 'canceled'));
    void settled.catch(() => {});
    // Wrapped, so the caller isn't made to wait for it
    return { settled };
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
  // Higher runs sooner among the queued jobs (default 0)
  priority?: number;
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
