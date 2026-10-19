import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import os from 'node:os';

export const ReadAheadMaxThreads = 16;

/**
 * Boost read-ahead threads up to the configured cap and available cores,
 * without lowering the transcode config's thread count. A zero cap disables
 * the boost; a zero config count keeps FFmpeg's automatic thread selection.
 * Hardware pipelines also use this count for software decoding and fallback.
 */
export function readAheadThreadCount(
  config: Pick<TranscodeConfigOrm, 'threadCount'>,
  availableCores: number = os.availableParallelism(),
  maxThreads: number = ReadAheadMaxThreads,
): number {
  if (config.threadCount <= 0 || maxThreads === 0) {
    return config.threadCount;
  }
  return Math.max(config.threadCount, Math.min(maxThreads, availableCores));
}

/**
 * The transcode config for one transcode: as configured when it runs at real
 * time, with {@link readAheadThreadCount} threads when it reads ahead.
 */
export function transcodeConfigFor<T extends TranscodeConfigOrm>(
  config: T,
  realtime: boolean,
  availableCores?: number,
  maxThreads?: number,
): T {
  if (realtime) {
    return config;
  }
  const threadCount = readAheadThreadCount(config, availableCores, maxThreads);
  return threadCount === config.threadCount
    ? config
    : { ...config, threadCount };
}
