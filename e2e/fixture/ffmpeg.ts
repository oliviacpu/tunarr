import { execFileSync } from 'node:child_process';

// The ffmpeg and ffprobe the fixture uses, both to generate the test clips and
// as the fixture server's FFmpeg settings. The server's own default is
// /usr/bin/ffmpeg, which macOS doesn't have, so the seed step points the server
// at these before it scans the clips.
//
// Each binary resolves in this order:
//   1. TUNARR_TEST_FFMPEG / TUNARR_TEST_FFPROBE, the variables the server's
//      ffmpeg integration tests read
//   2. ffmpeg / ffprobe on the PATH
//   3. the server's default, /usr/bin/ffmpeg and /usr/bin/ffprobe

function onPath(name: string): string | undefined {
  try {
    const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    return found.length > 0 ? found : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

export function resolveFfmpegBinaries(
  env: NodeJS.ProcessEnv = process.env,
  which: (name: string) => string | undefined = onPath,
) {
  return {
    ffmpeg:
      nonEmpty(env.TUNARR_TEST_FFMPEG) ?? which('ffmpeg') ?? '/usr/bin/ffmpeg',
    ffprobe:
      nonEmpty(env.TUNARR_TEST_FFPROBE) ??
      which('ffprobe') ??
      '/usr/bin/ffprobe',
  };
}
