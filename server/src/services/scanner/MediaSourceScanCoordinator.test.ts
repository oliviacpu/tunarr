import type { MediaSourceId } from '@tunarr/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { ReconcileProgramDurationsTask } from '../../tasks/ReconcileProgramDurationsTask.ts';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import { MutexMap } from '../../util/mutexMap.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { GlobalScheduler } from '../Scheduler.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import { MediaSourceScanCoordinator } from './MediaSourceScanCoordinator.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';

const library = (uuid: string) => ({
  uuid,
  name: `Library ${uuid}`,
  mediaSourceId: 'ms1',
  mediaType: 'movies',
  unavailableSince: null,
  mediaSource: { uuid: 'ms1', type: 'plex' },
});

// A job that stays running until finish() is called
function deferredRun() {
  let finish: (outcome: ScanOutcome) => void = () => {};
  const promise = new Promise<ScanOutcome>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

function makeSut(options: { scannerFactory?: () => object } = {}) {
  const mediaSourceDB = {
    getLibrary: vi.fn((id: string) => Promise.resolve(library(id))),
    getById: vi.fn(() =>
      Promise.resolve({ uuid: 'local1', type: 'local', mediaType: 'movies' }),
    ),
  };
  const progress = new MediaSourceProgressService();
  const runner = {
    run: vi
      .fn<(job: ScanJob, signal: AbortSignal) => Promise<ScanOutcome>>()
      .mockResolvedValue('completed'),
    shutdown: vi.fn(() => Promise.resolve()),
  } satisfies ScanJobRunner;
  const coordinator = new MediaSourceScanCoordinator(
    mediaSourceDB as unknown as MediaSourceDB,
    new EntityMutex(new MutexMap()),
    vi.fn(
      options.scannerFactory ?? (() => ({})),
    ) as unknown as GenericMediaSourceScannerFactory,
    vi.fn(() => ({})) as unknown as GenericLocalMediaSourceScannerFactory,
    progress,
    runner,
    () => ({}) as ReconcileProgramDurationsTask,
  );
  return { coordinator, progress, runner, mediaSourceDB };
}

describe('MediaSourceScanCoordinator', () => {
  let runTask: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runTask = vi.spyOn(GlobalScheduler, 'runTask').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('queues a library scan as a job for the runner', async () => {
    const { coordinator, runner } = makeSut();

    await coordinator.add({
      libraryId: 'lib1',
      forceScan: true,
      pathFilter: 'item-7',
    });
    await coordinator.awaitAllFinished();

    expect(runner.run).toHaveBeenCalledWith(
      { kind: 'library', libraryId: 'lib1', force: true, pathFilter: 'item-7' },
      expect.any(AbortSignal),
    );
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  test('a library type without a scanner is refused and leaves no lock behind', async () => {
    let attempts = 0;
    const { coordinator } = makeSut({
      scannerFactory: () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('no scanner for this library type');
        }
        return {};
      },
    });

    expect(await coordinator.add({ libraryId: 'lib1', forceScan: false })).toBe(
      false,
    );
    // The same library can be scanned right away
    expect(await coordinator.add({ libraryId: 'lib1', forceScan: false })).toBe(
      true,
    );
    await coordinator.awaitAllFinished();
  });

  test('a job that throws ends its progress and frees its lock', async () => {
    const { coordinator, progress, runner } = makeSut();
    runner.run.mockRejectedValueOnce(new Error('server went away'));

    expect(await coordinator.add({ libraryId: 'lib1', forceScan: false })).toBe(
      true,
    );
    await coordinator.awaitAllFinished();

    expect(progress.getScanProgress('lib1').state).toBe('not_scanning');
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(await coordinator.add({ libraryId: 'lib1', forceScan: false })).toBe(
      true,
    );
    await coordinator.awaitAllFinished();
  });

  test('a job canceled while queued never runs', async () => {
    const running = deferredRun();
    const { coordinator, progress, runner } = makeSut();
    runner.run.mockReturnValueOnce(running.promise);

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    await coordinator.add({ libraryId: 'lib2', forceScan: false });
    expect(progress.getScanProgress('lib2').state).toBe('queued');

    coordinator.cancelAll();
    // The running job sees the abort through its signal
    const signal = runner.run.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(true);
    running.finish('canceled');
    await coordinator.awaitAllFinished();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(progress.getScanProgress('lib2').state).toBe('not_scanning');
    // Only the job that ran reconciles durations
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  test('a skipped job does not reconcile durations', async () => {
    const { coordinator, runner } = makeSut();
    runner.run.mockResolvedValueOnce('skipped');

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    await coordinator.awaitAllFinished();

    expect(runTask).not.toHaveBeenCalled();
  });

  test('awaitAllFinished waits for the running job', async () => {
    const running = deferredRun();
    const { coordinator, runner } = makeSut();
    runner.run.mockReturnValueOnce(running.promise);

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());

    let finished = false;
    const waiting = coordinator.awaitAllFinished().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);

    running.finish('completed');
    await waiting;
    expect(finished).toBe(true);
  });

  test('queues a local source scan as a job for the runner', async () => {
    const { coordinator, runner } = makeSut();

    await coordinator.addLocal({
      mediaSourceId: 'local1' as MediaSourceId,
      forceScan: false,
    });
    await coordinator.awaitAllFinished();

    expect(runner.run).toHaveBeenCalledWith(
      { kind: 'local', mediaSourceId: 'local1', force: false },
      expect.any(AbortSignal),
    );
  });

  test('a local media source without a media type is not scanned', async () => {
    const { coordinator, mediaSourceDB, runner } = makeSut();
    mediaSourceDB.getById.mockResolvedValueOnce({
      uuid: 'local1',
      type: 'local',
      mediaType: null as unknown as string,
    });

    expect(
      await coordinator.addLocal({
        mediaSourceId: 'local1' as MediaSourceId,
        forceScan: false,
      }),
    ).toBe(false);
    expect(runner.run).not.toHaveBeenCalled();
  });

  describe('collections', () => {
    // getById's mock is typed by the local source it returns by default
    const remoteSource = { uuid: 'ms1', type: 'plex', mediaType: 'movies' };

    test("queues a sync of a source's collections, without reconciling durations", async () => {
      const { coordinator, mediaSourceDB, runner } = makeSut();
      mediaSourceDB.getById.mockResolvedValue(remoteSource);

      expect(
        await coordinator.addCollections({
          mediaSourceId: 'ms1' as MediaSourceId,
        }),
      ).toBe(true);
      await coordinator.awaitAllFinished();

      expect(runner.run).toHaveBeenCalledWith(
        { kind: 'collections', mediaSourceId: 'ms1' },
        expect.any(AbortSignal),
      );
      // Collections change tags, not durations
      expect(runTask).not.toHaveBeenCalled();
    });

    test('a sync already queued for the source is not queued twice', async () => {
      const running = deferredRun();
      const { coordinator, mediaSourceDB, runner } = makeSut();
      mediaSourceDB.getById.mockResolvedValue(remoteSource);
      runner.run.mockReturnValueOnce(running.promise);
      const request = { mediaSourceId: 'ms1' as MediaSourceId };

      expect(await coordinator.addCollections(request)).toBe(true);
      expect(await coordinator.addCollections(request)).toBe(false);
      running.finish('completed');
      await coordinator.awaitAllFinished();

      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    test('a sync already queued is routine: logged at info, not error', async () => {
      const running = deferredRun();
      const { coordinator, mediaSourceDB, runner } = makeSut();
      mediaSourceDB.getById.mockResolvedValue(remoteSource);
      runner.run.mockReturnValueOnce(running.promise);
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      Object.defineProperty(coordinator, 'logger', { value: logger });
      const request = { mediaSourceId: 'ms1' as MediaSourceId };

      await coordinator.addCollections(request);
      await coordinator.addCollections(request);
      running.finish('completed');
      await coordinator.awaitAllFinished();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('already queued'),
        'collections of media source ms1',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("doesn't lock the source's libraries", async () => {
      const running = deferredRun();
      const { coordinator, mediaSourceDB, runner } = makeSut();
      mediaSourceDB.getById.mockResolvedValue(remoteSource);
      runner.run.mockReturnValueOnce(running.promise);

      await coordinator.addCollections({
        mediaSourceId: 'ms1' as MediaSourceId,
      });
      // A library of the same source can still be queued behind it
      expect(
        await coordinator.add({ libraryId: 'lib1', forceScan: false }),
      ).toBe(true);
      running.finish('completed');
      await coordinator.awaitAllFinished();

      expect(runner.run).toHaveBeenCalledTimes(2);
    });

    test('a local media source has no collections to sync', async () => {
      const { coordinator, runner } = makeSut();

      expect(
        await coordinator.addCollections({
          mediaSourceId: 'local1' as MediaSourceId,
        }),
      ).toBe(false);
      expect(runner.run).not.toHaveBeenCalled();
    });
  });

  describe('custom show sync', () => {
    test('an idle request waits for completion and cleanup', async () => {
      const running = deferredRun();
      const { coordinator, runner, progress } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);
      let returned = false;
      const request = coordinator.syncCustomShowForRequest('cs1').then(() => {
        returned = true;
      });
      await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());
      expect(returned).toBe(false);
      running.finish('completed');
      await request;
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(false);
      expect(progress.getScanProgress('custom_show.cs1').state).toBe(
        'not_scanning',
      );
    });

    test('a request joins a sync still being accepted without waiting for completion', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);
      const first = coordinator.syncCustomShow('cs1');
      await coordinator.syncCustomShowForRequest('cs1');
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(true);
      expect(runner.run).toHaveBeenCalledTimes(1);
      running.finish('completed');
      await first;
    });

    test('returns a queued request while another job is held open', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);
      const first = coordinator.syncCustomShow('cs1');
      await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());
      await coordinator.syncCustomShowForRequest('cs2');
      expect(coordinator.isCustomShowSyncing('cs2')).toBe(true);
      expect(runner.run).toHaveBeenCalledTimes(1);
      running.finish('completed');
      await first;
      await vi.waitFor(() =>
        expect(coordinator.isCustomShowSyncing('cs2')).toBe(false),
      );
    });

    test('runs as a job for the runner and resolves with its outcome', async () => {
      const { coordinator, runner } = makeSut();

      expect(await coordinator.syncCustomShow('cs1')).toBe('completed');

      expect(runner.run).toHaveBeenCalledWith(
        { kind: 'custom-show', customShowId: 'cs1' },
        expect.any(AbortSignal),
      );
      // A sync never reconciled channel durations
      expect(runTask).not.toHaveBeenCalled();
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(false);
    });

    test('shows as syncing while queued or running', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      const synced = coordinator.syncCustomShow('cs1');
      await vi.waitFor(() => expect(runner.run).toHaveBeenCalled());
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(true);
      expect(coordinator.isCustomShowSyncing('cs2')).toBe(false);

      running.finish('completed');
      await synced;
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(false);
    });

    test('a second request for the same show joins the first', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      const first = coordinator.syncCustomShow('cs1');
      const second = coordinator.syncCustomShow('cs1', { priority: true });
      running.finish('completed');

      expect(await first).toBe('completed');
      expect(await second).toBe('completed');
      expect(runner.run).toHaveBeenCalledTimes(1);
    });

    test('a failed sync rejects for the caller and frees the show', async () => {
      const { coordinator, progress, runner } = makeSut();
      runner.run.mockRejectedValueOnce(new Error('Plex is unreachable'));

      await expect(coordinator.syncCustomShow('cs1')).rejects.toThrow(
        'Plex is unreachable',
      );
      expect(coordinator.isCustomShowSyncing('cs1')).toBe(false);
      expect(progress.getScanProgress('custom_show.cs1').state).toBe(
        'not_scanning',
      );
      // It can be synced again
      expect(await coordinator.syncCustomShow('cs1')).toBe('completed');
      expect(runner.run).toHaveBeenCalledTimes(2);
    });

    test('a prioritized sync runs ahead of queued scans, after the running one', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      await coordinator.add({ libraryId: 'lib1', forceScan: false });
      await coordinator.add({ libraryId: 'lib2', forceScan: false });
      const synced = coordinator.syncCustomShow('cs1', { priority: true });
      await vi.waitFor(() =>
        expect(coordinator.isCustomShowSyncing('cs1')).toBe(true),
      );
      running.finish('completed');
      await synced;
      await coordinator.awaitAllFinished();

      expect(runner.run.mock.calls.map(([job]) => job)).toEqual([
        { kind: 'library', libraryId: 'lib1', force: false },
        { kind: 'custom-show', customShowId: 'cs1' },
        { kind: 'library', libraryId: 'lib2', force: false },
      ]);
    });

    test('Sync Now moves a sync the hourly task queued ahead of queued scans', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      await coordinator.add({ libraryId: 'lib1', forceScan: false });
      await coordinator.add({ libraryId: 'lib2', forceScan: false });
      // The hourly task's sync, behind lib2
      const hourly = coordinator.syncCustomShow('cs1');
      await vi.waitFor(() =>
        expect(coordinator.isCustomShowSyncing('cs1')).toBe(true),
      );
      await new Promise((resolve) => setImmediate(resolve));
      const syncNow = coordinator.syncCustomShow('cs1', { priority: true });
      running.finish('completed');
      expect(await syncNow).toBe('completed');
      expect(await hourly).toBe('completed');
      await coordinator.awaitAllFinished();

      expect(runner.run.mock.calls.map(([job]) => job.kind)).toEqual([
        'library',
        'custom-show',
        'library',
      ]);
    });

    test('Sync Now raises a sync that joined while it was being queued', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      await coordinator.add({ libraryId: 'lib1', forceScan: false });
      await coordinator.add({ libraryId: 'lib2', forceScan: false });
      // Both in the same tick: the first hasn't reached the queue yet
      const hourly = coordinator.syncCustomShow('cs1');
      const syncNow = coordinator.syncCustomShow('cs1', { priority: true });
      await vi.waitFor(() =>
        expect(coordinator.isCustomShowSyncing('cs1')).toBe(true),
      );
      await new Promise((resolve) => setImmediate(resolve));
      running.finish('completed');
      await Promise.all([hourly, syncNow]);
      await coordinator.awaitAllFinished();

      expect(runner.run.mock.calls.map(([job]) => job.kind)).toEqual([
        'library',
        'custom-show',
        'library',
      ]);
    });

    test('a sync canceled while queued resolves as canceled without running', async () => {
      const running = deferredRun();
      const { coordinator, runner } = makeSut();
      runner.run.mockReturnValueOnce(running.promise);

      await coordinator.add({ libraryId: 'lib1', forceScan: false });
      const synced = coordinator.syncCustomShow('cs1');
      await vi.waitFor(() =>
        expect(coordinator.isCustomShowSyncing('cs1')).toBe(true),
      );
      coordinator.cancelAll();
      running.finish('canceled');

      expect(await synced).toBe('canceled');
      expect(runner.run).toHaveBeenCalledTimes(1);
    });
  });
});
