import type { ReadableFfmpegSettings } from '@/db/interfaces/ISettingsDB.js';
import { PassThrough } from 'node:stream';
import { FfmpegProcess } from './FfmpegProcess.ts';

// Stands in for ffmpeg: writes 64 KB blocks for ever and, like ffmpeg, can
// only act on SIGTERM between writes (the shell runs its trap once `head`
// returns). With no reader, the pipe fills and `head` blocks in write().
const BlockedWriter = [
  '-c',
  'trap "exit 0" TERM; while :; do head -c 65536 /dev/zero; done',
];

const settings = {
  ffmpegExecutablePath: '/bin/sh',
  enableLogging: false,
  enableFileLogging: false,
  logLevel: 'warning',
} as unknown as ReadableFfmpegSettings;

describe('FfmpegProcess.kill', () => {
  test('a process blocked writing to an unread pipe exits on SIGTERM, not the 15 s SIGKILL', async () => {
    const proc = new FfmpegProcess(
      settings,
      'test-writer',
      BlockedWriter,
      '/tmp',
    );
    const out = proc.start()!;
    // A destination nobody reads: backpressure stops the pipe being drained.
    out.pipe(new PassThrough({ highWaterMark: 1024 }));
    await new Promise((resolve) => setTimeout(resolve, 500));

    const exit = new Promise<[number | null, string | null]>((resolve) =>
      proc.once('exit', (code, signal) => resolve([code, signal])),
    );
    const started = Date.now();
    proc.kill();
    const [code, signal] = await exit;

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(signal).not.toBe('SIGKILL');
    expect(code).toBe(0);
  }, 10_000);
});
