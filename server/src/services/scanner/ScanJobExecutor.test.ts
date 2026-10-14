import { describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';
import { ScanJobExecutor } from './ScanJobExecutor.ts';

const library = (overrides: Record<string, unknown> = {}) => ({
  uuid: 'lib1',
  name: 'Movies',
  mediaType: 'movies',
  unavailableSince: null,
  mediaSource: { uuid: 'ms1', type: 'plex' },
  ...overrides,
});

function makeScanner() {
  return {
    scan: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancel: vi.fn(),
  };
}

function makeSut(
  options: {
    library?: object | undefined;
    localSource?: object | undefined;
  } = {},
) {
  const mediaSourceDB = {
    getLibrary: vi.fn(() =>
      Promise.resolve('library' in options ? options.library : library()),
    ),
    getById: vi.fn(() =>
      Promise.resolve(
        'localSource' in options
          ? options.localSource
          : { uuid: 'local1', type: 'local', mediaType: 'movies' },
      ),
    ),
  };
  const scanner = makeScanner();
  const localScanner = makeScanner();
  const collectionScanner = { scanLibrary: vi.fn(() => Promise.resolve()) };
  const scannerFactory = vi.fn(() => scanner);
  const localScannerFactory = vi.fn(() => localScanner);
  const executor = new ScanJobExecutor(
    mediaSourceDB as unknown as MediaSourceDB,
    scannerFactory as unknown as GenericMediaSourceScannerFactory,
    localScannerFactory as unknown as GenericLocalMediaSourceScannerFactory,
    () => collectionScanner as unknown as GenericExternalCollectionScanner,
  );
  return {
    executor,
    scanner,
    localScanner,
    collectionScanner,
    scannerFactory,
    mediaSourceDB,
  };
}

const libraryJob = {
  kind: 'library',
  libraryId: 'lib1',
  force: false,
} as const;

describe('ScanJobExecutor', () => {
  test('scans the library, then its collections', async () => {
    const { executor, scanner, collectionScanner } = makeSut();

    const outcome = await executor.run(
      { ...libraryJob, force: true, pathFilter: 'item-7' },
      new AbortController().signal,
    );

    expect(outcome).toBe('completed');
    expect(scanner.scan).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, pathFilter: 'item-7' }),
    );
    expect(collectionScanner.scanLibrary).toHaveBeenCalledWith({
      libraryId: 'lib1',
      force: true,
    });
  });

  test('an abort cancels the scanner and skips the collection scan', async () => {
    const { executor, scanner, collectionScanner } = makeSut();
    const controller = new AbortController();
    scanner.scan.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });

    expect(await executor.run(libraryJob, controller.signal)).toBe('canceled');
    expect(scanner.cancel).toHaveBeenCalledWith('lib1');
    expect(collectionScanner.scanLibrary).not.toHaveBeenCalled();
  });

  test('an already canceled job does nothing', async () => {
    const { executor, mediaSourceDB } = makeSut();
    const controller = new AbortController();
    controller.abort();

    expect(await executor.run(libraryJob, controller.signal)).toBe('canceled');
    expect(mediaSourceDB.getLibrary).not.toHaveBeenCalled();
  });

  test('skips a library that became unavailable while queued', async () => {
    const { executor, scannerFactory } = makeSut({
      library: library({ unavailableSince: new Date('2026-10-14T00:00:00Z') }),
    });

    expect(await executor.run(libraryJob, new AbortController().signal)).toBe(
      'skipped',
    );
    expect(scannerFactory).not.toHaveBeenCalled();
  });

  test('skips a library that no longer exists', async () => {
    const { executor } = makeSut({ library: undefined });

    expect(await executor.run(libraryJob, new AbortController().signal)).toBe(
      'skipped',
    );
  });

  test('scans a local media source', async () => {
    const { executor, localScanner } = makeSut();

    const outcome = await executor.run(
      { kind: 'local', mediaSourceId: 'local1', force: true },
      new AbortController().signal,
    );

    expect(outcome).toBe('completed');
    expect(localScanner.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaSource: expect.objectContaining({ uuid: 'local1' }),
        force: true,
      }),
    );
  });

  test('skips a local media source without a media type', async () => {
    const { executor, localScanner } = makeSut({
      localSource: { uuid: 'local1', type: 'local', mediaType: null },
    });

    expect(
      await executor.run(
        { kind: 'local', mediaSourceId: 'local1', force: false },
        new AbortController().signal,
      ),
    ).toBe('skipped');
    expect(localScanner.scan).not.toHaveBeenCalled();
  });
});
