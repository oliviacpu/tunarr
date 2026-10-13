import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { FfmpegInfo } from './ffmpegInfo.ts';

function fixedPaths(
  ffmpegExecutablePath: string,
  ffprobeExecutablePath: string,
) {
  const paths = { ffmpegExecutablePath, ffprobeExecutablePath };
  return { ffmpegSettings: () => paths };
}

describe('FfmpegInfo.parseFfmpegVersion', () => {
  const info = new FfmpegInfo(
    fixedPaths('/usr/bin/ffmpeg', '/usr/bin/ffprobe'),
  );

  test('parses a jellyfin-ffmpeg version', () => {
    const version = info.parseFfmpegVersion(
      'ffmpeg version 8.1.3-Jellyfin Copyright (c) 2000-2026 the FFmpeg developers\n' +
        'built with Apple clang version 17.0.0 (clang-1700.6.3.2)\n',
    );

    expect(version).toMatchObject({
      versionString: '8.1.3-Jellyfin',
      majorVersion: 8,
      minorVersion: 1,
      patchVersion: 3,
      versionDetails: 'Jellyfin',
      isUnknown: false,
    });
  });

  test('parses an upstream release version', () => {
    const version = info.parseFfmpegVersion(
      'ffmpeg version n7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n',
    );

    expect(version).toMatchObject({
      majorVersion: 7,
      minorVersion: 1,
      patchVersion: 1,
      isUnknown: false,
    });
  });
});

describe('FfmpegInfo executable path', () => {
  let dir: tmp.DirResult;

  beforeEach(() => {
    dir = tmp.dirSync({ unsafeCleanup: true });
  });

  afterEach(() => {
    dir.removeCallback();
  });

  // A stand-in ffmpeg that answers -version and -filters
  function fakeFfmpeg(name: string, version: string, filter: string) {
    const file = path.join(dir.name, name);
    fs.writeFileSync(
      file,
      [
        '#!/bin/sh',
        'case "$*" in',
        `  *-version*) echo "ffmpeg version ${version} Copyright (c) 2000-2026 the FFmpeg developers" ;;`,
        `  *-filters*) printf 'Filters:\\n .S ${filter}  V->V  A filter\\n' ;;`,
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    return file;
  }

  test('follows a change to the ffmpeg path in settings', async () => {
    // Long-lived holders (the pipeline builder factory, singleton services) keep one FfmpegInfo, so it must
    // read the path on every call rather than once when it's created.
    const paths = {
      ffmpegExecutablePath: fakeFfmpeg('ffmpeg-old', '7.1.1', 'zscale'),
      ffprobeExecutablePath: '/unused/ffprobe',
    };
    const info = new FfmpegInfo({ ffmpegSettings: () => paths });

    expect((await info.getVersion()).versionString).toBe('7.1.1');
    expect((await info.getCapabilities()).hasFilter('tonemapx')).toBe(false);

    paths.ffmpegExecutablePath = fakeFfmpeg(
      'ffmpeg-new',
      '8.1.3-Jellyfin',
      'tonemapx',
    );

    expect((await info.getVersion()).versionString).toBe('8.1.3-Jellyfin');
    expect((await info.getCapabilities()).hasFilter('tonemapx')).toBe(true);
  });
});
