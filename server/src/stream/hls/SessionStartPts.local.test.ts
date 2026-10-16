import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempWorkdir } from '../../testing/ffmpeg/FfmpegIntegrationHelper.ts';
import { binaries } from '../../testing/ffmpeg/FfmpegTestFixtures.ts';
import { SessionStartPts } from './HlsSession.ts';

// What SessionStartPts works around, with libx264's B-frames and MPEG-TS HLS
// segments muxed as Tunarr muxes them
describe.skipIf(!binaries)("a program's first video frame", () => {
  let workdir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ dir: workdir, cleanup } = await createTempWorkdir());
  });

  afterAll(() => cleanup());

  async function firstVideoPts(offsetSeconds?: number) {
    if (!binaries) {
      throw new Error('no ffmpeg');
    }
    const dir = path.join(workdir, String(offsetSeconds ?? 'none'));
    await fs.mkdir(dir);
    execFileSync(binaries.ffmpeg, [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440'],
      ...['-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac'],
      ...['-muxdelay', '0', '-muxpreload', '0'],
      ...(offsetSeconds === undefined
        ? []
        : ['-output_ts_offset', `${offsetSeconds}`]),
      ...['-f', 'hls', '-hls_time', '2'],
      ...['-hls_segment_filename', path.join(dir, 'data%06d.ts')],
      path.join(dir, 'stream.m3u8'),
    ]);
    const pts = execFileSync(binaries.ffprobe, [
      ...['-v', 'error', '-select_streams', 'v'],
      ...['-show_entries', 'packet=pts', '-of', 'csv=p=0'],
      path.join(dir, 'data000000.ts'),
    ])
      .toString()
      .split('\n')
      .map((line) => Number.parseInt(line, 10))
      .filter(Number.isFinite);
    return Math.min(...pts);
  }

  test('comes after the B-frame delay when the clock starts at 0', async () => {
    const pts = await firstVideoPts();

    // Whole frames (3000 ticks at 30 fps) late
    expect(pts).toBeGreaterThan(0);
    expect(pts % 3000).toBe(0);
  });

  test("comes exactly at the session's starting offset", async () => {
    expect(await firstVideoPts(SessionStartPts / 90_000)).toBe(SessionStartPts);
  });
});
