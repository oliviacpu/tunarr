import { FfmpegInfo } from './ffmpegInfo.ts';

describe('FfmpegInfo.parseFfmpegVersion', () => {
  const info = new FfmpegInfo('/usr/bin/ffmpeg', '/usr/bin/ffprobe');

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
