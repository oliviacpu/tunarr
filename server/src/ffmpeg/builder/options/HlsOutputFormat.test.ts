import { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { FrameDataLocation, FrameSize } from '@/ffmpeg/builder/types.js';
import { describe, expect, test } from 'vitest';
import { HlsOutputFormat } from './HlsOutputFormat.ts';

function makeFormat(
  isFirstTranscode: boolean,
  playlistPath = '/some/path/stream.m3u8',
) {
  const state = new FrameState({
    isAnamorphic: false,
    scaledSize: FrameSize.FHD,
    paddedSize: FrameSize.FHD,
    frameDataLocation: FrameDataLocation.Software,
  });
  return new HlsOutputFormat(
    state,
    24,
    playlistPath,
    '/some/path/data%06d.ts',
    '/stream/channels/test-uuid/hls/',
    isFirstTranscode,
    false,
  );
}

describe('HlsOutputFormat', () => {
  test('includes -master_pl_name playlist.m3u8 for first transcode', () => {
    const opts = makeFormat(true).options();
    const idx = opts.indexOf('-master_pl_name');
    expect(idx).toBeGreaterThan(-1);
    expect(opts[idx + 1]).toBe('playlist.m3u8');
  });

  test('includes -master_pl_name playlist.m3u8 for subsequent transcodes', () => {
    const opts = makeFormat(false).options();
    const idx = opts.indexOf('-master_pl_name');
    expect(idx).toBeGreaterThan(-1);
    expect(opts[idx + 1]).toBe('playlist.m3u8');
  });

  test('-master_pl_name appears before the output path', () => {
    const playlistPath = '/some/path/stream.m3u8';
    const opts = makeFormat(true, playlistPath).options();
    const masterIdx = opts.indexOf('-master_pl_name');
    const outputIdx = opts.lastIndexOf(playlistPath);
    expect(masterIdx).toBeGreaterThan(-1);
    expect(outputIdx).toBeGreaterThan(-1);
    expect(masterIdx).toBeLessThan(outputIdx);
  });

  test("marks a later program's first packets as a discontinuity through the segment muxer", () => {
    // A bare -mpegts_flags never reaches the HLS muxer's segment muxer, so the
    // .ts wrapper took each program's restarted counters for corruption
    const later = makeFormat(false).options();
    const idx = later.indexOf('-hls_segment_options');
    expect(later[idx + 1]).toBe('mpegts_flags=+initial_discontinuity');
    expect(later).not.toContain('-mpegts_flags');
    expect(makeFormat(true).options()).not.toContain('-hls_segment_options');
  });

  describe('keyframe interval', () => {
    function gopOptions(frameRate: number | null, oneSecondGop = false) {
      const state = new FrameState({
        isAnamorphic: false,
        scaledSize: FrameSize.FHD,
        paddedSize: FrameSize.FHD,
        frameDataLocation: FrameDataLocation.Software,
        frameRate,
      });
      const opts = new HlsOutputFormat(
        state,
        24,
        '/some/path/stream.m3u8',
        '/some/path/data%06d.ts',
        '/stream/channels/test-uuid/hls/',
        true,
        oneSecondGop,
      ).options();
      return {
        gop: opts[opts.indexOf('-g') + 1],
        keyintMin: opts[opts.indexOf('-keyint_min') + 1],
      };
    }

    test('uses whole frame counts for a fractional output frame rate', () => {
      // 23.976 fps x 4 s segments would otherwise be written as -g 95.904
      expect(gopOptions(23.976)).toEqual({ gop: '96', keyintMin: '96' });
      expect(gopOptions(29.97, true)).toEqual({ gop: '30', keyintMin: '120' });
    });

    test('falls back to the media frame rate', () => {
      expect(gopOptions(null)).toEqual({ gop: '96', keyintMin: '96' });
    });
  });
  describe('segment length', () => {
    function segmentOptions(segmentSeconds?: number) {
      const state = new FrameState({
        isAnamorphic: false,
        scaledSize: FrameSize.FHD,
        paddedSize: FrameSize.FHD,
        frameDataLocation: FrameDataLocation.Software,
      });
      const opts = new HlsOutputFormat(
        state,
        24,
        '/some/path/stream.m3u8',
        '/some/path/data%06d.ts',
        '/stream/channels/test-uuid/hls/',
        true,
        false,
        false,
        segmentSeconds,
      ).options();
      const after = (flag: string) => opts[opts.indexOf(flag) + 1];
      return {
        hlsTime: after('-hls_time'),
        gop: after('-g'),
        keyintMin: after('-keyint_min'),
        forceKeyFrames: after('-force_key_frames'),
      };
    }

    test('defaults to 4 s segments', () => {
      expect(segmentOptions()).toEqual({
        hlsTime: '4',
        gop: '96',
        keyintMin: '96',
        forceKeyFrames: 'expr:gte(t,n_forced*4)',
      });
    });

    test('keeps keyframes on segment boundaries for shorter segments', () => {
      expect(segmentOptions(2)).toEqual({
        hlsTime: '2',
        gop: '48',
        keyintMin: '48',
        forceKeyFrames: 'expr:gte(t,n_forced*2)',
      });
    });
  });
});
