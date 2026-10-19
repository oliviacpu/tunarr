import { HlsOutputFormat } from '@/ffmpeg/builder/options/HlsOutputFormat.js';
import { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { FrameDataLocation, FrameSize } from '@/ffmpeg/builder/types.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempWorkdir } from '../../testing/ffmpeg/FfmpegIntegrationHelper.ts';
import { binaries } from '../../testing/ffmpeg/FfmpegTestFixtures.ts';

// HlsSession bounds ffmpeg's media playlist to a window of its newest
// segments, and every program is its own ffmpeg appending to that file
// (append_list). MediaPlaylistReader keeps the session's history by segment
// number, and relies on what ffmpeg's hls muxer then writes
// (plans/hls-playlist-growth-2026-10-19.md, section 3(a)). This pins that
// behaviour on the ffmpeg found on the PATH (or TUNARR_TEST_FFMPEG), with
// Tunarr's own HLS output options.
describe.skipIf(!binaries)(
  'a windowed HLS playlist across ffmpeg processes',
  () => {
    const ListSize = 5;
    const BaseUrl = '/stream/channels/test/hls/';
    let workdir: string;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      ({ dir: workdir, cleanup } = await createTempWorkdir());
    });

    afterAll(() => cleanup());

    type Entry = { number: number; tagsBefore: number };

    async function readPlaylist(dir: string) {
      const lines = (await fs.readFile(path.join(dir, 'stream.m3u8'), 'utf-8'))
        .split('\n')
        .map((line) => line.trim());
      const mediaSequence = lines
        .find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))
        ?.slice('#EXT-X-MEDIA-SEQUENCE:'.length);
      const entries: Entry[] = [];
      let tags = 0;
      for (const line of lines) {
        if (line === '#EXT-X-DISCONTINUITY') {
          tags++;
          continue;
        }
        const number = line.match(/data(\d{6})\.ts$/)?.[1];
        if (number !== undefined) {
          entries.push({ number: parseInt(number), tagsBefore: tags });
          tags = 0;
        }
      }
      return {
        lines,
        mediaSequence:
          mediaSequence === undefined ? undefined : parseInt(mediaSequence),
        entries,
        tags: lines.filter((line) => line === '#EXT-X-DISCONTINUITY').length,
      };
    }

    // One program: `seconds` of synthetic video and audio, cut into 1 s
    // segments, written with Tunarr's HLS output options
    function runProgram(
      dir: string,
      seconds: number,
      isFirstTranscode: boolean,
    ) {
      if (!binaries) {
        throw new Error('no ffmpeg');
      }
      const format = new HlsOutputFormat(
        new FrameState({
          isAnamorphic: false,
          scaledSize: FrameSize.withDimensions(320, 240),
          paddedSize: FrameSize.withDimensions(320, 240),
          frameDataLocation: FrameDataLocation.Software,
          frameRate: 25,
        }),
        25,
        path.join(dir, 'stream.m3u8'),
        path.join(dir, 'data%06d.ts'),
        BaseUrl,
        isFirstTranscode,
        false,
        false,
        1,
        ListSize,
      );
      execFileSync(binaries.ffmpeg, [
        ...['-hide_banner', '-loglevel', 'error', '-nostdin'],
        ...['-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:d=${seconds}`],
        ...['-f', 'lavfi', '-i', `sine=frequency=440:d=${seconds}`],
        ...['-map', '0:v', '-map', '1:a', '-shortest'],
        ...['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'],
        ...format.options(),
      ]);
    }

    test('continues the numbering in a window that ffmpeg slides', async () => {
      const dir = path.join(workdir, 'session');
      await fs.mkdir(dir);

      // The first program fills the window and slides it
      runProgram(dir, 8, true);
      const first = await readPlaylist(dir);
      const firstLast = first.entries.at(-1)?.number;
      expect(firstLast).toBeGreaterThanOrEqual(ListSize);
      if (firstLast === undefined) {
        return;
      }
      expect(first.entries.map((e) => e.number)).toEqual(
        Array.from(
          { length: ListSize },
          (_, i) => firstLast - ListSize + 1 + i,
        ),
      );
      // MEDIA-SEQUENCE is the first listed segment, and nothing is a
      // discontinuity yet
      expect(first.mediaSequence).toBe(first.entries[0]?.number);
      expect(first.tags).toBe(0);
      expect(first.lines.join('\n')).not.toContain(
        '#EXT-X-DISCONTINUITY-SEQUENCE',
      );

      // The next program's ffmpeg reads the window back in and goes on from
      // the segment after the last one listed
      runProgram(dir, 3, false);
      const second = await readPlaylist(dir);
      const secondStart = firstLast + 1;
      expect(second.entries.map((e) => e.number)).toEqual(
        Array.from(
          { length: ListSize },
          (_, i) => (second.entries.at(-1)?.number ?? 0) - ListSize + 1 + i,
        ),
      );
      expect(second.entries.at(-1)?.number).toBeGreaterThan(secondStart);
      expect(second.mediaSequence).toBe(second.entries[0]?.number);
      expect(second.lines.join('\n')).not.toContain(
        '#EXT-X-DISCONTINUITY-SEQUENCE',
      );
      // One tag, right before the program's first segment. discont_start
      // writes none after the header once the window has slid.
      expect(second.tags).toBe(1);
      expect(second.entries.find((e) => e.tagsBefore > 0)).toEqual({
        number: secondStart,
        tagsBefore: 1,
      });
      const headerEnd = second.lines.findIndex((line) =>
        line.startsWith('#EXTINF:'),
      );
      expect(second.lines.slice(0, headerEnd)).not.toContain(
        '#EXT-X-DISCONTINUITY',
      );

      // A third program slides the second one's first segment out, and its
      // discontinuity tag goes with it
      runProgram(dir, 3, false);
      const third = await readPlaylist(dir);
      const thirdStart = (second.entries.at(-1)?.number ?? 0) + 1;
      expect(third.entries.map((e) => e.number)).not.toContain(secondStart);
      expect(third.entries[0]?.number).toBeGreaterThan(secondStart);
      expect(third.entries.at(-1)?.number).toBeGreaterThan(thirdStart);
      expect(third.mediaSequence).toBe(third.entries[0]?.number);
      expect(third.lines.join('\n')).not.toContain(
        '#EXT-X-DISCONTINUITY-SEQUENCE',
      );
      expect(third.tags).toBe(1);
      expect(third.entries.find((e) => e.tagsBefore > 0)).toEqual({
        number: thirdStart,
        tagsBefore: 1,
      });

      // Every segment file of the session is still there: no process started
      // its numbering over or deleted one
      const files = (await fs.readdir(dir))
        .filter((f) => /^data\d{6}\.ts$/.test(f))
        .sort();
      expect(files).toHaveLength((third.entries.at(-1)?.number ?? 0) + 1);
    });
  },
);
