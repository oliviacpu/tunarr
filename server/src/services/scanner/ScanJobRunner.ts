import { inject, injectable } from 'inversify';
import type { ScanJob, ScanOutcome } from '../../types/worker_schemas.ts';
import { ScanJobExecutor } from './ScanJobExecutor.ts';

/**
 * Where the scan coordinator's jobs run. The coordinator keeps the queue,
 * locks and progress; a runner only executes one job at a time.
 */
export interface ScanJobRunner {
  run(job: ScanJob, signal: AbortSignal): Promise<ScanOutcome>;
  // Stop running jobs within graceMs (server shutdown)
  shutdown(graceMs: number): Promise<void>;
}

// Runs scans on the calling thread, as Tunarr always has
@injectable()
export class InProcessScanJobRunner implements ScanJobRunner {
  constructor(@inject(ScanJobExecutor) private executor: ScanJobExecutor) {}

  run(job: ScanJob, signal: AbortSignal): Promise<ScanOutcome> {
    return this.executor.run(job, signal);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
