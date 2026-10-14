import { EventEmitter } from 'node:events';
import type { MessagePort } from 'node:worker_threads';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, test, vi } from 'vitest';
import type {
  ScanJob,
  ScanOutcome,
  ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import { ScanWorker } from '../ScanWorker.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanJobExecutor } from './ScanJobExecutor.ts';
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
});
