import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { z } from 'zod/v4';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import {
  ScanWorkerMessage,
  ScanWorkerProtocolVersion,
  type ScanWorkerRequest,
} from '../../types/worker_schemas.ts';
import { getEnvVar, SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR } from '../../util/env.ts';
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
  // How long a job may run in its worker before the worker is terminated and
  // the job fails; undefined for no limit (TUNARR_SCAN_JOB_TIMEOUT_MINUTES)
  jobTimeoutMs?: number;
};

const DefaultTimings: ScanWorkerTimings = {
  bootTimeoutMs: 60_000,
  cancelGraceMs: 30_000,
  exitGraceMs: 5_000,
};

// After this many workers in a row fail to start, scans stay on the main thread
// until Tunarr restarts
const MaxBootFailures = 3;

// setTimeout can't wait longer than 2^31 - 1 ms (a longer delay fires at once),
// so the job time limit is at most this many whole minutes
const MaxJobTimeoutMinutes = Math.floor((2 ** 31 - 1) / 60_000);

/**
 * The job time limit TUNARR_SCAN_JOB_TIMEOUT_MINUTES sets, in ms; undefined for
 * no limit (unset or 0). A value that isn't a whole number of minutes is
 * ignored with a warning, and one past what a timer can wait is capped.
 */
export function scanJobTimeoutMs(
  logger: Pick<Logger, 'info' | 'warn'> = LoggerFactory.child({
    className: 'WorkerScanJobRunner',
  }),
): number | undefined {
  const name = SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR;
  const raw = getEnvVar(name);
  if (raw === null) {
    return undefined;
  }
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 0) {
    logger.warn(
      'Ignoring %s=%s, which is not a whole number of minutes; scan jobs have no time limit',
      name,
      raw,
    );
    return undefined;
  }
  if (minutes === 0) {
    return undefined;
  }
  if (minutes > MaxJobTimeoutMinutes) {
    logger.warn(
      '%s=%s is longer than a timer can wait; using %d minutes',
      name,
      raw,
      MaxJobTimeoutMinutes,
    );
  }
  const limit = Math.min(minutes, MaxJobTimeoutMinutes);
  logger.info(
    'Scan jobs in a worker thread are stopped after %d minutes (%s)',
    limit,
    name,
  );
  return limit * 60_000;
}

// A worker that started but doesn't speak this server's scan protocol
class ProtocolMismatchError extends Error {}

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
 * If a worker can't start, or speaks another version of the protocol, the job
 * runs on the main thread instead. A job whose worker dies, sends a message
 * this side can't read, or runs past the job time limit fails and isn't run
 * again; the next scan starts a fresh worker.
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
  // Workers starting or running a job. Their errors fail that, and are
  // reported with it.
  #inPhase = new WeakSet<ScanWorkerHandle>();

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
      if (e instanceof ProtocolMismatchError) {
        // Every worker until restart runs the same code, so none will do
        this.#bootFailures = MaxBootFailures;
        this.logger.error(
          e,
          "Scan workers don't speak this server's protocol; scanning on the main thread until restart",
        );
        return this.fallback.run(job, signal);
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
    // For the worker's whole life. An error while it starts or runs a job fails
    // that, and is reported there. Any other (as it exits after its job, say)
    // would otherwise reach only the process's uncaught exception handler.
    worker.on('error', (e: unknown) => {
      if (!this.#inPhase.has(worker)) {
        this.logger.error(e, 'Scan worker thread failed outside a scan job');
      }
    });
    this.#booting = worker;
    this.#inPhase.add(worker);

    return new Promise<ScanWorkerHandle>((resolve, reject) => {
      const cleanup = () => {
        this.#booting = undefined;
        this.#inPhase.delete(worker);
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
          !parsed.success ||
          parsed.data.type !== 'event' ||
          parsed.data.eventType !== 'started'
        ) {
          return;
        }
        // A pool worker also says it started, but sends no version
        const version = parsed.data.protocolVersion;
        if (version !== ScanWorkerProtocolVersion) {
          fail(
            new ProtocolMismatchError(
              version === undefined
                ? 'The worker sent no scan protocol version, so it is not a scan worker'
                : `The worker speaks scan protocol v${version}, and this server v${ScanWorkerProtocolVersion}`,
            ),
          );
          return;
        }
        cleanup();
        this.logger.info(
          'Scan worker ready in %d ms',
          Math.round(performance.now() - started),
        );
        resolve(worker);
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
    let jobTimer: ReturnType<typeof setTimeout> | undefined;
    let stopDeadline: ReturnType<typeof setTimeout> | undefined;
    // Why the job fails, once its worker has been told to stop: it ran past
    // the time limit, or sent a message this side can't read
    let failure: Error | undefined;
    const jobTimeoutMs = this.timings.jobTimeoutMs;

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
        // The job is already failing; nothing the worker says changes that
        if (failure !== undefined) {
          return;
        }
        const parsed = ScanWorkerMessage.safeParse(raw);
        if (!parsed.success) {
          // A progress update or event that can't be read is only missed
          if (isSkippable(raw)) {
            this.logger.warn(
              parsed.error,
              'Ignoring a malformed message from the worker of scan job %s',
              jobId,
            );
            return;
          }
          // This worker runs only this job, so this may be its outcome. If it
          // can't be read, the job would never end, and every scan queued
          // behind it would wait until restart.
          this.logger.warn(
            'The worker of scan job %s sent a message that does not match the protocol; stopping it',
            jobId,
          );
          failOnceStopped(
            new Error(
              `The worker of scan job ${jobId} sent a message that doesn't match the scan worker protocol:\n${z.prettifyError(parsed.error)}`,
            ),
            () => void this.stop(worker),
            // stop() waits exitGraceMs before it terminates the worker
            2 * this.timings.exitGraceMs,
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
      // Stopped on purpose after a cancel or at shutdown
      const canceled = () => signal.aborted || this.#shuttingDown;
      const onExit = (code: number) =>
        settle(() => {
          if (canceled()) {
            resolve('canceled');
          } else if (failure !== undefined) {
            reject(failure);
          } else {
            reject(
              new Error(
                `Scan worker exited with code ${code} during job ${jobId}`,
              ),
            );
          }
        });
      /**
       * The job ends when its worker exits (onExit), so the next job doesn't
       * meet a write lock the worker still holds. A thread stuck in native
       * code (a long SQLite statement, a hung mount) can't be stopped until it
       * returns, so once the worker has been told to stop, the job ends after
       * deadlineMs anyway and the queue moves on without it.
       */
      const giveUpAfter = (deadlineMs: number, error: Error) => {
        clearTimeout(stopDeadline);
        stopDeadline = setTimeout(() => {
          this.logger.error(
            'The worker of scan job %s has not exited %d ms after it was told to stop; going on without it',
            jobId,
            deadlineMs,
          );
          settle(() => (canceled() ? resolve('canceled') : reject(error)));
        }, deadlineMs);
      };
      // Stops the worker, and fails the job with `error` once it has exited
      const failOnceStopped = (
        error: Error,
        stopWorker: () => void,
        deadlineMs: number,
      ) => {
        failure = error;
        stopWorker();
        giveUpAfter(deadlineMs, error);
      };
      const onAbort = () => {
        worker.postMessage({ type: 'cancel', jobId });
        cancelTimer = setTimeout(() => {
          this.logger.warn(
            'Scan job %s did not stop within %d ms of being canceled; terminating its worker',
            jobId,
            this.timings.cancelGraceMs,
          );
          void worker.terminate();
          giveUpAfter(
            this.timings.exitGraceMs,
            new Error(`The worker of scan job ${jobId} could not be stopped`),
          );
        }, this.timings.cancelGraceMs);
      };
      const onJobTimeout = (limitMs: number) => {
        if (failure !== undefined) {
          return;
        }
        this.logger.warn(
          'Scan job %s ran longer than %s; terminating its worker',
          jobId,
          formatLimit(limitMs),
        );
        failOnceStopped(
          new Error(
            `Scan job ${jobId} ran longer than ${formatLimit(limitMs)} (${SCAN_JOB_TIMEOUT_MINUTES_ENV_VAR}); its worker was terminated`,
          ),
          () => void worker.terminate(),
          this.timings.exitGraceMs,
        );
      };
      const cleanup = () => {
        clearTimeout(cancelTimer);
        clearTimeout(jobTimer);
        clearTimeout(stopDeadline);
        this.#inPhase.delete(worker);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
        signal.removeEventListener('abort', onAbort);
      };

      this.#inPhase.add(worker);
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      signal.addEventListener('abort', onAbort, { once: true });
      if (jobTimeoutMs !== undefined) {
        jobTimer = setTimeout(() => onJobTimeout(jobTimeoutMs), jobTimeoutMs);
      }
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

// Whether a message that failed validation was meant as a progress update or
// an event, neither of which ends a job
const isSkippable = (raw: unknown) =>
  typeof raw === 'object' &&
  raw !== null &&
  'type' in raw &&
  (raw.type === 'scan-progress' || raw.type === 'event');

const formatLimit = (ms: number) =>
  ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms} ms`;
