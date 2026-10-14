import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import type {
  ScanJob,
  ScanOutcome,
  ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';
import type { ScanWorkerHandle } from './WorkerScanJobRunner.ts';
import { WorkerScanJobRunner } from './WorkerScanJobRunner.ts';

const job: ScanJob = { kind: 'library', libraryId: 'lib1', force: false };

type Behavior = {
  // Announce 'started' after spawning (default true)
  starts?: boolean;
  // Answer a 'scan' request; default: complete it
  onScan?: (worker: FakeWorker, jobId: string) => void;
  // Answer a 'cancel' request; default: ignore it
  onCancel?: (worker: FakeWorker, jobId: string) => void;
  // Exit when asked to shut down (default true)
  exitsOnShutdown?: boolean;
};

class FakeWorker extends EventEmitter implements ScanWorkerHandle {
  readonly posted: ScanWorkerRequest[] = [];
  terminated = false;

  constructor(private behavior: Behavior) {
    super();
    if (behavior.starts ?? true) {
      setImmediate(() => this.reply({ type: 'event', eventType: 'started' }));
    }
  }

  reply(message: unknown) {
    this.emit('message', message);
  }

  postMessage(message: ScanWorkerRequest) {
    this.posted.push(message);
    setImmediate(() => {
      switch (message.type) {
        case 'scan':
          (
            this.behavior.onScan ??
            ((w, jobId) =>
              w.reply({ type: 'scan-done', jobId, outcome: 'completed' }))
          )(this, message.jobId);
          break;
        case 'cancel':
          this.behavior.onCancel?.(this, message.jobId);
          break;
        case 'shutdown':
          if (this.behavior.exitsOnShutdown ?? true) {
            this.emit('exit', 0);
          }
          break;
      }
    });
  }

  terminate = vi.fn(() => {
    this.terminated = true;
    setImmediate(() => this.emit('exit', 1));
    return Promise.resolve(1);
  });
}

function makeSut(behavior: Behavior = {}, timings = {}) {
  const workers: FakeWorker[] = [];
  const progress = new MediaSourceProgressService();
  const fallback = {
    run: vi
      .fn<(job: ScanJob, signal: AbortSignal) => Promise<ScanOutcome>>()
      .mockResolvedValue('completed'),
    shutdown: vi.fn(() => Promise.resolve()),
  } satisfies ScanJobRunner;
  const createWorker = vi.fn(() => {
    const worker = new FakeWorker(behavior);
    workers.push(worker);
    return worker;
  });
  const runner = new WorkerScanJobRunner(createWorker, fallback, progress, {
    bootTimeoutMs: 200,
    cancelGraceMs: 200,
    exitGraceMs: 200,
    ...timings,
  });
  return { runner, workers, progress, fallback, createWorker };
}

const scanRequests = (worker: FakeWorker | undefined) =>
  (worker?.posted ?? []).filter((m) => m.type === 'scan');

describe('WorkerScanJobRunner', () => {
  test('runs the job in a worker and applies its progress here', async () => {
    const { runner, workers, progress, fallback } = makeSut({
      onScan: (w, jobId) => {
        w.reply({
          type: 'scan-progress',
          jobId,
          entityId: 'lib1',
          event: 'started',
        });
        w.reply({
          type: 'scan-progress',
          jobId,
          entityId: 'lib1',
          event: 'progress',
          percentComplete: 42,
        });
        // Messages for another job are ignored
        w.reply({
          type: 'scan-progress',
          jobId: crypto.randomUUID(),
          entityId: 'lib9',
          event: 'started',
        });
        w.reply({ type: 'scan-done', jobId, outcome: 'completed' });
      },
    });
    const seen: number[] = [];
    progress.on('scanProgress', (_id, pct) => seen.push(pct));

    const outcome = await runner.run(job, new AbortController().signal);

    expect(outcome).toBe('completed');
    expect(scanRequests(workers[0])).toEqual([
      expect.objectContaining({ type: 'scan', job }),
    ]);
    expect(seen).toEqual([42]);
    expect(progress.getScanProgress('lib1').state).toBe('in_progress');
    expect(progress.getScanProgress('lib9').state).toBe('not_scanning');
    expect(fallback.run).not.toHaveBeenCalled();
    // The worker is asked to exit, and does
    await vi.waitFor(() =>
      expect(workers[0]?.posted.at(-1)).toEqual({ type: 'shutdown' }),
    );
    expect(workers[0]?.terminated).toBe(false);
  });

  test('a fresh worker for every job', async () => {
    const { runner, createWorker } = makeSut();

    await runner.run(job, new AbortController().signal);
    await runner.run(job, new AbortController().signal);

    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  test('runs the job here when the worker does not start in time', async () => {
    const { runner, workers, fallback } = makeSut({ starts: false });

    const outcome = await runner.run(job, new AbortController().signal);

    expect(outcome).toBe('completed');
    expect(fallback.run).toHaveBeenCalledTimes(1);
    expect(workers[0]?.terminated).toBe(true);
  });

  test('stops trying workers after three failed starts in a row', async () => {
    const { runner, createWorker, fallback } = makeSut({ starts: false });

    for (let i = 0; i < 4; i++) {
      await runner.run(job, new AbortController().signal);
    }

    expect(createWorker).toHaveBeenCalledTimes(3);
    expect(fallback.run).toHaveBeenCalledTimes(4);
  });

  test('a worker that dies mid-job fails the job without rerunning it', async () => {
    const { runner, fallback } = makeSut({
      onScan: (w) => w.emit('exit', 134),
    });

    await expect(runner.run(job, new AbortController().signal)).rejects.toThrow(
      /exited with code 134/,
    );
    expect(fallback.run).not.toHaveBeenCalled();
  });

  test('a job the worker reports failed is rejected with its message', async () => {
    const { runner } = makeSut({
      onScan: (w, jobId) =>
        w.reply({ type: 'scan-failed', jobId, message: 'server went away' }),
    });

    await expect(runner.run(job, new AbortController().signal)).rejects.toThrow(
      'server went away',
    );
  });

  test('a cancel the worker honors ends the job as canceled', async () => {
    const { runner, workers } = makeSut({
      onScan: () => {},
      onCancel: (w, jobId) =>
        w.reply({ type: 'scan-done', jobId, outcome: 'canceled' }),
    });
    const controller = new AbortController();

    const running = runner.run(job, controller.signal);
    await vi.waitFor(() => expect(scanRequests(workers[0])).toHaveLength(1));
    controller.abort();

    expect(await running).toBe('canceled');
    expect(workers[0]?.terminated).toBe(false);
  });

  test('a job canceled while its worker starts never runs', async () => {
    const { runner, workers, fallback } = makeSut();
    const controller = new AbortController();

    const running = runner.run(job, controller.signal);
    controller.abort();

    expect(await running).toBe('canceled');
    expect(scanRequests(workers[0])).toEqual([]);
    expect(fallback.run).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(workers[0]?.posted.at(-1)).toEqual({ type: 'shutdown' }),
    );
  });

  test('a worker that ignores a cancel is terminated', async () => {
    const { runner, workers } = makeSut({ onScan: () => {} });
    const controller = new AbortController();

    const running = runner.run(job, controller.signal);
    await vi.waitFor(() => expect(scanRequests(workers[0])).toHaveLength(1));
    controller.abort();

    expect(await running).toBe('canceled');
    expect(workers[0]?.terminated).toBe(true);
  });

  test('shutdown terminates a job that does not stop in time', async () => {
    const { runner, workers } = makeSut({ onScan: () => {} });

    const running = runner.run(job, new AbortController().signal);
    await vi.waitFor(() => expect(scanRequests(workers[0])).toHaveLength(1));
    await runner.shutdown(50);

    expect(await running).toBe('canceled');
    expect(workers[0]?.terminated).toBe(true);
  });

  test('a worker that does not exit after its job is terminated', async () => {
    const { runner, workers } = makeSut({ exitsOnShutdown: false });

    await runner.run(job, new AbortController().signal);

    await vi.waitFor(() => expect(workers[0]?.terminated).toBe(true));
  });
});
