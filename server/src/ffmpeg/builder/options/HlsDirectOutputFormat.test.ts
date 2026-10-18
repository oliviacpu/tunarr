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
});
