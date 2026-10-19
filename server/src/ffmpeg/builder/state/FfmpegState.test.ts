import type { FfmpegVersionResult } from '@/ffmpeg/ffmpegInfo.ts';
import { describe, expect, test } from 'vitest';
import {
  FileOutputLocation,
  HlsDirectOutputFormat,
  HlsOutputFormat,
  MpegTsOutputFormat,
  OutputFormatTypes,
  StdoutOutputLocation,
  defaultHlsOptions,
} from '@/ffmpeg/builder/constants.ts';
import { FfmpegState } from '@/ffmpeg/builder/state/FfmpegState.ts';

const version: FfmpegVersionResult = {
  versionString: '7.1.1',
  majorVersion: 7,
  minorVersion: 1,
  patchVersion: 1,
  isUnknown: false,
};

describe('FfmpegState', () => {
  // The constructor deep-merges the caller's fields into the instance's
  // defaults. When those defaults were the shared constants themselves, an HLS
  // session's state rewrote MpegTsOutputFormat, and every later state built
  // from it (a .ts program stream) got the HLS muxer and that session's paths.
  test('an HLS output format leaves MpegTsOutputFormat alone', () => {
    FfmpegState.create({
      version,
      outputFormat: HlsOutputFormat({
        ...defaultHlsOptions,
        segmentBaseDirectory: '/streams/another-channel',
      }),
    });
    FfmpegState.create({
      version,
      outputFormat: HlsDirectOutputFormat(defaultHlsOptions),
    });

    expect(MpegTsOutputFormat).toEqual({ type: OutputFormatTypes.MpegTs });

    const state = FfmpegState.create({
      version,
      outputFormat: MpegTsOutputFormat,
    });
    expect(state.outputFormat).toEqual({ type: OutputFormatTypes.MpegTs });
    expect(state.hlsPlaylistPath).toBeUndefined();
  });

  test('a file output location leaves StdoutOutputLocation alone', () => {
    FfmpegState.create({
      version,
      outputLocation: FileOutputLocation('/tmp/out.ts', true),
    });

    expect(StdoutOutputLocation).toEqual({ type: 'stdout' });
    expect(FfmpegState.create({ version }).outputLocation).toEqual({
      type: 'stdout',
    });
  });

  test('states do not share their default output format', () => {
    const hls = FfmpegState.create({
      version,
      outputFormat: HlsOutputFormat(defaultHlsOptions),
    });
    const ts = FfmpegState.forConcat(version, 'Channel');

    expect(hls.outputFormat.type).toBe(OutputFormatTypes.Hls);
    expect(ts.outputFormat.type).toBe(OutputFormatTypes.MpegTs);
    expect(hls.outputFormat).not.toBe(ts.outputFormat);
  });
});
