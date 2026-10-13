import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempWorkdir } from '../../testing/ffmpeg/FfmpegIntegrationHelper.ts';
import { binaries } from '../../testing/ffmpeg/FfmpegTestFixtures.ts';
import { buildCaptionSchedule } from './Cea608Encoder.ts';
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
});
