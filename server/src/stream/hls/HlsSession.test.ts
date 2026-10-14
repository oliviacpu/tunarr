import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { OutputFormat } from '@/ffmpeg/builder/constants.js';
import type { OnDemandChannelService } from '@/services/OnDemandChannelService.js';
import type { PlayerContext } from '@/stream/PlayerStreamContext.js';
import type { StreamProgramCalculator } from '@/stream/StreamProgramCalculator.js';
import type { SubtitleRenditionInfo } from '@/stream/types.js';
import { Result } from '@/types/result.js';
import { defaultFfmpegSettings } from '@tunarr/types';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  framePts,
  makeTsSegment,
  parseTsSegment,
} from '../../testing/captions/MpegTsSegmentFixture.ts';
import type { ContentBackedStreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import type { ProgramCaptions } from '../captions/ProgramCaptions.ts';
import { noCaptionsNotice } from '../captions/ProgramCaptions.ts';
import { ProgramStream } from '../ProgramStream.ts';
import type { HlsSessionOptions } from './HlsSession.js';
import { HlsSession } from './HlsSession.js';
import type { TranscodeSpeedEvent } from './TranscodeSpeedMonitor.ts';

dayjs.extend(duration);

vi.mock('@/util/logging/LoggerFactory.js', () => ({
  LoggerFactory: {
    child: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
      bindings: () => ({}),
      setBindings: vi.fn(),
    }),
  },
}));

vi.mock('@/stream/ConnectionTracker.ts', () => {
  return {
    ConnectionTracker: class {
      on = vi.fn();
      recordHeartbeat = vi.fn();
      removeStaleConnections = vi.fn(() => []);
      cancelCleanup = vi.fn();
    },
  };
});

// Each TranscodeSpeedWatcher the session creates, by its event callback, and
// the order the current test's watcher and fake ffmpeg ran in
const speedWatchers = vi.hoisted(
  () => [] as { onEvent: (event: TranscodeSpeedEvent) => void }[],
);
const speedWatcherCalls = vi.hoisted(() => ({ current: [] as string[] }));
// Set to hold a watcher's start until the test resolves it
const speedWatcherStart = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
}));

vi.mock('./TranscodeSpeedWatcher.js', () => ({
  TranscodeSpeedWatcher: class {
    constructor(
      _playlistPath: string,
      public onEvent: (event: TranscodeSpeedEvent) => void,
    ) {
      speedWatchers.push({ onEvent });
    }
    start() {
      speedWatcherCalls.current.push('watching');
      return speedWatcherStart.gate ?? Promise.resolve();
    }
    stop() {
      speedWatcherCalls.current.push('stopped watching');
    }
  },
}));

const channelUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSession(
  transcodeDirectory: string,
  overrides: Partial<HlsSessionOptions> = {},
): HlsSession {
  const channel = {
    uuid: channelUuid,
    transcodeConfig: {},
  } as ChannelOrmWithTranscodeConfig;

  const options: HlsSessionOptions = {
    streamMode: 'hls',
    initialSegmentCount: 2,
    transcodeDirectory,
    ...overrides,
  };

  return new HlsSession(
    channel,
    options,
    {} as StreamProgramCalculator,
    { ffmpegSettings: () => defaultFfmpegSettings } as unknown as ISettingsDB,
    {} as OnDemandChannelService,
    (() => ({}) as unknown as ProgramStream) as (
      ctx: PlayerContext,
      fmt: OutputFormat,
    ) => ProgramStream,
  );
}
describe('HlsSession', () => {
  describe('captionedSegment', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    const ntscFrame = 1001 / 30; // ms per frame at 29.97 fps
    // End of Caption on channel 1, with parity bits
    const EndOfCaption = [0x94, 0x2f];

    // The caption pair each video frame of a served segment carries
    function framePairs(segment: Buffer) {
      return parseTsSegment(segment).videoPes.map((pes) => {
        const sei = pes.indexOf(Buffer.from([0x06, 0x04, 17, 0xb5]));
        return [pes.readUInt8(sei + 14), pes.readUInt8(sei + 15)];
      });
    }

    async function serve(
      captions: ProgramCaptions,
      ptsOffset: number,
      segmentOptions: Parameters<typeof makeTsSegment>[0],
    ) {
      const session = makeSession(dir.name);
      await fs.mkdir(session.workingDirectory, { recursive: true });
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000001.ts'),
        makeTsSegment(segmentOptions),
      );
      (
        session as unknown as {
          addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
        }
      ).addCaptions(ptsOffset, captions);
      return session.captionedSegment('data000001.ts');
    }

    const captions = (frameRate: number): ProgramCaptions => ({
      // Starts on the program's 40th frame
      cues: [{ startMs: 40 * ntscFrame, endMs: 50 * ntscFrame, text: 'Hi' }],
      frameRate,
      durationMs: 60_000,
      language: 'eng',
    });

    test('puts the caption on its frame of the program the segment belongs to', async () => {
      const ptsOffset = 900_000;
      const served = await serve(captions(30000 / 1001), ptsOffset, {
        firstPts: ptsOffset,
        frames: 60,
      });
      if (!served) {
        throw new Error('not captioned');
      }

      const pairs = framePairs(served);
      expect(pairs).toHaveLength(60);
      expect(pairs[0]).toEqual([0x80, 0x80]);
      expect(pairs[40]).toEqual(EndOfCaption);
      expect(pairs.findIndex((p) => p[0] === 0x94 && p[1] === 0x2f)).toBe(40);
    });

    test('serves the whole notice although a first program starts late', async () => {
      const notice = noCaptionsNotice(
        {
          type: 'program',
          streamDuration: 60_000,
          programBeginMs: 0,
          duration: 60_000,
          infiniteLoop: false,
          program: { uuid: 'program-uuid', type: 'episode' },
        } as ContentBackedStreamLineupItem,
        {
          subtitles: [],
          durationMs: 60_000,
          frameRate: 30000 / 1001,
          language: 'eng',
        },
      );
      if (!notice) {
        throw new Error('no notice');
      }
      // A session's first program is laid out from PTS 0, but its first frame
      // comes two frames later (the encoder's B-frame delay)
      const served = await serve(notice, 0, {
        firstPts: 2 * 3003,
        frames: 160,
      });
      if (!served) {
        throw new Error('not captioned');
      }

      const pairs = framePairs(served).map(([a = 0, b = 0]) => [
        a & 0x7f,
        b & 0x7f,
      ]);
      const indexOf = (code: number[]) =>
        pairs.findIndex((p) => p[0] === code[0] && p[1] === code[1]);
      const shown = indexOf([0x14, 0x2f]);
      // The characters loaded before it shows (pairs that aren't control codes)
      const text = pairs
        .slice(0, shown)
        .filter((p) => (p[0] ?? 0) >= 0x20)
        .flat()
        .filter((byte) => byte >= 0x20)
        .map((byte) => String.fromCharCode(byte))
        .join('');

      // Resume Caption Loading is sent, after the frames that never come
      expect(indexOf([0x14, 0x20])).toBeGreaterThan(0);
      expect(indexOf([0x14, 0x20])).toBeLessThan(shown);
      expect(text).toBe('No captions for this program');
      // Shown 1 s and erased 5 s into the program: slots 30 and 150 at 29.97
      // fps, which are this segment's frames 28 and 148
      expect(shown).toBe(28);
      expect(indexOf([0x14, 0x2c])).toBe(148);
    });

    test('follows the program across the 33-bit timestamp wrap', async () => {
      // The program starts 30 frames before PTS wraps to 0
      const ptsOffset = 2 ** 33 - 30 * 3003;
      const served = await serve(captions(30000 / 1001), ptsOffset, {
        firstPts: ptsOffset,
        frames: 60,
      });
      if (!served) {
        throw new Error('not captioned');
      }

      expect(framePts(40, { firstPts: ptsOffset }) % 2 ** 33).toBeLessThan(
        ptsOffset,
      );
      expect(framePairs(served)[40]).toEqual(EndOfCaption);
    });

    test('sends padding only when frames are spaced unlike the schedule', async () => {
      // Captions laid out for 24 fps, frames arriving at 29.97
      const served = await serve(captions(24), 900_000, {
        firstPts: 900_000,
        frames: 60,
      });
      if (!served) {
        throw new Error('not captioned');
      }

      expect(
        framePairs(served).every((p) => p[0] === 0x80 && p[1] === 0x80),
      ).toBe(true);
    });

    test('serves nothing for a segment it cannot caption', async () => {
      const session = makeSession(dir.name);
      await fs.mkdir(session.workingDirectory, { recursive: true });
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000001.ts'),
        'not a transport stream',
      );
      (
        session as unknown as {
          addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
        }
      ).addCaptions(0, captions(30));

      expect(await session.captionedSegment('data000001.ts')).toBeUndefined();
    });
  });

  describe('segment length', () => {
    function hlsTime(overrides: Partial<HlsSessionOptions>) {
      const session = makeSession('/tmp', overrides);
      return (
        session as unknown as { getHlsOptions(): { hlsTime: number } }
      ).getHlsOptions().hlsTime;
    }

    test("uses the session's segment length in hls mode", () => {
      expect(hlsTime({ segmentSeconds: 2 })).toBe(2);
    });

    test('defaults to 4 s', () => {
      expect(hlsTime({})).toBe(4);
    });

    test('keeps 4 s in hls_direct_v2, whose copied segments follow the source keyframes', () => {
      expect(hlsTime({ streamMode: 'hls_direct_v2', segmentSeconds: 2 })).toBe(
        4,
      );
    });
  });

  describe('getMasterPlaylist', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    test('returns undefined when playlist.m3u8 does not exist', async () => {
      // Working directory will be created by initDirectories, but we skip that here.
      // The file simply won't exist.
      const session = makeSession(dir.name);
      const result = await session.getMasterPlaylist();
      expect(result.isSuccess()).toBe(true);
      expect(result.get()).toBeUndefined();
    });
  });

  describe('trimSubtitlePlaylist', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    test('returns undefined when subs.m3u8 does not exist', async () => {
      const session = makeSession(dir.name);
      const result = await session.trimSubtitlePlaylist();
      expect(result.isSuccess()).toBe(true);
      expect(result.get()).toBeUndefined();
    });

    test('derives a non-zero media sequence from segment file numbers on disk', async () => {
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });

      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
      ];
      for (let i = 20; i < 25; i++) {
        lines.push('#EXTINF:4.000000,', `sub${String(i).padStart(6, '0')}.vtt`);
      }
      await fs.writeFile(path.join(workingDir, 'subs.m3u8'), lines.join('\n'));

      const result = await session.trimSubtitlePlaylist();
      expect(result.isSuccess()).toBe(true);
      const trimResult = result.get();
      expect(trimResult).toBeDefined();
      expect(trimResult!.sequence).toBe(20);
      expect(trimResult!.playlist).toContain('#EXT-X-MEDIA-SEQUENCE:20');
    });

    test('a client that has only ever requested an old video segment does not drag down the subtitle floor', async () => {
      // Regression test for the "media sequence changed unexpectedly: 24 ->
      // 13" bug: before BaseHlsSession tracked video/subtitle segment
      // numbers independently, the default trim floor
      // (`minSegmentRequested`) was a single per-IP value shared across
      // both numbering spaces. A client that connected but has so far only
      // fetched an old, low-numbered video segment would report that low
      // number as its "last requested segment" — which then incorrectly
      // became part of the *subtitle* trim's floor too, even though it has
      // nothing to do with subtitle segment numbers, dragging the reported
      // sequence back down on the next poll.
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });

      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
      ];
      for (let i = 0; i < 60; i++) {
        lines.push('#EXTINF:4.000000,', `sub${String(i).padStart(6, '0')}.vtt`);
      }
      await fs.writeFile(path.join(workingDir, 'subs.m3u8'), lines.join('\n'));

      // Client A has been following subtitles and is caught up.
      session.onSegmentRequested('192.168.1.1', 'sub000050.vtt');
      // Client B is lagging behind on video and hasn't touched subtitles.
      session.onSegmentRequested('192.168.1.2', 'data000015.ts');

      const result = await session.trimSubtitlePlaylist();
      expect(result.isSuccess()).toBe(true);
      const trimResult = result.get();
      expect(trimResult).toBeDefined();
      // Floor should come from client A's subtitle position (50), not
      // client B's unrelated low video number (15).
      expect(trimResult!.sequence).toBe(40);
    });
  });

  describe('trimPlaylist', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    test('never lists a segment below the pruning floor', async () => {
      const session = makeSession(dir.name);

      // startInternal() sets the playlist start that trimPlaylist() needs.
      // The mocked transcode loop bails on its first call.
      await (
        session as unknown as { startInternal(): Promise<void> }
      ).startInternal();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });

      // ffmpeg writes three lines per segment. A two-line fixture parses to
      // zero segments.
      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
      ];
      for (let i = 0; i < 60; i++) {
        const name = `data${String(i).padStart(6, '0')}.ts`;
        lines.push(
          '#EXTINF:4.000000,',
          '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00.000+0000',
          name,
        );
        await fs.writeFile(path.join(workingDir, name), '');
      }
      await fs.writeFile(
        path.join(workingDir, 'stream.m3u8'),
        lines.join('\n'),
      );

      session.onSegmentRequested('10.0.0.1', 'data000050.ts');
      expect((await session.trimPlaylist()).get()?.sequence).toBe(40);

      // Let the prune finish removing everything below 40.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const onDisk = (await fs.readdir(workingDir))
        .filter((f) => f.startsWith('data'))
        .sort();
      expect(onDisk[0]).toBe('data000040.ts');

      // The client rewinds into the range pruning just deleted.
      session.onSegmentRequested('10.0.0.1', 'data000020.ts');
      const playlist = (await session.trimPlaylist()).get()?.playlist ?? '';
      const listed = [...playlist.matchAll(/data\d{6}\.ts/g)]
        .map((m) => m[0])
        .sort();
      expect(listed.length).toBeGreaterThan(0);
      expect(listed[0]).toBe('data000040.ts');
      for (const file of listed) {
        expect(onDisk).toContain(file);
      }
    });
  });

  describe('start with a subtitle rendition', () => {
    let dir: tmp.DirResult;
    let session: HlsSession | undefined;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(async () => {
      await session?.stop();
      session = undefined;
      dir.removeCallback();
    });

    const subtitle: SubtitleRenditionInfo = {
      language: 'eng',
      default: false,
      forced: false,
    };

    // An hls_direct_v2 session whose program's ffmpeg has written its video
    // segments but, as before a program's first line of dialogue, no
    // subs.m3u8
    function makeStartableSession(
      programSubtitle: SubtitleRenditionInfo | undefined,
    ) {
      let exit = () => {};
      const exited = new Promise<void>((resolve) => {
        exit = resolve;
      });
      const transcodeSession = {
        streamDuration: dayjs.duration({ minutes: 30 }),
        exited,
        wait: () => exited,
        kill: () => exit(),
      };
      const created = new HlsSession(
        {
          uuid: channelUuid,
          transcodeConfig: {},
        } as ChannelOrmWithTranscodeConfig,
        {
          streamMode: 'hls_direct_v2',
          initialSegmentCount: 2,
          transcodeDirectory: dir.name,
        },
        {
          getCurrentLineupItem: () =>
            Promise.resolve(
              Result.success({
                lineupItem: {},
                channelContext: {},
                sourceChannel: {},
              }),
            ),
        } as unknown as StreamProgramCalculator,
        {
          ffmpegSettings: () => defaultFfmpegSettings,
        } as unknown as ISettingsDB,
        {
          getLiveTimestamp: (_channelId: string, requestTime: number) =>
            Promise.resolve(requestTime),
        } as unknown as OnDemandChannelService,
        () =>
          ({
            on: vi.fn(),
            setup: () => Promise.resolve(Result.success(transcodeSession)),
            renditions: { audio: [], subtitle: programSubtitle },
            transcodeSession,
            start: async () => {
              const workingDir = created.workingDirectory;
              await fs.writeFile(
                path.join(workingDir, 'stream.m3u8'),
                '#EXTM3U\n',
              );
              await fs.writeFile(path.join(workingDir, 'data000000.ts'), '');
              await fs.writeFile(path.join(workingDir, 'data000001.ts'), '');
            },
          }) as unknown as ProgramStream,
      );
      session = created;
      return created;
    }

    // Without a subtitle playlist, start() gives up after 15 one-second
    // retries, so the timeout leaves room for that failure to show
    test(
      'is ready once its video is, before ffmpeg writes a subtitle segment',
      { timeout: 20_000 },
      async () => {
        const started = makeStartableSession(subtitle);

        await started.start();

        expect(started.hasError).toBe(false);
        expect(started.started).toBe(true);
        // Clients get a valid live playlist with no cues yet
        const result = await started.trimSubtitlePlaylist();
        expect(result.isSuccess()).toBe(true);
        const playlist = result.get()?.playlist;
        expect(playlist).toContain('#EXTM3U');
        expect(playlist).not.toContain('#EXTINF');
        expect(playlist).not.toContain('#EXT-X-ENDLIST');
      },
    );

    test('keeps a subtitle playlist an earlier program left', async () => {
      const started = makeStartableSession(subtitle);
      const existing = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:4.000000,',
        'sub000007.vtt',
      ].join('\n');
      await fs.mkdir(started.workingDirectory, { recursive: true });
      await fs.writeFile(
        path.join(started.workingDirectory, 'subs.m3u8'),
        existing,
      );

      await started.start();

      expect(started.started).toBe(true);
      expect(
        await fs.readFile(
          path.join(started.workingDirectory, 'subs.m3u8'),
          'utf-8',
        ),
      ).toBe(existing);
    });

    test('writes no subtitle playlist for a program without subtitles', async () => {
      const started = makeStartableSession(undefined);

      await started.start();

      expect(started.started).toBe(true);
      expect(await fs.readdir(started.workingDirectory)).not.toContain(
        'subs.m3u8',
      );
    });
  });

  describe('getLastSubtitleSegmentNumber (private)', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    test('returns 0 when no .vtt segments exist', async () => {
      const session = makeSession(dir.name);
      await fs.mkdir(session.workingDirectory, { recursive: true });

      const result = await (
        session as unknown as {
          getLastSubtitleSegmentNumber(): Promise<number>;
        }
      ).getLastSubtitleSegmentNumber();

      expect(result).toBe(0);
    });

    test('returns one past the highest existing .vtt segment number', async () => {
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      for (const n of [0, 1, 2, 3, 4]) {
        await fs.writeFile(
          path.join(workingDir, `sub${String(n).padStart(6, '0')}.vtt`),
          'WEBVTT\n',
        );
      }

      const result = await (
        session as unknown as {
          getLastSubtitleSegmentNumber(): Promise<number>;
        }
      ).getLastSubtitleSegmentNumber();

      expect(result).toBe(5);
    });
  });

  describe('deleteOldSegmentFiles (private)', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
    });

    afterEach(() => {
      dir.removeCallback();
    });

    async function callDeleteOldSegmentFiles(
      session: HlsSession,
      sequenceNum: number,
      extensions: string[],
    ) {
      return (
        session as unknown as {
          deleteOldSegmentFiles(
            sequenceNum: number,
            extensions: string[],
          ): Promise<void>;
        }
      ).deleteOldSegmentFiles(sequenceNum, extensions);
    }

    test('deletes .ts/.mp4 segments below the sequence number (regression)', async () => {
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      for (const n of [0, 1, 2, 3, 4]) {
        await fs.writeFile(
          path.join(workingDir, `data${String(n).padStart(6, '0')}.ts`),
          '',
        );
      }

      await callDeleteOldSegmentFiles(session, 3, ['.ts', '.mp4']);

      const remaining = await fs.readdir(workingDir);
      expect(remaining.sort()).toEqual(['data000003.ts', 'data000004.ts']);
    });

    test('deletes .vtt segments below the sequence number', async () => {
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      for (const n of [0, 1, 2, 3, 4]) {
        await fs.writeFile(
          path.join(workingDir, `sub${String(n).padStart(6, '0')}.vtt`),
          'WEBVTT\n',
        );
      }

      await callDeleteOldSegmentFiles(session, 3, ['.vtt']);

      const remaining = await fs.readdir(workingDir);
      expect(remaining.sort()).toEqual(['sub000003.vtt', 'sub000004.vtt']);
    });

    test('extensions filter is respected — .vtt deletion leaves .ts files untouched', async () => {
      const session = makeSession(dir.name);
      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      await fs.writeFile(path.join(workingDir, 'data000000.ts'), '');
      await fs.writeFile(path.join(workingDir, 'sub000000.vtt'), 'WEBVTT\n');

      await callDeleteOldSegmentFiles(session, 5, ['.vtt']);

      const remaining = await fs.readdir(workingDir);
      expect(remaining.sort()).toEqual(['data000000.ts']);
    });
  });

  describe('transcode speed', () => {
    let dir: tmp.DirResult;

    beforeEach(() => {
      dir = tmp.dirSync({ unsafeCleanup: true });
      speedWatchers.length = 0;
      speedWatcherCalls.current = [];
      speedWatcherStart.gate = undefined;
    });

    afterEach(() => {
      dir.removeCallback();
    });

    // Runs one program's transcode against a fake ffmpeg that exits when
    // `exit` is called. Waits until ffmpeg has started, or with
    // `untilWatching` only until the speed watcher is starting.
    async function startTranscode(
      streamMode: HlsSessionOptions['streamMode'],
      { untilWatching = false } = {},
    ) {
      const calls = speedWatcherCalls.current;
      const exited = Promise.withResolvers<void>();
      const lineupItem = {
        type: 'program',
        program: { title: 'Pilot', showTitle: 'The Show' },
        duration: 60_000,
        streamDuration: 60_000,
        programBeginMs: 0,
        infiniteLoop: false,
      };
      const channel = {
        uuid: channelUuid,
        number: 7,
        name: 'Sitcoms',
        transcodeConfig: { name: 'Default', threadCount: 4 },
      } as unknown as ChannelOrmWithTranscodeConfig;
      const transcodeSession = {
        streamDuration: dayjs.duration(60, 'seconds'),
        wait: async () => {
          await exited.promise;
          calls.push('ffmpeg exited');
        },
      };

      const session = new HlsSession(
        channel,
        { streamMode, initialSegmentCount: 2, transcodeDirectory: dir.name },
        {
          getCurrentLineupItem: async () =>
            Result.success({
              lineupItem,
              channelContext: channel,
              sourceChannel: channel,
            }),
        } as unknown as StreamProgramCalculator,
        {
          ffmpegSettings: () => defaultFfmpegSettings,
        } as unknown as ISettingsDB,
        {
          getLiveTimestamp: async () => Date.now(),
        } as unknown as OnDemandChannelService,
        ((context: PlayerContext) =>
          ({
            context,
            on: vi.fn(),
            renditions: undefined,
            transcodeSession,
            setup: async () => Result.success(transcodeSession),
            start: async () => {
              calls.push('ffmpeg started');
            },
          }) as unknown as ProgramStream) as (
          ctx: PlayerContext,
          fmt: OutputFormat,
        ) => ProgramStream,
      );
      await fs.mkdir(session.workingDirectory, { recursive: true });
      const internals = session as unknown as {
        state: string;
        transcode(realtime: boolean): Promise<void>;
        logger: { warn: Mock; info: Mock; error: Mock };
      };
      internals.state = 'started';
      const done = internals.transcode(true);
      await vi.waitFor(() =>
        expect(calls).toContain(untilWatching ? 'watching' : 'ffmpeg started'),
      );

      return {
        calls,
        internals,
        done,
        logger: internals.logger,
        exit: async () => {
          exited.resolve();
          await done;
        },
      };
    }

    test('watches the speed while ffmpeg runs', async () => {
      const { calls, exit } = await startTranscode('hls');
      await exit();

      expect(speedWatchers).toHaveLength(1);
      expect(calls).toEqual([
        'watching',
        'ffmpeg started',
        'ffmpeg exited',
        'stopped watching',
      ]);
    });

    test('warns about a slow transcode, naming the channel, program and thread count', async () => {
      const { logger, exit } = await startTranscode('hls');
      speedWatchers[0]?.onEvent({ type: 'behind', speed: 0.95 });
      speedWatchers[0]?.onEvent({ type: 'recovered', speed: 1 });
      await exit();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [warning] = logger.warn.mock.calls[0] ?? [];
      expect(warning).toContain('Channel 7 (Sitcoms)');
      expect(warning).toContain('"The Show - Pilot"');
      expect(warning).toContain('0.95x');
      expect(warning).toContain('thread count 4');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('at real time again'),
      );
    });

    // A stop while the watcher reads the playlist must not start ffmpeg on a
    // transcode session the stop has already killed
    test('a stop while the watcher starts leaves ffmpeg unstarted', async () => {
      const opened = Promise.withResolvers<void>();
      speedWatcherStart.gate = opened.promise;
      const { calls, internals, done, logger } = await startTranscode('hls', {
        untilWatching: true,
      });

      internals.state = 'stopping';
      opened.resolve();
      await done;

      expect(calls).toEqual(['watching', 'stopped watching']);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('does not watch hls_direct_v2, which copies the video', async () => {
      const { exit } = await startTranscode('hls_direct_v2');
      await exit();

      expect(speedWatchers).toHaveLength(0);
    });
  });
});
