import { inject, injectable } from 'inversify';
import type { MessagePort } from 'node:worker_threads';
import type {
  ScanJob,
  ScanWorkerMessage,
  WorkerEvent,
} from '../types/worker_schemas.ts';
import {
  ScanWorkerProtocolVersion,
  ScanWorkerRequest,
} from '../types/worker_schemas.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import { LoggerFactory } from '../util/logging/LoggerFactory.ts';
import { MediaSourceProgressService } from './scanner/MediaSourceProgressService.ts';
import { ScanJobExecutor } from './scanner/ScanJobExecutor.ts';

type ScanWorkerOptions = {
  // Ends the thread after `shutdown`; replaceable in tests
  exit?: (code: number) => void;
  // The scan protocol version the main thread sent in workerData
  mainProtocolVersion?: number;
};

/**
 * The scan worker's side of the protocol in worker_schemas.ts: runs one scan
 * job at a time on this thread's own database connection, and relays the
 * job's progress (this thread's MediaSourceProgressService events) to the main
 * thread, which shows it in the UI.
 */
@injectable()
export class ScanWorker {
  @InjectLogger() declare private readonly logger: Logger;

  #current?: { jobId: string; controller: AbortController };
  // Last whole percent sent per library or media source
  #sentPercent = new Map<string, number>();

  constructor(
    @inject(ScanJobExecutor) private executor: ScanJobExecutor,
    @inject(MediaSourceProgressService)
    private progress: MediaSourceProgressService,
  ) {}

  start(
    port: MessagePort,
    {
      exit = (code) => process.exit(code),
      mainProtocolVersion,
    }: ScanWorkerOptions = {},
  ) {
    const post = (message: ScanWorkerMessage) => port.postMessage(message);

    this.progress.on('scanStart', (entityId) => {
      this.#sentPercent.delete(entityId);
      this.relay(post, entityId, 'started');
    });
    this.progress.on('scanProgress', (entityId, percent) => {
      if (!Number.isFinite(percent)) {
        return;
      }
      const whole = Math.round(Math.min(100, Math.max(0, percent)));
      if (this.#sentPercent.get(entityId) === whole) {
        return;
      }
      this.#sentPercent.set(entityId, whole);
      this.relay(post, entityId, 'progress', whole);
    });
    this.progress.on('scanEnd', (entityId) => {
      this.#sentPercent.delete(entityId);
      this.relay(post, entityId, 'ended');
    });

    port.on('message', (raw: unknown) => {
      const parsed = ScanWorkerRequest.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(
          parsed.error,
          'Ignoring malformed scan worker request',
        );
        return;
      }
      const request = parsed.data;
      switch (request.type) {
        case 'scan':
          void this.run(post, request.jobId, request.job);
          break;
        case 'cancel':
          if (this.#current?.jobId === request.jobId) {
            this.#current.controller.abort();
          }
          break;
        case 'shutdown':
          void this.shutdown(exit);
          break;
      }
    });

    // The main thread checks the version this worker sends below, and runs
    // the scan itself on a mismatch; this only says why, from this side
    if (
      mainProtocolVersion !== undefined &&
      mainProtocolVersion !== ScanWorkerProtocolVersion
    ) {
      this.logger.warn(
        'The main thread speaks scan worker protocol v%d and this worker v%d; the main thread will run the scan itself',
        mainProtocolVersion,
        ScanWorkerProtocolVersion,
      );
    }

    this.logger.info('Tunarr scan worker started');
    port.postMessage({
      type: 'event',
      eventType: 'started',
      message: 'Scan worker started',
      protocolVersion: ScanWorkerProtocolVersion,
    } satisfies WorkerEvent);
  }

  private relay(
    post: (message: ScanWorkerMessage) => void,
    entityId: string,
    event: 'started' | 'progress' | 'ended',
    percentComplete?: number,
  ) {
    const jobId = this.#current?.jobId;
    if (jobId === undefined) {
      return;
    }
    post({ type: 'scan-progress', jobId, entityId, event, percentComplete });
  }

  private async run(
    post: (message: ScanWorkerMessage) => void,
    jobId: string,
    job: ScanJob,
  ) {
    if (this.#current) {
      post({
        type: 'scan-failed',
        jobId,
        message: `This worker is already running job ${this.#current.jobId}`,
      });
      return;
    }
    const controller = new AbortController();
    this.#current = { jobId, controller };
    try {
      const outcome = await this.executor.run(job, controller.signal);
      post({ type: 'scan-done', jobId, outcome });
    } catch (e) {
      this.logger.error(e, 'Scan job %s failed', jobId);
      post({
        type: 'scan-failed',
        jobId,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.#current = undefined;
    }
  }

  private async shutdown(exit: (code: number) => void) {
    // Let the log lines from the job reach the file before the thread ends
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      LoggerFactory.root.flush(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    exit(0);
  }
}
