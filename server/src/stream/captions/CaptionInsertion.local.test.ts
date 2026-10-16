import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createTempWorkdir } from '../../testing/ffmpeg/FfmpegIntegrationHelper.ts';
import { binaries } from '../../testing/ffmpeg/FfmpegTestFixtures.ts';
import { CaptionLanguageStream } from './CaptionLanguageStream.ts';
import type { CaptionAppearance, CaptionCue } from './Cea608Encoder.ts';
import { PaddingPair, buildCaptionSchedule } from './Cea608Encoder.ts';
import { insertCaptions } from './MpegTsCaptionInserter.ts';

// Captions written into real libx264 output (B-frames, MPEG-TS as Tunarr's HLS
// segments are muxed) must come back out of ffmpeg's own 608 decoder with the
// right text, on the right frames.
describe.skipIf(!binaries)('caption insertion with ffmpeg', () => {
  let workdir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ dir: workdir, cleanup } = await createTempWorkdir());
  });

  afterAll(() => cleanup());

  test('ffmpeg decodes the inserted captions', async () => {
    if (!binaries) {
      return;
    }
    const input = path.join(workdir, 'in.ts');
    const output = path.join(workdir, 'out.ts');
    execFileSync(binaries.ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440'],
      ...['-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac'],
      ...['-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', input],
    ]);
    const firstPts = Number(
      execFileSync(binaries.ffprobe, [
        ...['-v', 'error', '-select_streams', 'v', '-read_intervals', '%+#1'],
        ...['-show_entries', 'packet=pts', '-of', 'csv=p=0', input],
      ])
        .toString()
        .split('\n')[0]
        ?.replace(',', ''),
    );
    const firstMs = firstPts / 90;
    const schedule = buildCaptionSchedule(
      [
        {
          startMs: firstMs + 1000,
          endMs: firstMs + 3000,
          text: 'Hello there.',
        },
        {
          startMs: firstMs + 4000,
          endMs: firstMs + 6000,
          text: 'Café ñandú «Ölgemälde» ♪',
        },
      ],
      { firstFrameMs: firstMs, frameRate: 30 },
    );

    const result = insertCaptions(await fs.readFile(input), {
      pairForPts: (pts) => schedule.pairAt(pts / 90),
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    await fs.writeFile(output, result.segment);

    const srt = execFileSync(binaries.ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error'],
      ...['-f', 'lavfi', '-i', `movie=${output}[out0+subcc]`],
      ...['-map', '0:s', '-f', 'srt', '-'],
    ])
      .toString()
      .replace(/<[^>]*>|\{[^}]*\}|\\h/g, '');

    expect(srt).toContain('00:00:01,000 --> 00:00:03,000\nHello there.');
    expect(srt).toContain(
      '00:00:04,000 --> 00:00:06,000\nCafé ñandú «Ölgemälde» ♪',
    );

    // Every frame carries caption data, so players detect the track
    const frames = execFileSync(binaries.ffprobe, [
      ...['-v', 'error', '-select_streams', 'v', '-show_frames'],
      ...[
        '-show_entries',
        'frame_side_data=side_data_type',
        '-of',
        'csv',
        output,
      ],
    ]).toString();
    const frameCount = frames
      .split('\n')
      .filter((l) => l.startsWith('frame')).length;
    expect(frames.match(/A53/g)?.length).toBe(frameCount);
  });

  // ffmpeg's decoder writes each caption as ASS: {\an7}{\pos(x,y)} per row
  // from its 608 row and column, with \h for leading spaces and {\i1}/{\u1}
  // for styles. Plex burns captions in with a decoder of the same lineage.
  test('ffmpeg decodes italics, underline, top placement and alignment', async () => {
    if (!binaries) {
      return;
    }
    const { ffmpeg, ffprobe } = binaries;
    const input = path.join(workdir, 'styled-in.ts');
    execFileSync(ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'],
      ...['-t', '10', '-c:v', 'libx264', '-preset', 'veryfast'],
      ...['-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', input],
    ]);
    const firstMs =
      Number(
        execFileSync(ffprobe, [
          ...['-v', 'error', '-select_streams', 'v', '-read_intervals', '%+#1'],
          ...['-show_entries', 'packet=pts', '-of', 'csv=p=0', input],
        ])
          .toString()
          .split('\n')[0]
          ?.replace(',', ''),
      ) / 90;
    const cues: CaptionCue[] = [
      {
        startMs: firstMs + 1000,
        endMs: firstMs + 3000,
        text: 'He said <i>hello there</i> to me\n<u>Under</u> plain',
      },
      {
        startMs: firstMs + 4000,
        endMs: firstMs + 6000,
        text: '{\\an8}Top of the screen',
      },
      {
        startMs: firstMs + 7000,
        endMs: firstMs + 9000,
        text: 'Short\nA much longer second line',
      },
    ];

    const decode = async (layout: Pick<CaptionAppearance, 'alignment'>) => {
      const schedule = buildCaptionSchedule(cues, {
        firstFrameMs: firstMs,
        frameRate: 30,
        appearance: layout,
      });
      const result = insertCaptions(await fs.readFile(input), {
        pairForPts: (pts) => schedule.pairAt(pts / 90),
        language: 'eng',
      });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      const output = path.join(workdir, `styled-${layout.alignment}.ts`);
      await fs.writeFile(output, result.segment);
      return execFileSync(ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error'],
        ...['-f', 'lavfi', '-i', `movie=${output}[out0+subcc]`],
        ...['-map', '0:s', '-f', 'ass', '-'],
      ])
        .toString()
        .split('\n')
        .filter((line) => line.startsWith('Dialogue:'));
    };
    const rowY = (dialogue: string | undefined) =>
      [...(dialogue ?? '').matchAll(/\\pos\(\d+,(\d+)\)/g)].map((m) =>
        Number(m[1]),
      );

    const block = await decode({ alignment: 'centeredBlock' });
    expect(block).toHaveLength(3);
    expect(block[0]).toContain('{\\i1} hello there{\\i0}');
    expect(block[0]).toContain('{\\u1}');
    expect(block[0]).toContain('Under{\\u0}');
    // The top caption is above both rows of the bottom ones
    const topY = rowY(block[1]);
    expect(topY).toHaveLength(1);
    expect(Math.max(...topY)).toBeLessThan(Math.min(...rowY(block[0])));
    // Block-centred lines start at the same column
    expect(block[2]).toContain('}Short\\N');

    // Centred lines: "Short" starts 10 columns right of the longer line (13 vs 3)
    const lines = await decode({ alignment: 'centeredLines' });
    expect(lines[2]).toContain(`}${'\\h'.repeat(10)}Short\\N`);
  });

  // The HDHomeRun .ts stream is ffmpeg's remux of the captioned segments, as
  // ConcatStream runs it. ffmpeg writes a PMT of its own, so readers of the
  // same lineage as Plex's saw no language until CaptionLanguageStream.
  // What ffmpeg's decoder, of the family Plex's player comes from, makes of
  // the appearance options: ASS events with their start time and text
  describe('appearance', () => {
    let input: string;
    let firstMs: number;

    beforeAll(() => {
      if (!binaries) {
        return;
      }
      input = path.join(workdir, 'appearance-in.ts');
      execFileSync(binaries.ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error', '-y'],
        ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'],
        ...['-t', '10', '-c:v', 'libx264', '-preset', 'veryfast'],
        ...['-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', input],
      ]);
      firstMs =
        Number(
          execFileSync(binaries.ffprobe, [
            ...['-v', 'error', '-select_streams', 'v'],
            ...['-read_intervals', '%+#1', '-show_entries', 'packet=pts'],
            ...['-of', 'csv=p=0', input],
          ])
            .toString()
            .split('\n')[0]
            ?.replace(',', ''),
        ) / 90;
    });

    async function events(
      name: string,
      cues: CaptionCue[],
      appearance: Partial<CaptionAppearance>,
      { realTime = false } = {},
    ) {
      if (!binaries) {
        return [];
      }
      const schedule = buildCaptionSchedule(
        cues.map((cue) => ({
          ...cue,
          startMs: firstMs + cue.startMs,
          endMs: firstMs + cue.endMs,
        })),
        { firstFrameMs: firstMs, frameRate: 30, appearance },
      );
      const result = insertCaptions(await fs.readFile(input), {
        pairForPts: (pts) => schedule.pairAt(pts / 90),
        language: 'eng',
      });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      const output = path.join(workdir, `appearance-${name}.ts`);
      await fs.writeFile(output, result.segment);
      return execFileSync(binaries.ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error'],
        ...(realTime ? ['-real_time', '1'] : []),
        ...['-f', 'lavfi', '-i', `movie=${output}[out0+subcc]`],
        ...['-map', '0:s', '-f', 'ass', '-'],
      ])
        .toString()
        .split('\n')
        .filter((line) => line.startsWith('Dialogue:'))
        .map((line) => {
          const [, start = '', text = ''] =
            /^Dialogue: \d+,(\d+:\d+:[\d.]+),[^,]*,(?:[^,]*,){6}(.*)$/.exec(
              line,
            ) ?? [];
          return {
            start,
            text: text.replace(/\{\\an7\}\{\\pos\([^)]*\)\}/g, ''),
          };
        });
    }

    test('colours the text and the box behind it', async () => {
      const [event] = await events(
        'colour',
        [{ startMs: 1000, endMs: 3000, text: 'Red on blue' }],
        { textColor: 'red', backgroundColor: 'blue' },
      );
      // ASS colours are blue-green-red
      expect(event?.text).toContain('{\\c&H0000FF&}');
      expect(event?.text).toContain('{\\3c&HFF0000&}');
      expect(event?.text).toContain('Red on blue');
    });

    // FFmpeg's decoder writes each caption's first row as {\\an7}{\\pos(x,y)}
    test('places middle and right-aligned cues', async () => {
      const pos = (text: string) => {
        const m = /\\pos\((\d+),(\d+)\)/.exec(text);
        return m ? [Number(m[1]), Number(m[2])] : [];
      };
      if (!binaries) {
        return;
      }
      const shown = await events(
        'placement',
        [
          { startMs: 1000, endMs: 3000, text: 'Bottom' },
          { startMs: 4000, endMs: 6000, text: '{\\an5}Middle' },
          { startMs: 7000, endMs: 9000, text: '{\\an3}Right' },
        ],
        {},
      );
      // events() strips the position, so read it from the raw text again
      const raw = execFileSync(binaries.ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
        ...[
          '-i',
          `movie=${path.join(workdir, 'appearance-placement.ts')}[out0+subcc]`,
        ],
        ...['-map', '0:s', '-f', 'ass', '-'],
      ])
        .toString()
        .split('\n')
        .filter((line) => line.startsWith('Dialogue:'));
      expect(shown.map((e) => e.text.trim())).toEqual([
        'Bottom',
        'Middle',
        'Right',
      ]);
      const [bottom, middle, right] = raw.map(pos);
      // The middle row sits between the top and bottom of a 288-line script
      expect(middle?.[1]).toBeGreaterThan(100);
      expect(middle?.[1]).toBeLessThan(bottom?.[1] ?? 0);
      // Right-aligned text starts well right of centred text
      expect(right?.[0]).toBeGreaterThan((bottom?.[0] ?? 0) + 60);
    });

    test('stacks overlapping subtitles in consecutive rows', async () => {
      const shown = await events(
        'stacked',
        [
          { startMs: 1000, endMs: 5000, text: 'First' },
          { startMs: 2500, endMs: 4000, text: 'Second' },
        ],
        {},
      );
      expect(shown.map((e) => e.text)).toEqual([
        'First',
        'First\\NSecond',
        'First',
      ]);
    });

    // A sign and dialogue as two blocks: FFmpeg writes a position for each
    // row, but libass (which burns FFmpeg's subtitles in) honours only the
    // first in an event. Whether Plex places both is test pattern sample 38.
    test('writes a two-block caption with a position for each block', async () => {
      if (!binaries) {
        return;
      }
      await events(
        'apart',
        [
          { startMs: 1000, endMs: 5000, text: '{\\an8}Sign' },
          { startMs: 2000, endMs: 4000, text: 'Talk' },
        ],
        { overlappingCues: 'apart' },
      );
      const raw = execFileSync(binaries.ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
        ...[
          '-i',
          `movie=${path.join(workdir, 'appearance-apart.ts')}[out0+subcc]`,
        ],
        ...['-map', '0:s', '-f', 'ass', '-'],
      ])
        .toString()
        .split('\n')
        .filter((line) => line.startsWith('Dialogue:'));
      const both = raw.find(
        (line) => line.includes('Sign') && line.includes('Talk'),
      );
      const ys = [...(both ?? '').matchAll(/\\pos\(\d+,(\d+)\)/g)].map((m) =>
        Number(m[1]),
      );
      expect(ys).toHaveLength(2);
      expect(ys[0]).toBeLessThan(60);
      expect(ys[1]).toBeGreaterThan(200);
    });

    test('rolls lines up, keeping the chosen number of rows', async () => {
      const shown = await events(
        'rollup',
        [{ startMs: 1000, endMs: 5000, text: 'One\nTwo\nThree' }],
        { mode: 'rollUp2' },
      );
      expect(shown.map((e) => [e.start, e.text])).toEqual([
        ['0:00:01.00', 'One'],
        // Each line follows the one before as soon as it has been sent
        [expect.any(String), 'One\\NTwo'],
        [expect.any(String), 'Two\\NThree'],
      ]);
    });

    test('paints text on from the start frame', async () => {
      const shown = await events(
        'painton',
        [{ startMs: 1000, endMs: 3000, text: 'Painted' }],
        { mode: 'paintOn' },
        { realTime: true },
      );
      const painted = shown.filter((e) => e.text === 'Painted');
      expect(painted).toHaveLength(1);
      // Its first characters appear a frame or two after the start
      const first = shown.find((e) => e.text.length > 0);
      expect(first?.start).toMatch(/^0:00:01\.0\d$/);
    });
  });

  test("the remuxed stream names the captions' language", async () => {
    if (!binaries) {
      return;
    }
    const { ffmpeg, ffprobe } = binaries;
    const input = path.join(workdir, 'label-in.ts');
    const captioned = path.join(workdir, 'label-captioned.ts');
    const remuxed = path.join(workdir, 'label-remuxed.ts');
    const labelled = path.join(workdir, 'label-out.ts');
    execFileSync(ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440'],
      ...['-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac'],
      ...['-f', 'mpegts', input],
    ]);
    const result = insertCaptions(await fs.readFile(input), {
      pairForPts: () => PaddingPair,
      language: 'eng',
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    await fs.writeFile(captioned, result.segment);
    execFileSync(ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-i', captioned],
      ...['-map', '0', '-c', 'copy', '-f', 'mpegts', remuxed],
    ]);

    const videoLanguage = (file: string) =>
      execFileSync(ffprobe, [
        ...['-v', 'error', '-select_streams', 'v'],
        ...['-show_entries', 'stream_tags=language', '-of', 'csv=p=0', file],
      ])
        .toString()
        .trim();
    expect(videoLanguage(captioned)).toBe('eng');
    expect(videoLanguage(remuxed)).toBe('');

    await pipeline(
      createReadStream(remuxed),
      new CaptionLanguageStream('eng'),
      createWriteStream(labelled),
    );
    expect(videoLanguage(labelled)).toBe('eng');
  });
});
