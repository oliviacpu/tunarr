import type { ReadableFfmpegSettings } from '@/db/interfaces/ISettingsDB.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  // The stand-in needs /bin/sh, head and /dev/zero.
  test.skipIf(process.platform === 'win32')(
    'a process blocked writing to an unread pipe exits on SIGTERM, not the 15 s SIGKILL',
    async () => {
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
    },
    10_000,
  );
});

// A made-up token in the URL a media server would hand ffmpeg.
const InputUrl =
  'http://media.example:32400/library/parts/1/file.mkv?X-Plex-Token=abc';
const RedactedUrl =
  'http://media.example:32400/library/parts/1/file.mkv?X-Plex-Token=REDACTED';

// Stands in for ffmpeg failing to open a media-server input: like ffmpeg, it
// prints the input URL ($1) on stderr and exits non-zero. The second line
// arrives in two writes split inside the key, and the last has no line break.
// The sleeps let stderr be read before the exit is seen; the background one
// holds stderr open past the exit, so the exit is seen before stderr ends.
const FailingOpen = [
  '-c',
  [
    `printf "Input #0, mpegts, from '%s':\\n" "$1" >&2`,
    `printf 'Opening %s' "\${1%%ken=*}" >&2`,
    'sleep 0.1',
    `printf '%s for reading\\n' "\${1#*X-Plex-To}" >&2`,
    `printf '%s: Server returned 401 Unauthorized\\n' "$1" >&2`,
    `printf 'Error opening input file %s' "$1" >&2`,
    'sleep 0.2',
    'sleep 1 & exit 1',
  ].join('; '),
  'fake-ffmpeg',
  InputUrl,
];

function fakeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('FfmpegProcess logging', () => {
  let logDirectory: string;
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(async () => {
    logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-process-'));
    logger = fakeLogger();
    vi.spyOn(LoggerFactory, 'child').mockReturnValue(
      logger as unknown as Logger,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(logDirectory, { recursive: true, force: true });
  });

  test.skipIf(process.platform === 'win32')(
    'a failed run logs, saves and prints its stderr with the token redacted',
    async () => {
      const stderrWrites: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation(
        (chunk: string | Uint8Array) => {
          stderrWrites.push(
            typeof chunk === 'string'
              ? chunk
              : Buffer.from(chunk).toString('utf8'),
          );
          return true;
        },
      );

      const proc = new FfmpegProcess(
        { ...settings, enableLogging: true },
        'test-ffmpeg',
        FailingOpen,
        logDirectory,
      );
      const failed = new Promise<string | undefined>((resolve) =>
        proc.once('error', (err) => resolve(err?.cmd)),
      );
      proc.start();
      const cmd = await failed;

      const errorLogs = JSON.stringify(logger.error.mock.calls);
      expect(errorLogs).toContain(`from '${RedactedUrl}'`);
      expect(errorLogs).toContain('X-Plex-Token=REDACTED for reading');
      // The last line, still unfinished when ffmpeg exited.
      expect(errorLogs).toContain(`Error opening input file ${RedactedUrl}"`);
      expect(errorLogs).not.toContain('abc');

      const errorFile = await vi.waitFor(async () => {
        const [name] = await fs.readdir(logDirectory);
        if (name === undefined) {
          throw new Error('No error log written yet');
        }
        expect(name).toMatch(/^ffmpeg-error-log-test-ffmpeg-\d+\.log$/);
        return fs.readFile(path.join(logDirectory, name), 'utf8');
      });
      expect(errorFile).toContain(`${RedactedUrl}: Server returned 401`);
      expect(errorFile).toContain(`Error opening input file ${RedactedUrl}\n`);
      expect(errorFile).toContain(`Original command: -c`);
      expect(errorFile).not.toContain('abc');

      const printed = stderrWrites.join('');
      // Once from the live pipe, once in the dump at exit.
      expect(printed.split(`${RedactedUrl}: Server returned 401`)).toHaveLength(
        3,
      );
      expect(printed).not.toContain('abc');

      expect(cmd).toContain(RedactedUrl);
      // The args lines (debug at start, info at exit) are redacted too.
      const allLogs = JSON.stringify(
        Object.values(logger).map((fn) => fn.mock.calls),
      );
      expect(allLogs).toContain(RedactedUrl);
      expect(allLogs).not.toContain('X-Plex-Token=abc');
    },
    10_000,
  );

  test('a failed spawn logs its arguments with the token redacted', async () => {
    const proc = new FfmpegProcess(
      { ...settings, ffmpegExecutablePath: '/nonexistent/tunarr-test-ffmpeg' },
      'test-ffmpeg',
      ['-i', InputUrl, '-f', 'null', '-'],
      logDirectory,
    );
    proc.start();
    await proc.exited;
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ENOENT',
        spawnargs: ['-i', RedactedUrl, '-f', 'null', '-'],
      }),
      'test-ffmpeg received error event',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'X-Plex-Token=abc',
    );
  });
});
