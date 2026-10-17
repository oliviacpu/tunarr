import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import os from 'node:os';

// A transcode that reads ahead of real time (the first one after a tune-in, or
// one catching up) is the one a viewer waits on: Plex Live TV answers a tune
// only once it has 5 s of video. More encoder threads get those seconds out
// sooner without changing the picture: libx264 veryfast at 8 and 16 threads
// scored the same on VMAF, SSIM and PSNR. Past 16, more frame threads start to
// cost quality, so that is the most such a transcode uses.
export const ReadAheadMaxThreads = 16;

/**
 * The thread count for a transcode that reads ahead of real time: up to
 * {@link ReadAheadMaxThreads}, never more than the cores Tunarr may run on
 * and never fewer than the transcode config asks for. A config that lets
 * ffmpeg choose (0) already uses every core, and hardware encoding doesn't
 * speed up with more threads, so both keep their count.
 */
export function readAheadThreadCount(
  config: Pick<TranscodeConfigOrm, 'threadCount' | 'hardwareAccelerationMode'>,
  availableCores: number = os.availableParallelism(),
): number {
  if (config.threadCount <= 0 || config.hardwareAccelerationMode !== 'none') {
    return config.threadCount;
  }
  return Math.max(
    config.threadCount,
    Math.min(ReadAheadMaxThreads, availableCores),
  );
}

/**
 * The transcode config for one transcode: as configured when it runs at real
 * time, with {@link readAheadThreadCount} threads when it reads ahead.
 */
export function transcodeConfigFor<T extends TranscodeConfigOrm>(
  config: T,
  realtime: boolean,
  availableCores?: number,
): T {
  if (realtime) {
    return config;
  }
  const threadCount = readAheadThreadCount(config, availableCores);
  return threadCount === config.threadCount
    ? config
    : { ...config, threadCount };
}
