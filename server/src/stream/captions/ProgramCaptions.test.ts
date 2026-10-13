import type { SubtitleStreamDetails } from '../types.ts';
import {
  exactFrameRate,
  markSegmentsForCaptions,
  parseSubtitleCues,
  captionTrackCandidates,
} from './ProgramCaptions.ts';

describe('exactFrameRate', () => {
  test('keeps a fraction exact', () => {
    expect(exactFrameRate('24000/1001')).toBe(24000 / 1001);
  });

  test('snaps rounded NTSC rates to their exact value', () => {
    expect(exactFrameRate(23.976)).toBe(24000 / 1001);
    expect(exactFrameRate('29.97')).toBe(30000 / 1001);
    expect(exactFrameRate(59.94)).toBe(60000 / 1001);
  });

  test('leaves whole rates alone', () => {
    expect(exactFrameRate(25)).toBe(25);
    expect(exactFrameRate('30')).toBe(30);
  });

  test('has no rate for missing or implausible values', () => {
    expect(exactFrameRate(undefined)).toBeUndefined();
    expect(exactFrameRate('0/0')).toBeUndefined();
    expect(exactFrameRate(1000)).toBeUndefined();
  });
});

describe('parseSubtitleCues', () => {
  test('reads SRT', () => {
    const srt =
      '1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\nthere\r\n\r\n' +
      '2\r\n01:00:00,000 --> 01:00:02,250\r\n<i>Later</i>\r\n';

    expect(parseSubtitleCues(srt, 'subrip')).toEqual([
      { startMs: 1500, endMs: 3000, text: 'Hello\nthere' },
      { startMs: 3_600_000, endMs: 3_602_250, text: '<i>Later</i>' },
    ]);
  });

  test('reads WebVTT, including short timestamps and cue settings', () => {
    const vtt =
      'WEBVTT\n\nNOTE a comment\n\n' +
      'intro\n00:01.000 --> 00:02.500 align:start\nShort form\n\n' +
      '00:00:03.000 --> 00:00:04.000\nLong form\n';

    expect(parseSubtitleCues(vtt, 'webvtt')).toEqual([
      { startMs: 1000, endMs: 2500, text: 'Short form' },
      { startMs: 3000, endMs: 4000, text: 'Long form' },
    ]);
  });

  test('reads ASS dialogue in time order, keeping commas in the text', () => {
    const ass = [
      '[Script Info]',
      'Title: x',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:05.00,0:00:06.50,Default,,0,0,0,,Second, with commas',
      'Dialogue: 0,0:00:01.25,0:00:02.00,Default,,0,0,0,,{\\i1}First{\\i0}',
    ].join('\n');

    expect(parseSubtitleCues(ass, 'ass')).toEqual([
      { startMs: 1250, endMs: 2000, text: '{\\i1}First{\\i0}' },
      { startMs: 5000, endMs: 6500, text: 'Second, with commas' },
    ]);
  });

  test('keeps the formatting tags the caption encoder reads', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>Up here</i>\n';

    expect(parseSubtitleCues(srt, 'subrip')).toEqual([
      { startMs: 1000, endMs: 2000, text: '{\\an8}<i>Up here</i>' },
    ]);
  });

  test('has nothing for image-based formats', () => {
    expect(parseSubtitleCues('', 'hdmv_pgs_subtitle')).toBeUndefined();
  });
});

describe('captionTrackCandidates', () => {
  const track = (
    overrides: Partial<SubtitleStreamDetails>,
  ): SubtitleStreamDetails => ({
    type: 'external',
    codec: 'subrip',
    default: false,
    forced: false,
    sdh: false,
    languageCodeISO6392: 'eng',
    path: '/subs/a.srt',
    ...overrides,
  });
  const english = [{ iso6391: 'en', iso6392: 'eng' }];

  test('skips forced and image-based tracks', () => {
    const tracks = [
      track({ forced: true, title: 'forced' }),
      track({ codec: 'hdmv_pgs_subtitle', title: 'image' }),
      track({ type: 'embedded', path: undefined, index: 3, title: 'embedded' }),
      track({ title: 'full' }),
    ];

    // Embedded tracks stay in: their extracted copy is looked up later
    expect(captionTrackCandidates(tracks, english).map((t) => t.title)).toEqual(
      ['embedded', 'full'],
    );
  });

  test('follows the language preferences, regular before SDH', () => {
    const tracks = [
      track({ languageCodeISO6392: 'spa', title: 'spanish' }),
      track({ sdh: true, title: 'english sdh' }),
      track({ title: 'english' }),
    ];

    expect(captionTrackCandidates(tracks, english).map((t) => t.title)).toEqual(
      ['english', 'english sdh'],
    );
    expect(
      captionTrackCandidates(tracks, [
        { iso6391: 'es', iso6392: 'spa' },
        { iso6391: 'en', iso6392: 'eng' },
      ]).map((t) => t.title),
    ).toEqual(['spanish', 'english', 'english sdh']);
    expect(
      captionTrackCandidates(tracks, [{ iso6391: 'fr', iso6392: 'fra' }]),
    ).toEqual([]);
  });
});

describe('markSegmentsForCaptions', () => {
  test('flags segment URIs and leaves tags alone', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:2',
      '#EXTINF:2.000000,',
      '/stream/channels/abc/hls/data000001.ts',
      '#EXT-X-MAP:URI="init.mp4"',
      '',
    ].join('\n');

    expect(markSegmentsForCaptions(playlist)).toBe(
      [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:2',
        '#EXTINF:2.000000,',
        '/stream/channels/abc/hls/data000001.ts?captions=1',
        '#EXT-X-MAP:URI="init.mp4"',
        '',
      ].join('\n'),
    );
  });
});
