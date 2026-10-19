import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { binaries } from '../../../testing/ffmpeg/FfmpegTestFixtures.ts';
import { readFontMetrics } from '../../fontMetrics.ts';
import { nowPlayingLine } from '../../nowPlayingText.ts';
import { NowPlayingTextFilter } from './NowPlayingTextFilter.ts';

const run = promisify(execFile);
const ffmpeg = binaries?.ffmpeg;
const filters = ffmpeg
  ? (await run(ffmpeg, ['-hide_banner', '-filters'])).stdout
  : '';

describe.skipIf(!filters.includes(' drawtext '))(
  'now-playing rendering',
  () => {
    test.each([
      [1920, 1080],
      [1080, 1080],
      [360, 640],
    ])(
      'keeps a full-width line inside a %i x %i picture',
      async (width, height) => {
        if (!ffmpeg) throw new Error('Missing ffmpeg');
        const font = path.resolve(
          'src/resources/fonts/MPLUSRounded1c-Bold.ttf',
        );
        const metrics = readFontMetrics(await fs.readFile(font));
        const text = nowPlayingLine({ title: 'W'.repeat(100) }, metrics);
        if (!text) throw new Error('Missing test text');
        const { stdout } = await run(
          ffmpeg,
          [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            `color=black:s=${width}x${height}`,
            '-vf',
            new NowPlayingTextFilter(text, font).filter,
            '-frames:v',
            '1',
            '-pix_fmt',
            'gray',
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          { encoding: 'buffer', maxBuffer: width * height * 2 },
        );
        expect(stdout.length).toBe(width * height);
        let left = width;
        let right = -1;
        for (let i = 0; i < stdout.length; i++) {
          if ((stdout[i] ?? 0) > 128) {
            left = Math.min(left, i % width);
            right = Math.max(right, i % width);
          }
        }
        expect(left).toBeGreaterThan(0);
        expect(right).toBeGreaterThan(left);
        expect(right).toBeLessThan(width - 1);
      },
    );

    test('renders punctuation and Japanese through the real filter parser', async () => {
      if (!ffmpeg) throw new Error('Missing ffmpeg');
      const font = path.resolve('src/resources/fonts/MPLUSRounded1c-Bold.ttf');
      await expect(
        run(ffmpeg, [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=black:s=1080x1080',
          '-vf',
          new NowPlayingTextFilter("It's: 100% [新宿] \\ song", font).filter,
          '-frames:v',
          '1',
          '-f',
          'null',
          '-',
        ]),
      ).resolves.toBeDefined();
    });
  },
);
