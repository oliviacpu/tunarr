import { describe, expect, test, vi } from 'vitest';
import type { CustomShowDB } from '../db/CustomShowDB.ts';
import type { MediaSourceScanCoordinator } from '../services/scanner/MediaSourceScanCoordinator.ts';
import type { ScanOutcome } from '../types/worker_schemas.ts';

// The coordinator imports the scheduler, which imports the whole app container.
// Loaded from here, that cycle reaches a class before it is defined. The task
// only needs the class as an injection token.
vi.mock('../services/scanner/MediaSourceScanCoordinator.ts', () => ({
  MediaSourceScanCoordinator: class {},
}));

import { SyncCustomShowsTask } from './SyncCustomShowsTask.ts';

function makeSut(showIds: string[]) {
  const customShowDB = {
    getSyncedShows: vi.fn(() =>
      Promise.resolve(showIds.map((uuid) => ({ uuid, name: `Show ${uuid}` }))),
    ),
  };
  const coordinator = {
    syncCustomShow: vi
      .fn<(id: string) => Promise<ScanOutcome>>()
      .mockResolvedValue('completed'),
  };
  const task = new SyncCustomShowsTask(
    customShowDB as unknown as CustomShowDB,
    coordinator as unknown as MediaSourceScanCoordinator,
  );
  return { task, coordinator };
}

describe('SyncCustomShowsTask', () => {
  test('syncs each linked custom show through the scan coordinator', async () => {
    const { task, coordinator } = makeSut(['cs1', 'cs2']);

    expect((await task.run({})).isSuccess()).toBe(true);

    // In the coordinator's queue (in a scan worker), not here, and without
    // jumping ahead of scans someone is waiting on
    expect(coordinator.syncCustomShow.mock.calls).toEqual([['cs1'], ['cs2']]);
  });

  test('ends once the syncs have run', async () => {
    const { task, coordinator } = makeSut(['cs1']);
    let finish: (outcome: ScanOutcome) => void = () => {};
    coordinator.syncCustomShow.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    let ended = false;
    const running = task.run({}).then(() => {
      ended = true;
    });
    await vi.waitFor(() =>
      expect(coordinator.syncCustomShow).toHaveBeenCalled(),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ended).toBe(false);

    finish('completed');
    await running;
    expect(ended).toBe(true);
  });

  test('a failed sync does not stop the others', async () => {
    const { task, coordinator } = makeSut(['cs1', 'cs2']);
    coordinator.syncCustomShow.mockRejectedValueOnce(
      new Error('Plex is unreachable'),
    );

    expect((await task.run({})).isSuccess()).toBe(true);
    expect(coordinator.syncCustomShow).toHaveBeenCalledTimes(2);
  });
});
