import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import {
  ScanWorkerMessage,
  type ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import type { MediaSourceProgressService } from './MediaSourceProgressService.ts';
import type { ScanJobRunner } from './ScanJobRunner.ts';

// The parts of node:worker_threads' Worker this runner uses
export type ScanWorkerHandle = Pick<EventEmitter, 'on' | 'once' | 'off'> & {
  postMessage(message: ScanWorkerRequest): void;
  terminate(): Promise<number>;
};

export type ScanWorkerTimings = {
  // How long a new worker may take to say it started
  bootTimeoutMs: number;
  // After a cancel, how long the job may take to stop before the worker is
  // terminated
  cancelGraceMs: number;
  // After a job ends, how long the worker may take to exit on its own
  exitGraceMs: number;
};

const DefaultTimings: ScanWorkerTimings = {
  bootTimeoutMs: 60_000,
  cancelGraceMs: 30_000,
  exitGraceMs: 5_000,
};

// After this many workers in a row fail to start, scans stay on the main thread
// until Tunarr restarts
const MaxBootFailures = 3;

type RunningJob = {
  jobId: string;
  worker: ScanWorkerHandle;
  done: Promise<unknown>;
};

/**
 * Runs each scan job in a fresh worker thread, so the scan's synchronous
 * database work never blocks the main thread that serves streams. A new worker
 * per job reads current settings and media source credentials, and holds no
 * memory between scans. Progress comes back over the worker's messages and is
 * applied to the main thread's MediaSourceProgressService, which the UI reads.
 *
 * If a worker can't start, the job runs on the main thread instead. A job
 * whose worker dies isn't run again; the next scan starts a fresh worker.
 */
export class WorkerScanJobRunner implements ScanJobRunner {
  private readonly logger: Logger = LoggerFactory.child({
    className: WorkerScanJobRunner.name,
  });
  private readonly timings: ScanWorkerTimings;
  #bootFailures = 0;
  #current?: RunningJob;
  // A worker that hasn't reported it started yet
  #booting?: ScanWorkerHandle;
  #shuttingDown = false;
  #exited = new WeakSet<ScanWorkerHandle>();

  constructor(
    private createWorker: () => ScanWorkerHandle,
    private fallback: ScanJobRunner,
    private progress: MediaSourceProgressService,
    timings: Partial<ScanWorkerTimings> = {},
  ) {
    this.timings = { ...DefaultTimings, ...timings };
  }

  async run(job: ScanJob, signal: AbortSignal): Promise<ScanOutcome> {
    if (signal.aborted) {
      return 'canceled';
    }
    if (this.#bootFailures >= MaxBootFailures) {
      return this.fallback.run(job, signal);
    }

    let worker: ScanWorkerHandle;
    try {
      worker = await this.boot();
      this.#bootFailures = 0;
    } catch (e) {
      // Shutdown ended the start-up; that's not a failed start
      if (signal.aborted || this.#shuttingDown) {
        return 'canceled';
      }
      this.#bootFailures++;
      if (this.#bootFailures >= MaxBootFailures) {
        this.logger.error(
          e,
          'Scan workers failed to start %d times in a row; scanning on the main thread until restart',
          this.#bootFailures,
        );
      } else {
        this.logger.warn(
          e,
          'Scan worker failed to start; running this scan on the main thread',
        );
      }
      return this.fallback.run(job, signal);
    }

    // Canceled (or shutting down) while the worker was starting
    if (signal.aborted || this.#shuttingDown) {
      void this.stop(worker);
      return 'canceled';
    }

    return this.runOnWorker(worker, job, signal);
  }

  async shutdown(graceMs: number): Promise<void> {
    this.#shuttingDown = true;
    // A worker still starting has no job to wind down
    const booting = this.#booting;
    if (booting) {
      await booting.terminate();
    }
    const current = this.#current;
    if (!current) {
      return;
    }
    // The coordinator cancels the job; give it graceMs to wind down
    await Promise.race([current.done, sleep(graceMs)]);
    if (this.#current === current) {
      this.logger.warn(
        'Scan job %s did not stop in time; terminating its worker',
        current.jobId,
      );
      await current.worker.terminate();
    }
  }

  private boot(): Promise<ScanWorkerHandle> {
    const started = performance.now();
    const worker = this.createWorker();
    worker.once('exit', () => this.#exited.add(worker));
    this.#booting = worker;

    return new Promise<ScanWorkerHandle>((resolve, reject) => {
      const cleanup = () => {
        this.#booting = undefined;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const fail = (e: Error) => {
        cleanup();
        void worker.terminate();
        reject(e);
      };
      const onMessage = (raw: unknown) => {
        const parsed = ScanWorkerMessage.safeParse(raw);
        if (
          parsed.success &&
          parsed.data.type === 'event' &&
          parsed.data.eventType === 'started'
        ) {
          cleanup();
          this.logger.info(
            'Scan worker ready in %d ms',
            Math.round(performance.now() - started),
          );
          resolve(worker);
        }
      };
      const onError = (e: Error) => fail(e);
      const onExit = (code: number) =>
        fail(new Error(`Scan worker exited with code ${code} while starting`));
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              `Scan worker did not start within ${this.timings.bootTimeoutMs} ms`,
            ),
          ),
        this.timings.bootTimeoutMs,
      );
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
    });
  }

  private runOnWorker(
    worker: ScanWorkerHandle,
    job: ScanJob,
    signal: AbortSignal,
  ): Promise<ScanOutcome> {
    const jobId = randomUUID();
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;

    const done = new Promise<ScanOutcome>((resolve, reject) => {
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        finish();
        void this.stop(worker);
      };
      const onMessage = (raw: unknown) => {
        const parsed = ScanWorkerMessage.safeParse(raw);
        if (!parsed.success) {
          this.logger.warn(
            parsed.error,
            'Ignoring malformed scan worker message',
          );
          return;
        }
        const message = parsed.data;
        if (message.type === 'event' || message.jobId !== jobId) {
          return;
        }
        switch (message.type) {
          case 'scan-progress':
            this.applyProgress(message);
            break;
          case 'scan-done':
            settle(() => resolve(message.outcome));
            break;
          case 'scan-failed':
            settle(() => reject(new Error(message.message)));
            break;
        }
      };
      const onError = (e: Error) => settle(() => reject(e));
      const onExit = (code: number) =>
        settle(() =>
          // Terminated on purpose after a cancel or at shutdown
          signal.aborted || this.#shuttingDown
            ? resolve('canceled')
            : reject(
                new Error(
                  `Scan worker exited with code ${code} during job ${jobId}`,
                ),
              ),
        );
      const onAbort = () => {
        worker.postMessage({ type: 'cancel', jobId });
        cancelTimer = setTimeout(() => {
          this.logger.warn(
            'Scan job %s did not stop within %d ms of being canceled; terminating its worker',
            jobId,
            this.timings.cancelGraceMs,
          );
          void worker.terminate();
        }, this.timings.cancelGraceMs);
      };
      const cleanup = () => {
        clearTimeout(cancelTimer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        signal.removeEventListener('abort', onAbort);
      };

      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      signal.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ type: 'scan', jobId, job });
    });

    const current: RunningJob = { jobId, worker, done };
    this.#current = current;
    void done
      .catch(() => {})
      .finally(() => {
        if (this.#current === current) {
          this.#current = undefined;
        }
      });
    return done;
  }

  private applyProgress(
    message: Extract<ScanWorkerMessage, { type: 'scan-progress' }>,
  ) {
    switch (message.event) {
      case 'started':
        this.progress.scanStarted(message.entityId);
        break;
      case 'progress':
        this.progress.scanProgress(
          message.entityId,
          message.percentComplete ?? 0,
        );
        break;
      case 'ended':
        this.progress.scanEnded(message.entityId);
        break;
    }
  }

  // Ask the worker to exit; terminate it if it hasn't within exitGraceMs
  private async stop(worker: ScanWorkerHandle) {
    if (this.#exited.has(worker)) {
      return;
    }
    const exited = new Promise<'exited'>((resolve) =>
      worker.once('exit', () => resolve('exited')),
    );
    worker.postMessage({ type: 'shutdown' });
    const result = await Promise.race([
      exited,
      sleep(this.timings.exitGraceMs).then(() => 'timeout' as const),
    ]);
    if (result === 'timeout' && !this.#exited.has(worker)) {
      await worker.terminate();
    }
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
