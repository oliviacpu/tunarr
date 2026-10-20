import { describe, expect, test } from 'vitest';
import { HlsDirectOutputFormat } from './HlsDirectOutputFormat.ts';

function makeFormat(
  isFirstTranscode: boolean,
  playlistPath = '/some/path/stream.m3u8',
) {
  return new HlsDirectOutputFormat(
    playlistPath,
    '/some/path/data%06d.ts',
    '/stream/channels/test-uuid/hls/',
    isFirstTranscode,
  );
}

describe('HlsDirectOutputFormat', () => {
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
    const later = makeFormat(false).options();
    const idx = later.indexOf('-hls_segment_options');
    expect(later[idx + 1]).toBe('mpegts_flags=+initial_discontinuity');
    expect(later).not.toContain('-mpegts_flags');
    expect(makeFormat(true).options()).not.toContain('-hls_segment_options');
  });
  // The playlist used to list every segment of the session
  // (plans/hls-playlist-growth-2026-10-19.md)
  describe('playlist window', () => {
    function playlistOptions(listSize?: number) {
      const opts = new HlsDirectOutputFormat(
        '/some/path/stream.m3u8',
        '/some/path/data%06d.ts',
        '/stream/channels/test-uuid/hls_direct_v2/',
        false,
        false,
        listSize,
      ).options();
      const after = (flag: string) => opts[opts.indexOf(flag) + 1];
      return {
        listSize: after('-hls_list_size'),
        flags: after('-hls_flags')?.split('+'),
      };
    }

    test('lists as many segments as the options say', () => {
      expect(playlistOptions(37).listSize).toBe('37');
      expect(playlistOptions(0).listSize).toBe('0');
    });

    test('lists 15 minutes of its 4 s segments by default', () => {
      expect(playlistOptions().listSize).toBe('225');
    });

    test('keeps appending to the playlist and leaves segment files alone', () => {
      const { flags } = playlistOptions(225);
      expect(flags).toContain('append_list');
      expect(flags).toContain('discont_start');
      expect(flags).not.toContain('delete_segments');
    });
  });
});
