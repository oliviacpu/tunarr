import { describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { GenericExternalCollectionScanner } from '../services/scanner/ExternalCollectionScanner.ts';
import type { MediaSourceScanCoordinator } from '../services/scanner/MediaSourceScanCoordinator.ts';

// The coordinator imports the scheduler, which imports the whole app container.
// Loaded from here, that cycle reaches a class before it is defined. The task
// only needs the class as an injection token.
vi.mock('../services/scanner/MediaSourceScanCoordinator.ts', () => ({
  MediaSourceScanCoordinator: class {},
}));

import { SyncCollectionsTask } from './SyncCollectionsTask.ts';

function makeSut(sources: { uuid: string; type: string; name: string }[]) {
  const mediaSourceDB = {
    getAll: vi.fn(() => Promise.resolve(sources)),
  };
  const collectionScanner = { scan: vi.fn(() => Promise.resolve()) };
  // Emby has no collection scanner in this test
  const collectionScannerFactory = vi.fn((type: string) =>
    type === 'emby' ? undefined : collectionScanner,
  );
  const coordinator = {
    addCollections: vi.fn(() => Promise.resolve(true)),
  };
  const task = new SyncCollectionsTask(
    mediaSourceDB as unknown as MediaSourceDB,
    collectionScannerFactory as unknown as (
      sourceType: string,
    ) => GenericExternalCollectionScanner | undefined,
    coordinator as unknown as MediaSourceScanCoordinator,
  );
  return { task, coordinator, collectionScanner };
}

describe('SyncCollectionsTask', () => {
  test("queues each remote source's collections with the scan coordinator", async () => {
    const { task, coordinator, collectionScanner } = makeSut([
      { uuid: 'plex1', type: 'plex', name: 'Plex' },
      { uuid: 'local1', type: 'local', name: 'Files' },
      { uuid: 'emby1', type: 'emby', name: 'Emby' },
      { uuid: 'jf1', type: 'jellyfin', name: 'Jellyfin' },
    ]);

    expect((await task.run({})).isSuccess()).toBe(true);

    // Local sources have no collections; Emby has no scanner here
    expect(coordinator.addCollections.mock.calls).toEqual([
      [{ mediaSourceId: 'plex1' }],
      [{ mediaSourceId: 'jf1' }],
    ]);
    // The scan runs in the coordinator's queue (in a scan worker), not here
    expect(collectionScanner.scan).not.toHaveBeenCalled();
  });
});
