import type { Logger } from '@/util/logging/LoggerFactory.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { ChildProcessHelper } from './ChildProcessHelper.ts';

// A made-up token in the URL a media server would hand ffprobe or ffmpeg.
const InputUrl =
  'http://media.example:32400/library/parts/1/a.mkv?X-Plex-Token=abc:tail;part,(suffix)';
const RedactedUrl =
  'http://media.example:32400/library/parts/1/a.mkv?X-Plex-Token=REDACTED';

describe('ChildProcessHelper.getStdout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The stand-in needs /bin/sh.
  test.skipIf(process.platform === 'win32')(
    'a failed command logs and rejects with the token redacted',
    async () => {
      const logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.spyOn(LoggerFactory, 'child').mockReturnValue(
        logger as unknown as Logger,
      );
      vi.spyOn(LoggerFactory, 'root', 'get').mockReturnValue(
        logger as unknown as Logger,
      );

      // Fails the way ffprobe does on a refused input: the URL ($1) on
      // stderr. execFile puts the command line and stderr in the error.
      const error: unknown = await new ChildProcessHelper()
        .getStdout('/bin/sh', [
          '-c',
          `printf '%s: Server returned 401 Unauthorized\\n' "$1" >&2; exit 1`,
          'fake-ffprobe',
          InputUrl,
        ])
        .then(
          () => undefined,
          (e: unknown) => e,
        );

      if (!(error instanceof Error)) {
        throw new Error('Expected getStdout to reject with an Error');
      }
      expect(error.message).toContain(`${RedactedUrl}: Server returned 401`);
      expect(error).toMatchObject({
        code: 1,
        cmd: expect.stringContaining(RedactedUrl),
      });
      expect(
        `${error.message}${error.stack}${JSON.stringify(error)}`,
      ).not.toMatch(/abc|tail|suffix/);

      const debugged = JSON.stringify(logger.debug.mock.calls);
      expect(debugged).toContain(RedactedUrl);
      expect(debugged).not.toContain('X-Plex-Token=abc');
    },
  );
});
