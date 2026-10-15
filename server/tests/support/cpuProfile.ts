import { writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';

/**
 * Runs `operation`, writing a .cpuprofile of it to `path` when one is given
 * (perf tests read it from TUNARR_PERF_CPU_PROFILE). The profile covers the
 * operation and `settleMs` after it, for work it starts in the background, and
 * opens in Chrome DevTools.
 */
export async function withCpuProfile<T>(
  path: string | undefined,
  operation: () => Promise<T>,
  settleMs = 0,
): Promise<T> {
  if (path === undefined) {
    return operation();
  }

  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) =>
    new Promise<unknown>((resolve, reject) =>
      session.post(method, params, (err, result) =>
        err ? reject(err) : resolve(result),
      ),
    );

  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 500 });
  await post('Profiler.start');
  try {
    const result = await operation();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    return result;
  } finally {
    const { profile } = (await post('Profiler.stop')) as { profile: object };
    await writeFile(path, JSON.stringify(profile));
    session.disconnect();
  }
}
