import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MediaSourceDB } from '../../db/mediaSourceDB.ts';
import type { ReconcileProgramDurationsTask } from '../../tasks/ReconcileProgramDurationsTask.ts';
import type {
  ScanJob,
  ScanOutcome,
  ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import { ScanWorkerProtocolVersion } from '../../types/worker_schemas.ts';
import { MutexMap } from '../../util/mutexMap.ts';
import { EntityMutex } from '../EntityMutex.ts';
import { GlobalScheduler } from '../Scheduler.ts';
import type { GenericLocalMediaSourceScannerFactory } from './FileSystemScanner.ts';
import { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import { MediaSourceScanCoordinator } from './MediaSourceScanCoordinator.ts';
import type { GenericMediaSourceScannerFactory } from './MediaSourceScanner.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';
import type { ScanWorkerHandle } from './WorkerScanJobRunner.ts';
import {
  scanJobTimeoutMs,
  WorkerScanJobRunner,
} from './WorkerScanJobRunner.ts';

const job: ScanJob = { kind: 'library', libraryId: 'lib1', force: false };

type Behavior = {
  // Announce 'started' after spawning (default true)
  starts?: boolean;
  // The protocol version 'started' carries (default this server's); 'none'
  // leaves it out, as a pool worker does
  protocolVersion?: number | 'none';
  // Answer a 'scan' request; default: complete it
  onScan?: (worker: FakeWorker, jobId: string) => void;
  // Answer a 'cancel' request; default: ignore it
  onCancel?: (worker: FakeWorker, jobId: string) => void;
  // Exit when asked to shut down (default true)
  exitsOnShutdown?: boolean;
  // Stuck in native code: neither a shutdown nor terminate() ends the thread
  stuck?: boolean;
};

class FakeWorker extends EventEmitter implements ScanWorkerHandle {
  readonly posted: ScanWorkerRequest[] = [];
  terminated = false;

  constructor(private behavior: Behavior) {
    super();
    if (behavior.starts ?? true) {
      const version = behavior.protocolVersion ?? ScanWorkerProtocolVersion;
      setImmediate(() =>
        this.reply({
          type: 'event',
          eventType: 'started',
          ...(version === 'none' ? {} : { protocolVersion: version }),
        }),
      );
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
          if ((this.behavior.exitsOnShutdown ?? true) && !this.behavior.stuck) {
            this.emit('exit', 0);
          }
          break;
      }
    });
  }

  terminate = vi.fn(() => {
    this.terminated = true;
    if (this.behavior.stuck) {
      // Node's terminate() settles only when the thread exits
      return new Promise<number>(() => {});
    }
    setImmediate(() => this.emit('exit', 1));
    return Promise.resolve(1);
  });
}

const fakeLogger = () => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

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
  const logger = fakeLogger();
  Object.defineProperty(runner, 'logger', { value: logger });
  return { runner, workers, progress, fallback, createWorker, logger };
}

const scanRequests = (worker: FakeWorker | undefined) =>
  (worker?.posted ?? []).filter((m) => m.type === 'scan');

describe('WorkerScanJobRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  test('a canceled job whose worker cannot be stopped still ends', async () => {
    const { runner, workers } = makeSut(
      { stuck: true, onScan: () => {} },
      { cancelGraceMs: 50, exitGraceMs: 50 },
    );
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

  test('shutdown terminates a worker that is still starting', async () => {
    // Without the shutdown, this worker would be waited on for 10 s
    const { runner, workers, fallback } = makeSut(
      { starts: false },
      { bootTimeoutMs: 10_000 },
    );

    const running = runner.run(job, new AbortController().signal);
    await runner.shutdown(50);

    expect(workers[0]?.terminated).toBe(true);
    expect(await running).toBe('canceled');
    // Not a failed start: nothing runs in-process instead
    expect(fallback.run).not.toHaveBeenCalled();
  });

  test('a worker that does not exit after its job is terminated', async () => {
    const { runner, workers } = makeSut({ exitsOnShutdown: false });

    await runner.run(job, new AbortController().signal);

    await vi.waitFor(() => expect(workers[0]?.terminated).toBe(true));
  });

  describe('a message that does not match the protocol', () => {
    test.each([
      ['scan-done with an unknown outcome', { outcome: 'finished' }],
      ['scan-failed without its message', {}],
    ])('a final %s fails the job', async (_label, fields) => {
      const type = 'outcome' in fields ? 'scan-done' : 'scan-failed';
      const { runner, workers, fallback } = makeSut({
        onScan: (w, jobId) => w.reply({ type, jobId, ...fields }),
      });

      await expect(
        runner.run(job, new AbortController().signal),
      ).rejects.toThrow(/doesn't match the scan worker protocol/);
      expect(fallback.run).not.toHaveBeenCalled();
      // The worker was asked to exit, and did, before the job failed
      expect(workers[0]?.posted.at(-1)).toEqual({ type: 'shutdown' });
    });

    test('the job fails only once its worker has exited', async () => {
      const { runner, workers } = makeSut({
        exitsOnShutdown: false,
        onScan: (w, jobId) =>
          w.reply({ type: 'scan-done', jobId, outcome: 'finished' }),
      });

      let settled = false;
      const running = runner.run(job, new AbortController().signal);
      void running.catch(() => {}).finally(() => (settled = true));
      // Asked to stop, but still running: the next job can't start yet
      await vi.waitFor(() =>
        expect(workers[0]?.posted.at(-1)).toEqual({ type: 'shutdown' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);

      // Terminated after exitGraceMs, and then the job fails
      await expect(running).rejects.toThrow(/doesn't match/);
      expect(workers[0]?.terminated).toBe(true);
    });

    test('a worker that cannot be stopped fails the job anyway', async () => {
      const { runner, workers, logger } = makeSut(
        {
          stuck: true,
          onScan: (w, jobId) =>
            w.reply({ type: 'scan-done', jobId, outcome: 'finished' }),
        },
        { exitGraceMs: 50 },
      );

      await expect(
        runner.run(job, new AbortController().signal),
      ).rejects.toThrow(/doesn't match/);
      expect(workers[0]?.terminated).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('has not exited'),
        expect.any(String),
        100,
      );
    });

    test('a job canceled meanwhile ends as canceled', async () => {
      const controller = new AbortController();
      const { runner } = makeSut({
        onScan: (w, jobId) => {
          controller.abort();
          w.reply({ type: 'scan-done', jobId, outcome: 'finished' });
        },
      });

      expect(await runner.run(job, controller.signal)).toBe('canceled');
    });

    test.each([
      [
        'progress',
        (jobId: string) => ({
          type: 'scan-progress',
          jobId,
          entityId: 'lib1',
          event: 'progress',
          percentComplete: 'half',
        }),
      ],
      ['an event', () => ({ type: 'event', eventType: 'heartbeat' })],
    ])(
      'malformed %s is skipped and the job still ends',
      async (_label, message) => {
        const { runner, progress, logger } = makeSut({
          onScan: (w, jobId) => {
            w.reply(message(jobId));
            w.reply({ type: 'scan-done', jobId, outcome: 'completed' });
          },
        });

        expect(await runner.run(job, new AbortController().signal)).toBe(
          'completed',
        );
        expect(progress.getScanProgress('lib1').state).toBe('not_scanning');
        expect(logger.warn).toHaveBeenCalledTimes(1);
      },
    );

    test('frees the scan queue: the next job runs', async () => {
      vi.spyOn(GlobalScheduler, 'runTask').mockReturnValue(undefined);
      let jobs = 0;
      const { runner } = makeSut({
        onScan: (w, jobId) =>
          ++jobs === 1
            ? w.reply({ type: 'scan-done', jobId, outcome: 'finished' })
            : w.reply({ type: 'scan-done', jobId, outcome: 'completed' }),
      });
      const coordinator = new MediaSourceScanCoordinator(
        {
          getLibrary: (uuid: string) =>
            Promise.resolve({
              uuid,
              name: uuid,
              mediaType: 'movies',
              unavailableSince: null,
              mediaSource: { uuid: 'ms1', type: 'plex' },
            }),
        } as unknown as MediaSourceDB,
        new EntityMutex(new MutexMap()),
        vi.fn(() => ({})) as unknown as GenericMediaSourceScannerFactory,
        vi.fn(() => ({})) as unknown as GenericLocalMediaSourceScannerFactory,
        new MediaSourceProgressService(),
        runner,
        () => ({}) as ReconcileProgramDurationsTask,
      );
      Object.defineProperty(coordinator, 'logger', { value: fakeLogger() });

      expect(
        await coordinator.add({ libraryId: 'lib1', forceScan: false }),
      ).toBe(true);
      await coordinator.awaitAllFinished();
      // The library's lock was released, so it can be queued again
      expect(
        await coordinator.add({ libraryId: 'lib1', forceScan: false }),
      ).toBe(true);
      await coordinator.awaitAllFinished();

      expect(jobs).toBe(2);
    });
  });

  describe('protocol version', () => {
    test.each([
      ['another version', 999],
      ['no version, as a pool worker', 'none' as const],
    ])(
      'a worker that starts with %s runs the job on the main thread',
      async (_label, protocolVersion) => {
        const { runner, workers, fallback } = makeSut({ protocolVersion });

        expect(await runner.run(job, new AbortController().signal)).toBe(
          'completed',
        );
        expect(fallback.run).toHaveBeenCalledTimes(1);
        expect(scanRequests(workers[0])).toEqual([]);
        expect(workers[0]?.terminated).toBe(true);
      },
    );

    test('one mismatch sends scans to the main thread until restart', async () => {
      const { runner, createWorker, fallback, logger } = makeSut({
        protocolVersion: 999,
      });

      for (let i = 0; i < 4; i++) {
        await runner.run(job, new AbortController().signal);
      }

      // Every later worker would run the same code, so none is started
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(fallback.run).toHaveBeenCalledTimes(4);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('worker errors', () => {
    test('an error after the job ended is logged', async () => {
      const { runner, workers, logger } = makeSut({ exitsOnShutdown: false });

      await runner.run(job, new AbortController().signal);
      const error = new Error('late crash');
      workers[0]?.emit('error', error);

      expect(logger.error).toHaveBeenCalledWith(
        error,
        expect.stringContaining('outside a scan job'),
      );
    });

    test('an error during the job fails the job, and is not logged twice', async () => {
      const error = new Error('crash mid-job');
      const { runner, logger } = makeSut({
        onScan: (w) => w.emit('error', error),
      });

      await expect(runner.run(job, new AbortController().signal)).rejects.toBe(
        error,
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('job time limit', () => {
    test('a job that runs past it is terminated and fails', async () => {
      const { runner, workers, fallback } = makeSut(
        { onScan: () => {} },
        { jobTimeoutMs: 50 },
      );

      await expect(
        runner.run(job, new AbortController().signal),
      ).rejects.toThrow(/ran longer than 50 ms/);
      expect(workers[0]?.terminated).toBe(true);
      expect(fallback.run).not.toHaveBeenCalled();
    });

    test('a worker stuck in native code fails the job after exitGraceMs', async () => {
      const { runner, workers, logger } = makeSut(
        { stuck: true, onScan: () => {} },
        { jobTimeoutMs: 50, exitGraceMs: 50 },
      );

      await expect(
        runner.run(job, new AbortController().signal),
      ).rejects.toThrow(/ran longer than 50 ms/);
      expect(workers[0]?.terminated).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('has not exited'),
        expect.any(String),
        50,
      );
    });

    test('a job that ends in time is not affected', async () => {
      const { runner, workers, logger } = makeSut({}, { jobTimeoutMs: 100 });

      expect(await runner.run(job, new AbortController().signal)).toBe(
        'completed',
      );
      // Past the limit: the job's timer was cleared when it ended
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(workers[0]?.posted.at(-1)).toEqual({ type: 'shutdown' });
      expect(workers[0]?.terminated).toBe(false);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test('without one, a long job is left to run', async () => {
      const { runner, workers } = makeSut({
        onScan: (w, jobId) =>
          setTimeout(
            () => w.reply({ type: 'scan-done', jobId, outcome: 'completed' }),
            300,
          ),
      });

      expect(await runner.run(job, new AbortController().signal)).toBe(
        'completed',
      );
      expect(workers[0]?.terminated).toBe(false);
    });
  });
});

describe('scanJobTimeoutMs', () => {
  const name = 'TUNARR_SCAN_JOB_TIMEOUT_MINUTES';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('is minutes in ms, and says so', () => {
    vi.stubEnv(name, '30');
    const logger = fakeLogger();

    expect(scanJobTimeoutMs(logger)).toBe(30 * 60_000);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test.each([
    ['unset', undefined],
    ['0', '0'],
  ])('is no limit, quietly, when %s', (_label, value) => {
    vi.stubEnv(name, value);
    const logger = fakeLogger();

    expect(scanJobTimeoutMs(logger)).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test.each([
    ['negative', '-5'],
    ['not a number', 'soon'],
    ['in seconds', '90s'],
    ['a fraction', '0.5'],
  ])('is no limit, with a warning, when %s', (_label, value) => {
    vi.stubEnv(name, value);
    const logger = fakeLogger();

    expect(scanJobTimeoutMs(logger)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('is capped at the longest delay a timer allows', () => {
    vi.stubEnv(name, '100000');
    const logger = fakeLogger();

    const ms = scanJobTimeoutMs(logger);

    expect(ms).toBe(35_791 * 60_000);
    expect(ms).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
