import { EventEmitter } from 'node:events';
import type { MessagePort } from 'node:worker_threads';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type {
  ScanJob,
  ScanOutcome,
  ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import type { CustomShowSyncService } from '../CustomShowSyncService.ts';
import { ScanWorker } from '../ScanWorker.ts';
import type { GenericExternalCollectionScanner } from './ExternalCollectionScanner.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';
import { ScanJobExecutor } from './ScanJobExecutor.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';
import type { ScanWorkerHandle } from './WorkerScanJobRunner.ts';
import { WorkerScanJobRunner } from './WorkerScanJobRunner.ts';

// The main thread's view of a worker, over one end of a MessageChannel
class PortWorker extends EventEmitter implements ScanWorkerHandle {
  constructor(private port: MessagePort) {
    super();
    port.on('message', (message) => this.emit('message', message));
  }

  postMessage(message: ScanWorkerRequest) {
    this.port.postMessage(message);
  }

  exit(code: number) {
    this.port.close();
    this.emit('exit', code);
  }

  terminate() {
    this.exit(1);
    return Promise.resolve(1);
  }
}

const job: ScanJob = { kind: 'library', libraryId: 'lib1', force: true };

describe('scan worker round trip', () => {
  test('a job runs in the worker and its progress reaches the main thread', async () => {
    // Each side has its own progress service, as each thread does
    const workerProgress = new MediaSourceProgressService();
    const mainProgress = new MediaSourceProgressService();
    const executor = {
      run: vi.fn((): Promise<ScanOutcome> => {
        workerProgress.scanStarted('lib1');
        workerProgress.scanProgress('lib1', 50);
        workerProgress.scanEnded('lib1');
        return Promise.resolve('completed');
      }),
    };

    let host: PortWorker | undefined;
    const createWorker = () => {
      const { port1, port2 } = new MessageChannel();
      const worker = new PortWorker(port2);
      new ScanWorker(
        executor as unknown as ScanJobExecutor,
        workerProgress,
      ).start(port1, { exit: (code) => worker.exit(code) });
      host = worker;
      return worker;
    };
    const fallback: ScanJobRunner = {
      run: vi.fn(() => Promise.resolve<ScanOutcome>('completed')),
      shutdown: () => Promise.resolve(),
    };
    const runner = new WorkerScanJobRunner(
      createWorker,
      fallback,
      mainProgress,
    );
    const seen: string[] = [];
    mainProgress.on('scanStart', (id) => seen.push(`start ${id}`));
    mainProgress.on('scanProgress', (id, pct) => seen.push(`${pct}% ${id}`));
    mainProgress.on('scanEnd', (id) => seen.push(`end ${id}`));
    const exited = new Promise<number>((resolve) =>
      setImmediate(() => host?.once('exit', resolve)),
    );

    const outcome = await runner.run(job, new AbortController().signal);

    expect(outcome).toBe('completed');
    expect(executor.run).toHaveBeenCalledWith(job, expect.any(AbortSignal));
    expect(seen).toEqual(['start lib1', '50% lib1', 'end lib1']);
    expect(mainProgress.getScanProgress('lib1').state).toBe('not_scanning');
    expect(fallback.run).not.toHaveBeenCalled();
    // The worker exits on its own once the job is done
    expect(await exited).toBe(0);
  });

  describe('custom show sync', () => {
    const customShowJob: ScanJob = { kind: 'custom-show', customShowId: 'cs1' };

    // A runner whose worker runs a real executor, with the sync faked
    function makeSut(syncShow: CustomShowSyncService['syncShow']) {
      const customShowSync = { syncShow: vi.fn(syncShow) };
      const executor = new ScanJobExecutor(
        {} as MediaSourceDB,
        vi.fn() as unknown as GenericMediaSourceScannerFactory,
        vi.fn() as unknown as GenericLocalMediaSourceScannerFactory,
        vi.fn() as unknown as (
          sourceType: string,
        ) => GenericExternalCollectionScanner | undefined,
        customShowSync as unknown as CustomShowSyncService,
      );
      const createWorker = () => {
        const { port1, port2 } = new MessageChannel();
        const worker = new PortWorker(port2);
        new ScanWorker(executor, new MediaSourceProgressService()).start(
          port1,
          { exit: (code) => worker.exit(code) },
        );
        return worker;
      };
      const fallback: ScanJobRunner = {
        run: vi.fn(() => Promise.resolve<ScanOutcome>('completed')),
        shutdown: () => Promise.resolve(),
      };
      const runner = new WorkerScanJobRunner(
        createWorker,
        fallback,
        new MediaSourceProgressService(),
      );
      return { runner, customShowSync, fallback };
    }

    test('the sync runs in the worker and its outcome reaches the main thread', async () => {
      const { runner, customShowSync, fallback } = makeSut(() =>
        Promise.resolve('completed'),
      );

      expect(
        await runner.run(customShowJob, new AbortController().signal),
      ).toBe('completed');
      expect(customShowSync.syncShow).toHaveBeenCalledWith(
        'cs1',
        expect.any(AbortSignal),
      );
      expect(fallback.run).not.toHaveBeenCalled();
    });

    test('a failed sync reaches the main thread as a failure', async () => {
      const { runner } = makeSut(() =>
        Promise.reject(new Error('Plex is unreachable')),
      );

      await expect(
        runner.run(customShowJob, new AbortController().signal),
      ).rejects.toThrow('Plex is unreachable');
    });

    test('a cancel reaches the sync in the worker', async () => {
      const { runner, customShowSync } = makeSut(
        (_id, signal) =>
          new Promise<ScanOutcome>((resolve) => {
            signal?.addEventListener('abort', () => resolve('canceled'));
          }),
      );
      const controller = new AbortController();

      const outcome = runner.run(customShowJob, controller.signal);
      // Running in the worker, not canceled while it started
      await vi.waitFor(() =>
        expect(customShowSync.syncShow).toHaveBeenCalled(),
      );
      controller.abort();

      expect(await outcome).toBe('canceled');
    });
  });
});
