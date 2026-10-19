import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import type {
  ContentBackedStreamLineupItem,
  StreamLineupItem,
} from '../../db/derived_types/StreamLineup.ts';
import { createOfflineStreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import type { ProgramType } from '../../db/schema/Program.ts';
import type { SubtitleStreamDetails } from '../types.ts';
import { captionLoadFrames } from './Cea608Encoder.ts';
import {
  firstFrameMs,
  loadProgramCaptions,
  markSegmentsForCaptions,
  noCaptionsNotice,
  noCaptionsNoticeStartMs,
  parseSubtitleCues,
  captionTrackCandidates,
} from './ProgramCaptions.ts';

// ffmpeg drops the frames before the seek, so the program's first frame is
// the first one at or after it
describe('firstFrameMs', () => {
  test('is the first frame at or after the seek', () => {
    expect(firstFrameMs(1348, 30)).toBeCloseTo(41000 / 30);
    expect(firstFrameMs(1, 24000 / 1001)).toBeCloseTo(1001 / 24);
  });

  test('keeps a seek that lands on a frame', () => {
    expect(firstFrameMs(1000, 30)).toBeCloseTo(1000);
    expect(firstFrameMs((5 * 1001) / 24, 24000 / 1001)).toBeCloseTo(
      (5 * 1001) / 24,
    );
  });

  test('is 0 without a seek', () => {
    expect(firstFrameMs(0, 30)).toBe(0);
  });
});

describe('loadProgramCaptions', () => {
  let dir: tmp.DirResult;

  beforeEach(() => {
    dir = tmp.dirSync({ unsafeCleanup: true });
  });

  afterEach(() => {
    dir.removeCallback();
  });

  // A tune-in 1.348 s into the program: the stream's first frame is the one at
  // 1.3667 s, so a cue at 2 s is 19 frames in. From the seek it was 19.56,
  // which rounds to frame 20, one late.
  test("times cues from the program's first frame", async () => {
    const file = path.join(dir.name, 'a.srt');
    await fs.writeFile(
      file,
      '1\n00:00:02,000 --> 00:00:03,500\nHello\n\n2\n00:00:00,500 --> 00:00:01,000\nGone\n',
    );

    const captions = await loadProgramCaptions(
      {
        type: 'external',
        codec: 'subrip',
        default: false,
        forced: false,
        sdh: false,
        languageCodeISO6392: 'eng',
        path: file,
      },
      { seekMs: 1348, durationMs: 60_000, frameRate: 30 },
    );

    expect(captions?.cues).toHaveLength(1);
    expect(captions?.cues[0]?.text).toBe('Hello');
    expect((captions?.cues[0]?.startMs ?? 0) / (1000 / 30)).toBeCloseTo(19);
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

    // No PlayRes and no styles: libass's default script size
    const ctx = { playResX: 384, playResY: 288 };
    expect(parseSubtitleCues(ass, 'ass')).toEqual([
      { startMs: 1250, endMs: 2000, text: '{\\i1}First{\\i0}', ass: ctx },
      { startMs: 5000, endMs: 6500, text: 'Second, with commas', ass: ctx },
    ]);
  });

  const assWith = (head: string[], events: string[]) =>
    [
      ...head,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events,
    ].join('\n');

  test("gives each ASS line its style's alignment and the script's size", () => {
    const ass = assWith(
      [
        '[Script Info]',
        'PlayResX: 1920',
        'PlayResY: 1080',
        '',
        '[V4+ Styles]',
        // Columns in another order than usual
        'Format: Alignment, Name, Fontname, Fontsize',
        'Style: 2,Default,Arial,20',
        'Style: 8,Sign,Arial,20',
        'Style: 3,*Note,Arial,20',
      ],
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Talking',
        'Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,A sign',
        'Dialogue: 0,0:00:05.00,0:00:06.00,Note,,0,0,0,,A note',
        // An unknown style is drawn in Default
        'Dialogue: 0,0:00:07.00,0:00:08.00,Missing,,0,0,0,,Lost',
      ],
    );

    expect(
      parseSubtitleCues(ass, 'ass')?.map((c) => [
        c.text,
        c.ass?.styleAlignment,
        c.ass?.playResX,
        c.ass?.playResY,
      ]),
    ).toEqual([
      ['Talking', 2, 1920, 1080],
      ['A sign', 8, 1920, 1080],
      ['A note', 3, 1920, 1080],
      ['Lost', 2, 1920, 1080],
    ]);
  });

  test("reads SSA's [V4 Styles] alignments in their own numbering", () => {
    const ssa = assWith(
      [
        '[V4 Styles]',
        'Format: Name, Fontname, Alignment',
        'Style: Top,Arial,6',
      ],
      ['Dialogue: 0,0:00:01.00,0:00:02.00,Top,,0,0,0,,Up'],
    );
    expect(parseSubtitleCues(ssa, 'ssa')?.[0]?.ass?.styleAlignment).toBe(8);
  });

  test('works out a missing PlayRes the way libass does', () => {
    const sizeOf = (info: string[]) =>
      parseSubtitleCues(
        assWith(
          ['[Script Info]', ...info],
          ['Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,x'],
        ),
        'ass',
      )?.[0]?.ass;
    expect(sizeOf(['PlayResX: 1280'])).toMatchObject({
      playResX: 1280,
      playResY: 1024,
    });
    expect(sizeOf(['PlayResX: 640'])).toMatchObject({
      playResX: 640,
      playResY: 480,
    });
    expect(sizeOf(['PlayResY: 720'])).toMatchObject({
      playResX: 960,
      playResY: 720,
    });
  });

  test('keeps the same line in two places', () => {
    const ass = assWith(
      [
        '[V4+ Styles]',
        'Format: Name, Alignment',
        'Style: Default,2',
        'Style: Sign,8',
      ],
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Twice',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,Twice',
      ],
    );
    expect(
      parseSubtitleCues(ass, 'ass')?.map((c) => c.ass?.styleAlignment),
    ).toEqual([2, 8]);
  });

  // Typesetting stacks copies of a line (outline, glow) on several layers
  test('keeps a layered line once', () => {
    const ass = assWith(
      [],
      [
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Glow',
        'Dialogue: 1,0:00:01.00,0:00:02.00,Default,,0,0,0,,Glow',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Other',
      ],
    );
    expect(parseSubtitleCues(ass, 'ass')?.map((c) => c.text)).toEqual([
      'Glow',
      'Other',
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

describe('noCaptionsNoticeStartMs', () => {
  test('is 1 s at common frame rates', () => {
    expect(noCaptionsNoticeStartMs(24000 / 1001)).toBe(1000);
    expect(noCaptionsNoticeStartMs(25)).toBe(1000);
    expect(noCaptionsNoticeStartMs(30000 / 1001)).toBe(1000);
  });

  test('waits for a longer load, with 5 frames to spare', () => {
    const heavy = {
      backgroundColor: 'blue',
      textColor: 'red',
      lineWidth: 20,
    } as const;
    const load = captionLoadFrames('No captions for this program', heavy);
    expect(load).toBeGreaterThan(18);
    expect(noCaptionsNoticeStartMs(24000 / 1001, heavy)).toBe(
      Math.ceil(((load + 5) / (24000 / 1001)) * 1000),
    );
  });

  // Loading needs up to 18 frames, after 2 of margin for a late video start
  test('starts later at low frame rates, so loading fits', () => {
    expect(noCaptionsNoticeStartMs(15)).toBe(1534);
    expect(noCaptionsNoticeStartMs(10)).toBe(2300);
  });
});

describe('noCaptionsNotice', () => {
  const programItem = (
    programType: ProgramType = 'episode',
  ): ContentBackedStreamLineupItem =>
    ({
      type: 'program',
      streamDuration: 1_800_000,
      programBeginMs: 0,
      duration: 1_800_000,
      infiniteLoop: false,
      program: {
        uuid: 'program-uuid',
        type: programType,
        mediaSourceId: 'source-id',
        externalIds: [],
      },
    }) as ContentBackedStreamLineupItem;
  const noSubtitles = {
    subtitles: [],
    durationMs: 1_800_000,
    frameRate: 24000 / 1001,
    language: 'eng',
  };
  const textTrack: SubtitleStreamDetails = {
    type: 'external',
    codec: 'subrip',
    default: false,
    forced: false,
    sdh: false,
    languageCodeISO6392: 'eng',
    path: '/subs/a.srt',
  };

  test('shows the notice for 4 s near the start of a program without subtitles', () => {
    expect(noCaptionsNotice(programItem(), noSubtitles)).toEqual({
      cues: [
        { startMs: 1000, endMs: 5000, text: 'No captions for this program' },
      ],
      frameRate: 24000 / 1001,
      durationMs: 1_800_000,
      language: 'eng',
    });
    expect(
      noCaptionsNotice(programItem('movie'), {
        ...noSubtitles,
        language: 'fra',
      })?.language,
    ).toBe('fra');
  });

  test('leaves a program with any subtitle track as it is', () => {
    for (const track of [
      textTrack,
      { ...textTrack, codec: 'hdmv_pgs_subtitle' },
      { ...textTrack, forced: true },
      { ...textTrack, languageCodeISO6392: 'spa' },
    ]) {
      expect(
        noCaptionsNotice(programItem(), { ...noSubtitles, subtitles: [track] }),
      ).toBeUndefined();
    }
  });

  test('adds nothing to filler, flex or anything else that is not a program', () => {
    const program = programItem();
    const items: StreamLineupItem[] = [
      { ...program, type: 'commercial', fillerListId: 'filler-list' },
      { ...program, type: 'fallback' },
      createOfflineStreamLineupItem(60_000, 0),
      {
        type: 'redirect',
        channel: 'other-channel',
        duration: 60_000,
        streamDuration: 60_000,
        programBeginMs: 0,
      },
      {
        type: 'error',
        error: 'failed',
        duration: 60_000,
        streamDuration: 60_000,
        programBeginMs: 0,
      },
    ];

    for (const item of items) {
      expect(noCaptionsNotice(item, noSubtitles)).toBeUndefined();
    }
  });

  test('adds nothing to music tracks', () => {
    expect(noCaptionsNotice(programItem('track'), noSubtitles)).toBeUndefined();
    expect(
      noCaptionsNotice(programItem('music_video'), noSubtitles),
    ).toBeDefined();
  });

  test('needs a frame rate, and a stream twice as long as the notice', () => {
    expect(
      noCaptionsNotice(programItem(), { ...noSubtitles, frameRate: undefined }),
    ).toBeUndefined();
    expect(
      noCaptionsNotice(programItem(), { ...noSubtitles, durationMs: 7_999 }),
    ).toBeUndefined();
    expect(
      noCaptionsNotice(programItem(), { ...noSubtitles, durationMs: 8_000 })
        ?.cues,
    ).toHaveLength(1);
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
