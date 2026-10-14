import type { MediaSourceId } from '@tunarr/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { ReconcileProgramDurationsTask } from '../../tasks/ReconcileProgramDurationsTask.ts';
import { MutexMap } from '../../util/mutexMap.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { GlobalScheduler } from '../Scheduler.ts';
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import { MediaSourceScanCoordinator } from './MediaSourceScanCoordinator.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';

const library = (uuid: string) => ({
  uuid,
  name: `Library ${uuid}`,
  mediaSourceId: 'ms1',
  mediaType: 'movies',
  unavailableSince: null,
  mediaSource: { uuid: 'ms1', type: 'plex' },
});

// A scan that stays running until finish() is called
function deferredScan() {
  let finish: () => void = () => {};
  let fail: (e: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { promise, finish, fail };
}

function makeScanner() {
  return {
    scan: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn(),
  };
}

function makeSut(options: {
  scannerFactory?: () => ReturnType<typeof makeScanner>;
  collectionScanner?: { scanLibrary: ReturnType<typeof vi.fn> };
}) {
  const mediaSourceDB = {
    getLibrary: vi.fn((id: string) => Promise.resolve(library(id))),
    getById: vi.fn(() =>
      Promise.resolve({ uuid: 'local1', type: 'local', mediaType: 'movies' }),
    ),
  } as unknown as MediaSourceDB;
  const progress = new MediaSourceProgressService();
  const scannerFactory = vi.fn(
    options.scannerFactory ?? makeScanner,
  ) as unknown as GenericMediaSourceScannerFactory;
  const localScannerFactory = vi.fn(
    makeScanner,
  ) as unknown as GenericLocalMediaSourceScannerFactory;
  const coordinator = new MediaSourceScanCoordinator(
    mediaSourceDB,
    new EntityMutex(new MutexMap()),
    scannerFactory,
    localScannerFactory,
    progress,
    () =>
      options.collectionScanner as unknown as GenericExternalCollectionScanner,
    () => ({}) as ReconcileProgramDurationsTask,
  );
  return { coordinator, progress };
}

describe('MediaSourceScanCoordinator', () => {
  let runTask: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runTask = vi.spyOn(GlobalScheduler, 'runTask').mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a scanner that can't be created leaves no lock behind", async () => {
    let attempts = 0;
    const { coordinator } = makeSut({
      scannerFactory: () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('no scanner for this library type');
        }
        return makeScanner();
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

  test('a scan that throws ends its progress and frees its lock', async () => {
    const failing = makeScanner();
    failing.scan.mockRejectedValue(new Error('server went away'));
    const scanners = [failing, makeScanner()];
    const { coordinator, progress } = makeSut({
      scannerFactory: () => scanners.shift() ?? makeScanner(),
    });

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
    const running = deferredScan();
    const first = makeScanner();
    first.scan.mockReturnValue(running.promise);
    const second = makeScanner();
    const scanners = [first, second];
    const { coordinator, progress } = makeSut({
      scannerFactory: () => scanners.shift() ?? makeScanner(),
    });

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    await coordinator.add({ libraryId: 'lib2', forceScan: false });
    expect(progress.getScanProgress('lib2').state).toBe('queued');

    coordinator.cancelAll();
    running.finish();
    await coordinator.awaitAllFinished();

    expect(first.cancel).toHaveBeenCalledWith('lib1');
    expect(second.scan).not.toHaveBeenCalled();
    expect(progress.getScanProgress('lib2').state).toBe('not_scanning');
    // Only the job that ran reconciles durations
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  test('a canceled scan is not followed by a collection scan', async () => {
    const running = deferredScan();
    const scanner = makeScanner();
    scanner.scan.mockReturnValue(running.promise);
    const collectionScanner = { scanLibrary: vi.fn() };
    const { coordinator } = makeSut({
      scannerFactory: () => scanner,
      collectionScanner,
    });

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    // Let the queued job start before canceling it
    await vi.waitFor(() => expect(scanner.scan).toHaveBeenCalled());
    coordinator.cancelAll();
    running.finish();
    await coordinator.awaitAllFinished();

    expect(collectionScanner.scanLibrary).not.toHaveBeenCalled();
  });

  test('a finished scan is followed by its collection scan', async () => {
    const collectionScanner = { scanLibrary: vi.fn() };
    const { coordinator } = makeSut({ collectionScanner });

    await coordinator.add({ libraryId: 'lib1', forceScan: true });
    await coordinator.awaitAllFinished();

    expect(collectionScanner.scanLibrary).toHaveBeenCalledWith({
      libraryId: 'lib1',
      force: true,
    });
  });

  test('awaitAllFinished waits for the running scan', async () => {
    const running = deferredScan();
    const scanner = makeScanner();
    scanner.scan.mockReturnValue(running.promise);
    const { coordinator } = makeSut({ scannerFactory: () => scanner });

    await coordinator.add({ libraryId: 'lib1', forceScan: false });
    await vi.waitFor(() => expect(scanner.scan).toHaveBeenCalled());

    let finished = false;
    const waiting = coordinator.awaitAllFinished().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);

    running.finish();
    await waiting;
    expect(finished).toBe(true);
  });

  test('a local media source without a media type is not scanned', async () => {
    const { coordinator } = makeSut({});
    const mediaSourceDB = (
      coordinator as unknown as { mediaSourceDB: MediaSourceDB }
    ).mediaSourceDB;
    vi.mocked(mediaSourceDB.getById).mockResolvedValue({
      uuid: 'local1',
      type: 'local',
      mediaType: null,
    } as unknown as Awaited<ReturnType<MediaSourceDB['getById']>>);

    expect(
      await coordinator.addLocal({
        mediaSourceId: 'local1' as MediaSourceId,
        forceScan: false,
      }),
    ).toBe(false);
  });
});
