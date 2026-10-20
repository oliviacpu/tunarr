import type { Logger } from '../../util/logging/LoggerFactory.ts';
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
import { sumBy } from 'lodash-es';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tmp from 'tmp';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  framePts,
  makeTsSegment,
  parseTsSegment,
} from '../../testing/captions/MpegTsSegmentFixture.ts';
import { FfmpegHlsPlaylist } from '../../testing/hls/FfmpegHlsPlaylist.ts';
import { ReferenceHlsPlaylistTrim } from '../../testing/hls/ReferenceHlsPlaylistTrim.ts';
import type { ContentBackedStreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import type { ProgramCaptions } from '../captions/ProgramCaptions.ts';
import { noCaptionsNotice } from '../captions/ProgramCaptions.ts';
import { ProgramStream } from '../ProgramStream.ts';
import type { HlsSessionOptions } from './HlsSession.js';
import { HlsSession, SessionStartPts } from './HlsSession.js';
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

// The last packet ffprobe finds in the newest segment, from which the session
// works out where the next program starts on the output clock
const lastPacket = vi.hoisted(() => ({
  current: undefined as { pts: number; duration: number } | undefined,
}));

vi.mock('@/ffmpeg/GetLastPtsDuration.js', () => ({
  GetLastPtsDurationTask: class {
    run() {
      const packet = lastPacket.current;
      return Promise.resolve(
        packet ? Result.success(packet) : Result.forError(new Error('none')),
      );
    }
  },
}));

const channelUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeSession(
  transcodeDirectory: string,
  overrides: Partial<HlsSessionOptions> = {},
  ffmpegSettings: typeof defaultFfmpegSettings = defaultFfmpegSettings,
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
    { ffmpegSettings: () => ffmpegSettings } as unknown as ISettingsDB,
    {} as OnDemandChannelService,
    (() => ({}) as unknown as ProgramStream) as (
      ctx: PlayerContext,
      fmt: OutputFormat,
    ) => ProgramStream,
  );
}

// A served media playlist as a player reads it: each segment's number, its
// discontinuity number (the DISCONTINUITY-SEQUENCE plus the tags before it),
// its program date-time and its length
function parseServedPlaylist(playlist: string) {
  let mediaSequence: number | undefined;
  let discontinuitySequence = 0;
  let tags = 0;
  let startMs = NaN;
  let seconds = NaN;
  const segments: {
    number: number;
    discontinuity: number;
    startMs: number;
    seconds: number;
  }[] = [];
  for (const line of playlist.split('\n')) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
    } else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) {
      discontinuitySequence = parseInt(
        line.slice('#EXT-X-DISCONTINUITY-SEQUENCE:'.length),
      );
    } else if (line === '#EXT-X-DISCONTINUITY') {
      tags++;
    } else if (line.startsWith('#EXTINF:')) {
      seconds = parseFloat(line.slice('#EXTINF:'.length));
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      startMs = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
    } else {
      const number = line.match(/data(\d+)\.ts$/)?.[1];
      if (number !== undefined) {
        segments.push({
          number: parseInt(number),
          discontinuity: discontinuitySequence + tags,
          startMs,
          seconds,
        });
      }
    }
  }
  return { mediaSequence, discontinuitySequence, segments };
}

// The caption pair each video frame of a served segment carries
function framePairs(segment: Buffer) {
  return parseTsSegment(segment).videoPes.map((pes) => {
    const sei = pes.indexOf(Buffer.from([0x06, 0x04, 17, 0xb5]));
    return [pes.readUInt8(sei + 14), pes.readUInt8(sei + 15)];
  });
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
    // Erase Displayed Memory on channel 1, with parity bits
    const EraseDisplayed = [0x94, 0x2c];

    async function serve(
      captions: ProgramCaptions,
      ptsOffset: number,
      segmentOptions: Parameters<typeof makeTsSegment>[0],
      ffmpegSettings = defaultFfmpegSettings,
    ) {
      const session = makeSession(dir.name, {}, ffmpegSettings);
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

    // Read for each program, so a change applies from the next one
    test('lays the captions out in the appearance the settings have', async () => {
      const ptsOffset = 900_000;
      const served = await serve(
        captions(30000 / 1001),
        ptsOffset,
        { firstPts: ptsOffset, frames: 60 },
        {
          ...defaultFfmpegSettings,
          hdhrCaptionAppearance: {
            ...defaultFfmpegSettings.hdhrCaptionAppearance,
            textColor: 'red',
          },
        },
      );
      if (!served) {
        throw new Error('not captioned');
      }

      // Red's mid-row code, 0x11 0x28, with parity
      expect(framePairs(served)).toContainEqual([0x91, 0xa8]);
    });

    // A channel's own look (Channel.captions), resolved when its program
    // started, wins over the global settings
    test('lays the captions out in the look their channel has', async () => {
      const ptsOffset = 900_000;
      const served = await serve(
        {
          ...captions(30000 / 1001),
          appearance: {
            ...defaultFfmpegSettings.hdhrCaptionAppearance,
            alignment: 'centeredBlock',
            textColor: 'red',
          },
        },
        ptsOffset,
        { firstPts: ptsOffset, frames: 60 },
        // The global look stays white
        defaultFfmpegSettings,
      );
      if (!served) {
        throw new Error('not captioned');
      }

      // Red's mid-row code, 0x11 0x28, with parity
      expect(framePairs(served)).toContainEqual([0x91, 0xa8]);
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
      // Its first frame comes two frames after the offset, as a session's first
      // program's did when it started at 0 (the encoder's B-frame delay)
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

    test('sends every pair, in order, when a frame is missing', async () => {
      const ptsOffset = 900_000;
      const whole = await serve(captions(30000 / 1001), ptsOffset, {
        firstPts: ptsOffset,
        frames: 60,
      });
      if (!whole) {
        throw new Error('not captioned');
      }
      const notPadding = (p: number[]) => !(p[0] === 0x80 && p[1] === 0x80);
      const expected = framePairs(whole).filter(notPadding);
      // Without the first frame that carries something
      const missing = framePairs(whole).findIndex(notPadding);
      expect(missing).toBeGreaterThan(0);

      const gapped = await serve(captions(30000 / 1001), ptsOffset, {
        pts: Array.from({ length: 60 }, (_, k) =>
          framePts(k, { firstPts: ptsOffset }),
        ).filter((_, k) => k !== missing),
      });
      if (!gapped) {
        throw new Error('not captioned');
      }

      expect(framePairs(gapped).filter(notPadding)).toEqual(expected);
    });

    test('captions a segment asked for again the same way', async () => {
      const ptsOffset = 900_000;
      const session = makeSession(dir.name);
      await fs.mkdir(session.workingDirectory, { recursive: true });
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000001.ts'),
        makeTsSegment({ firstPts: ptsOffset, frames: 60 }),
      );
      (
        session as unknown as {
          addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
        }
      ).addCaptions(ptsOffset, captions(30000 / 1001));

      // Two viewers, or a retry
      const first = await session.captionedSegment('data000001.ts');
      const second = await session.captionedSegment('data000001.ts');
      expect(first).toBeDefined();
      expect(second).toEqual(first);
    });

    test('captions segments the same whichever is asked for first', async () => {
      const ptsOffset = 900_000;
      // A cue loading across the two segments' join, and the first segment's
      // last frame missing
      const across: ProgramCaptions = {
        cues: [{ startMs: 62 * ntscFrame, endMs: 90 * ntscFrame, text: 'Hi' }],
        frameRate: 30000 / 1001,
        durationMs: 60_000,
        language: 'eng',
      };
      async function captionBoth(order: string[]) {
        const session = makeSession(dir.name);
        await fs.mkdir(session.workingDirectory, { recursive: true });
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: ptsOffset, frames: 59 }),
        );
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000002.ts'),
          makeTsSegment({ firstPts: ptsOffset + 60 * 3003, frames: 60 }),
        );
        (
          session as unknown as {
            addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
          }
        ).addCaptions(ptsOffset, across);
        const served = new Map<string, Buffer | undefined>();
        for (const file of order) {
          served.set(file, await session.captionedSegment(file));
        }
        return served;
      }

      const inOrder = await captionBoth(['data000001.ts', 'data000002.ts']);
      const reversed = await captionBoth(['data000002.ts', 'data000001.ts']);
      expect(inOrder.get('data000001.ts')).toBeDefined();
      expect(reversed.get('data000001.ts')).toEqual(
        inOrder.get('data000001.ts'),
      );
      expect(reversed.get('data000002.ts')).toEqual(
        inOrder.get('data000002.ts'),
      );
    });

    test('serves nothing for a segment it cannot caption', async () => {
      const session = makeSession(dir.name);
      const warn = vi.fn();
      const log = { warn, debug: vi.fn() } as unknown as Logger;
      (session as unknown as { logger: Logger }).logger = log;
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
      expect(await session.captionedSegment('data000001.ts')).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    });

    test('warns once for refusals whose reasons differ only in detail', async () => {
      const session = makeSession(dir.name);
      const warn = vi.fn();
      const log = { warn, debug: vi.fn() } as unknown as Logger;
      (session as unknown as { logger: Logger }).logger = log;
      await fs.mkdir(session.workingDirectory, { recursive: true });
      // Whole TS packets that lose sync at different bytes
      const losingSyncAt = (packet: number) => {
        const data = Buffer.alloc(188 * 4);
        for (let i = 0; i < packet; i++) {
          data[i * 188] = 0x47;
        }
        return data;
      };
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000001.ts'),
        losingSyncAt(1),
      );
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000002.ts'),
        losingSyncAt(2),
      );
      (
        session as unknown as {
          addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
        }
      ).addCaptions(0, captions(30));

      expect(await session.captionedSegment('data000001.ts')).toBeUndefined();
      expect(await session.captionedSegment('data000002.ts')).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        'Serving segment %s without captions: %s',
        'data000001.ts',
        'lost TS sync at byte 188',
      );
    });

    describe('across programs', () => {
      const isPadding = (p: number[]) => p[0] === 0x80 && p[1] === 0x80;

      // The language each of a served segment's PMT descriptors names: the
      // ISO 639 language descriptor's and the caption service descriptor's
      function pmtLanguages(segment: Buffer) {
        const pmt = parseTsSegment(segment).pmtPacket?.toString('latin1');
        if (pmt === undefined) {
          throw new Error('no PMT');
        }
        return {
          iso639: pmt.match(/\x0a\x04([a-z]{3})\x00/)?.[1],
          captionService: pmt.match(/\x86\x07\xe1([a-z]{3})/)?.[1],
        };
      }

      // Plays programs back to back through the session's own loop, each
      // against a fake ffmpeg that exits at once. A program is planned for
      // `plannedMs` (60 s unless given) and its video ends at `endPts`, where
      // the session starts the next one; without it, the last segment can't
      // be read and the next one starts again at SessionStartPts. Its caption
      // window is its captions' durationMs.
      async function playPrograms(
        programs: {
          captions?: ProgramCaptions;
          endPts?: number;
          plannedMs?: number;
        }[],
      ) {
        const queue = [...programs];
        const channel = {
          uuid: channelUuid,
          transcodeConfig: {},
        } as unknown as ChannelOrmWithTranscodeConfig;
        const session: HlsSession = new HlsSession(
          channel,
          {
            streamMode: 'hls',
            initialSegmentCount: 2,
            transcodeDirectory: dir.name,
          },
          {
            getCurrentLineupItem: () =>
              Promise.resolve(
                Result.success({
                  lineupItem: { type: 'program', duration: 60_000 },
                  channelContext: channel,
                  sourceChannel: channel,
                }),
              ),
          } as unknown as StreamProgramCalculator,
          {
            ffmpegSettings: () => defaultFfmpegSettings,
          } as unknown as ISettingsDB,
          {
            getLiveTimestamp: () => Promise.resolve(Date.now()),
          } as unknown as OnDemandChannelService,
          (context) => {
            const program = queue.shift();
            const transcodeSession = {
              streamDuration: dayjs.duration(program?.plannedMs ?? 60_000),
              wait: () => Promise.resolve(),
            };
            return {
              context,
              on: vi.fn(),
              renditions: { audio: [], captions: program?.captions },
              transcodeSession,
              setup: () => Promise.resolve(Result.success(transcodeSession)),
              start: async () => {
                await fs.writeFile(
                  path.join(session.workingDirectory, 'data000000.ts'),
                  '',
                );
                lastPacket.current =
                  program?.endPts === undefined
                    ? undefined
                    : { pts: program.endPts - 3003 - 1, duration: 3003 };
                // Nothing buffered, so the loop starts the next at once
                internals.transcodedUntil = undefined;
                if (queue.length === 0) {
                  internals.state = 'stopped';
                }
              },
            } as unknown as ProgramStream;
          },
        );
        await fs.mkdir(session.workingDirectory, { recursive: true });
        const internals = session as unknown as {
          state: string;
          transcodedUntil: unknown;
          run(): Promise<void>;
        };
        internals.state = 'started';
        await internals.run();
        return session;
      }

      afterEach(() => {
        lastPacket.current = undefined;
      });

      // ffmpeg stopped early (a crash, or a file shorter than its recorded
      // duration), and the next item has no captions of its own: a gap, an
      // error screen, a commercial without subtitles
      test("ends a program's captions where the next item starts", async () => {
        const aStart = SessionStartPts;
        // 10 s into a program planned for 60 s
        const bStart = aStart + 300 * 3003;
        // A line every 2 s for the program's first 30 s
        const dialogue: ProgramCaptions = {
          cues: Array.from({ length: 15 }, (_, k) => ({
            startMs: k * 2000 + 500,
            endMs: k * 2000 + 1500,
            text: `Line ${k}`,
          })),
          frameRate: 30000 / 1001,
          durationMs: 60_000,
          language: 'eng',
        };

        const session = await playPrograms([
          { captions: dialogue, endPts: bStart },
          {},
        ]);
        // 4 s into the first program; the next item's first 2 s; and 12 s
        // after the first program started, 2 s into the next item
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: aStart + 120 * 3003, frames: 60 }),
        );
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000002.ts'),
          makeTsSegment({ firstPts: bStart, frames: 60 }),
        );
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000003.ts'),
          makeTsSegment({ firstPts: aStart + 360 * 3003, frames: 60 }),
        );
        const own = await session.captionedSegment('data000001.ts');
        const start = await session.captionedSegment('data000002.ts');
        const later = await session.captionedSegment('data000003.ts');
        if (!own || !start || !later) {
          throw new Error('not captioned');
        }

        // The first program still has its own captions
        expect(framePairs(own).some((p) => !isPadding(p))).toBe(true);
        // The next item's first two frames erase what was left on screen,
        // and nothing else of the first program's comes
        expect(framePairs(start).slice(0, 2)).toEqual([
          EraseDisplayed,
          EraseDisplayed,
        ]);
        expect(framePairs(start).slice(2).every(isPadding)).toBe(true);
        expect(framePairs(later)).toHaveLength(60);
        expect(framePairs(later).every(isPadding)).toBe(true);
      });

      // ffprobe couldn't read the last segment (ffmpeg crashed, leaving it
      // empty), so the clock goes back to SessionStartPts, under programs
      // that already played
      test('sends no earlier program its captions when the clock goes back', async () => {
        const aStart = SessionStartPts;
        const bStart = aStart + 600 * 3003;
        const dialogue = (language: string): ProgramCaptions => ({
          cues: Array.from({ length: 30 }, (_, k) => ({
            startMs: k * 2000 + 500,
            endMs: k * 2000 + 1500,
            text: `Line ${k}`,
          })),
          frameRate: 30000 / 1001,
          durationMs: 60_000,
          language,
        });

        const session = await playPrograms([
          { captions: dialogue('eng'), endPts: bStart },
          { captions: dialogue('eng') },
          {},
        ]);
        // 22 s after the clock went back: 2 s into the second program's
        // window
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: bStart + 60 * 3003, frames: 60 }),
        );
        const served = await session.captionedSegment('data000001.ts');
        if (!served) {
          throw new Error('not captioned');
        }

        expect(framePairs(served).every(isPadding)).toBe(true);
      });

      // Viewers are served segments up to a minute or more behind the
      // transcode, so a program the next one won't reach keeps its captions
      test('keeps the captions of a program the clock went back short of', async () => {
        const aStart = SessionStartPts;
        const bStart = aStart + 600 * 3003;
        const dialogue: ProgramCaptions = {
          cues: Array.from({ length: 30 }, (_, k) => ({
            startMs: k * 2000 + 500,
            endMs: k * 2000 + 1500,
            text: `Line ${k}`,
          })),
          frameRate: 30000 / 1001,
          durationMs: 60_000,
          language: 'eng',
        };

        const session = await playPrograms([
          { captions: dialogue, endPts: bStart },
          { captions: dialogue },
          // Planned for 10 s from SessionStartPts, short of the second
          { plannedMs: 10_000 },
        ]);
        // 2 s into the second program
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: bStart + 60 * 3003, frames: 60 }),
        );
        const served = await session.captionedSegment('data000001.ts');
        if (!served) {
          throw new Error('not captioned');
        }

        expect(framePairs(served).some((p) => !isPadding(p))).toBe(true);
      });

      // Each of a run of programs whose ffmpeg fails at once is cut to
      // nothing by the next
      test('keeps the captions of a program whose segments are still served', async () => {
        const aStart = SessionStartPts;
        const bStart = aStart + 300 * 3003;
        const failing = Array.from({ length: 10 }, () => ({
          captions: captions(30000 / 1001),
          endPts: bStart,
        }));

        const session = await playPrograms([
          { captions: captions(30000 / 1001), endPts: bStart },
          ...failing,
        ]);
        // The first program's frames with its caption, at frame 40
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: aStart, frames: 60 }),
        );
        const served = await session.captionedSegment('data000001.ts');
        if (!served) {
          throw new Error('not captioned');
        }

        expect(framePairs(served)[40]).toEqual(EndOfCaption);
      });

      // A client still fetching one program's last segments after the next
      // program started
      test('names each segment in its own program’s language', async () => {
        const aStart = SessionStartPts;
        // Its video ends 10 s into its 60 s of captions
        const bStart = aStart + 300 * 3003;
        const session = await playPrograms([
          {
            captions: { ...captions(30000 / 1001), language: 'jpn' },
            endPts: bStart,
          },
          { captions: { ...captions(30000 / 1001), language: 'eng' } },
        ]);
        // The first program's last 2 s, and the next one's first
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: bStart - 60 * 3003, frames: 60 }),
        );
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000002.ts'),
          makeTsSegment({ firstPts: bStart, frames: 60 }),
        );

        const trailing = await session.captionedSegment('data000001.ts');
        const next = await session.captionedSegment('data000002.ts');
        if (!trailing || !next) {
          throw new Error('not captioned');
        }

        expect(pmtLanguages(trailing)).toEqual({
          iso639: 'jpn',
          captionService: 'jpn',
        });
        expect(pmtLanguages(next)).toEqual({
          iso639: 'eng',
          captionService: 'eng',
        });
      });

      test('names a segment no program captions in the preferred language', async () => {
        const session = makeSession(
          dir.name,
          {},
          {
            ...defaultFfmpegSettings,
            languagePreferences: {
              preferences: [
                { iso6391: 'fr', iso6392: 'fre', displayName: 'French' },
              ],
            },
          },
        );
        await fs.mkdir(session.workingDirectory, { recursive: true });
        (
          session as unknown as {
            addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
          }
        ).addCaptions(900_000, { ...captions(30000 / 1001), language: 'jpn' });
        // After the program's 60 s
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          makeTsSegment({ firstPts: 900_000 + 60_000 * 90, frames: 60 }),
        );

        const served = await session.captionedSegment('data000001.ts');
        if (!served) {
          throw new Error('not captioned');
        }

        expect(pmtLanguages(served)).toEqual({
          iso639: 'fre',
          captionService: 'fre',
        });
      });
    });

    // Numbers from a deployment's log, to decide whether caching captioned
    // segments or deferring the schedule build is worth it
    describe('timing', () => {
      type Internals = {
        state: string;
        addCaptions(ptsOffset: number, captions: ProgramCaptions): void;
        logger: { debug: Mock; info: Mock };
      };

      // A session with one program's captions and `count` 60-frame segments
      async function sessionWithSegments(count: number) {
        const ptsOffset = 900_000;
        const session = makeSession(dir.name);
        await fs.mkdir(session.workingDirectory, { recursive: true });
        for (let k = 0; k < count; k++) {
          await fs.writeFile(
            path.join(session.workingDirectory, `data00000${k + 1}.ts`),
            makeTsSegment({ firstPts: ptsOffset + k * 60 * 3003, frames: 60 }),
          );
        }
        const internals = session as unknown as Internals;
        internals.addCaptions(ptsOffset, captions(30000 / 1001));
        return { session, internals };
      }

      const linesStarting = (mock: Mock, start: string) =>
        mock.mock.calls.filter(
          ([message]) =>
            typeof message === 'string' && message.startsWith(start),
        );

      test('logs one debug line per captioned segment, with its frames and times', async () => {
        const { session, internals } = await sessionWithSegments(1);

        await session.captionedSegment('data000001.ts');

        const lines = linesStarting(
          internals.logger.debug,
          'Captioned segment',
        );
        expect(lines).toHaveLength(1);
        const [, file, bytes, frames, readMs, rewriteMs] = lines[0] ?? [];
        expect(file).toBe('data000001.ts');
        expect(bytes).toBeGreaterThan(0);
        expect(frames).toBe(60);
        expect(Number(readMs)).toBeGreaterThanOrEqual(0);
        expect(Number(rewriteMs)).toBeGreaterThanOrEqual(0);
      });

      test("logs how long laying out a program's captions took", async () => {
        const { internals } = await sessionWithSegments(0);

        const lines = linesStarting(internals.logger.debug, 'Laid out');
        expect(lines).toHaveLength(1);
        const [, cues, startPts, seconds, scheduleMs] = lines[0] ?? [];
        expect(cues).toBe(1);
        expect(startPts).toBe(900_000);
        expect(seconds).toBe(60);
        expect(Number(scheduleMs)).toBeGreaterThanOrEqual(0);
      });

      test('sums up the captioned segments when the session ends', async () => {
        const { session, internals } = await sessionWithSegments(2);
        await session.captionedSegment('data000001.ts');
        await session.captionedSegment('data000002.ts');
        const rewrites = linesStarting(
          internals.logger.debug,
          'Captioned segment',
        ).map((line) => Number(line[5]));

        internals.state = 'started';
        await session.stop();

        const summaries = linesStarting(internals.logger.info, 'Captioned');
        expect(summaries).toHaveLength(1);
        const [message, count, mean, max] = summaries[0] ?? [];
        expect(message).toBe('Captioned %d segments: mean %s ms, max %s ms');
        expect(count).toBe(2);
        expect(Number(max)).toBe(Math.max(...rewrites));
        expect(Number(mean)).toBeGreaterThanOrEqual(0);
        expect(Number(mean)).toBeLessThanOrEqual(Number(max));
      });

      test('logs no summary for a session that captioned nothing', async () => {
        const { session, internals } = await sessionWithSegments(0);
        // A segment it cannot caption is served as it is, and not counted
        await fs.writeFile(
          path.join(session.workingDirectory, 'data000001.ts'),
          'not a transport stream',
        );
        expect(await session.captionedSegment('data000001.ts')).toBeUndefined();

        internals.state = 'started';
        await session.stop();

        expect(linesStarting(internals.logger.info, 'Captioned')).toEqual([]);
      });
    });
  });

  describe('output clock', () => {
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

    // Runs a session's first program, with these captions, against a fake
    // ffmpeg that exits at once. Returns the session and the PTS offset the
    // program's stream was built with.
    async function runFirstProgram(
      streamMode: HlsSessionOptions['streamMode'],
      captions?: ProgramCaptions,
    ) {
      const offsets: (number | undefined)[] = [];
      const formats: OutputFormat[] = [];
      const channel = {
        uuid: channelUuid,
        transcodeConfig: {},
      } as unknown as ChannelOrmWithTranscodeConfig;
      const transcodeSession = {
        streamDuration: dayjs.duration(60, 'seconds'),
        wait: () => Promise.resolve(),
      };
      const session = new HlsSession(
        channel,
        { streamMode, initialSegmentCount: 2, transcodeDirectory: dir.name },
        {
          getCurrentLineupItem: () =>
            Promise.resolve(
              Result.success({
                lineupItem: { type: 'program', duration: 60_000 },
                channelContext: channel,
                sourceChannel: channel,
              }),
            ),
        } as unknown as StreamProgramCalculator,
        {
          ffmpegSettings: () => defaultFfmpegSettings,
        } as unknown as ISettingsDB,
        {
          getLiveTimestamp: () => Promise.resolve(Date.now()),
        } as unknown as OnDemandChannelService,
        (context, outputFormat, opts) => {
          offsets.push(opts?.ptsOffset);
          formats.push(outputFormat);
          return {
            context,
            on: vi.fn(),
            renditions: { audio: [], captions },
            transcodeSession,
            setup: () => Promise.resolve(Result.success(transcodeSession)),
            start: () => Promise.resolve(),
          } as unknown as ProgramStream;
        },
      );
      await fs.mkdir(session.workingDirectory, { recursive: true });
      const internals = session as unknown as {
        state: string;
        transcode(realtime: boolean): Promise<void>;
      };
      internals.state = 'started';
      await internals.transcode(true);
      return { session, offsets, formats };
    }

    // At 0, the encoder's B-frame delay put the first program's video two
    // frames late, and its captions two frames early
    test("starts a session's first program at SessionStartPts", async () => {
      const { offsets } = await runFirstProgram('hls');

      expect(offsets).toEqual([SessionStartPts]);
    });

    test("lays the first program's captions out from where its video starts", async () => {
      const frameMs = 1001 / 30; // 29.97 fps
      const { session } = await runFirstProgram('hls', {
        // Starts on the program's 40th frame
        cues: [{ startMs: 40 * frameMs, endMs: 50 * frameMs, text: 'Hi' }],
        frameRate: 30000 / 1001,
        durationMs: 60_000,
        language: 'eng',
      });
      // Its video starts exactly at the offset
      await fs.writeFile(
        path.join(session.workingDirectory, 'data000000.ts'),
        makeTsSegment({ firstPts: SessionStartPts, frames: 60 }),
      );

      const served = await session.captionedSegment('data000000.ts');
      if (!served) {
        throw new Error('not captioned');
      }

      const pairs = framePairs(served);
      expect(pairs.findIndex((p) => p[0] === 0x94 && p[1] === 0x2f)).toBe(40);
    });

    test('keeps the source timestamps in hls_direct_v2', async () => {
      const { offsets } = await runFirstProgram('hls_direct_v2');

      expect(offsets).toEqual([0]);
    });

    // ffmpeg's playlist used to list every segment of the session
    test.each(['hls', 'hls_direct_v2'] as const)(
      "builds the program's ffmpeg with a 15-minute playlist (%s)",
      async (streamMode) => {
        const { formats } = await runFirstProgram(streamMode);

        expect(formats).toHaveLength(1);
        const format = formats[0];
        expect(format?.type).toBe(streamMode);
        // 4 s segments
        expect(
          format !== undefined && 'hlsOptions' in format
            ? format.hlsOptions.hlsListSize
            : undefined,
        ).toBe(225);
      },
    );
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

  describe('playlist window', () => {
    function hlsListSize(overrides: Partial<HlsSessionOptions>) {
      const session = makeSession('/tmp', overrides);
      return (
        session as unknown as { getHlsOptions(): { hlsListSize: number } }
      ).getHlsOptions().hlsListSize;
    }

    test('lists 15 minutes of segments', () => {
      expect(hlsListSize({ segmentSeconds: 2 })).toBe(450);
      expect(hlsListSize({})).toBe(225);
      expect(hlsListSize({ segmentSeconds: 1 })).toBe(900);
      expect(hlsListSize({ segmentSeconds: 3 })).toBe(300);
    });

    test('lists 15 minutes of 4 s segments in hls_direct_v2', () => {
      expect(
        hlsListSize({ streamMode: 'hls_direct_v2', segmentSeconds: 2 }),
      ).toBe(225);
    });

    // TUNARR_SESSION_STALENESS_MS can keep a session nobody reads alive for
    // longer than the window: ffmpeg would drop segments the reader never saw
    test('outlasts a longer staleness', () => {
      expect(hlsListSize({ segmentSeconds: 2, stalenessMs: 120_000 })).toBe(
        450,
      );
      expect(hlsListSize({ segmentSeconds: 2, stalenessMs: 30 * 60_000 })).toBe(
        1050,
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

      const onDisk = await vi.waitFor(
        async () => {
          const files = (await fs.readdir(workingDir))
            .filter((f) => f.startsWith('data'))
            .sort();
          expect(files[0]).toBe('data000040.ts');
          return files;
        },
        { timeout: 5_000, interval: 10 },
      );

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

    // With hls_list_size 0, ffmpeg never trims stream.m3u8, so after hours
    // of watching it lists thousands of segments. Each playlist request read
    // and parsed all of it.
    test('a request on a long session reads only what ffmpeg appended', async () => {
      const session = makeSession(dir.name, { segmentSeconds: 2 });
      await (
        session as unknown as { startInternal(): Promise<void> }
      ).startInternal();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      const playlistPath = path.join(workingDir, 'stream.m3u8');
      const header = [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-DISCONTINUITY',
      ];
      const body: string[] = [];
      const addSegments = (count: number) => {
        for (let i = 0; i < count; i++) {
          const n = body.length / 3;
          body.push(
            '#EXTINF:2.000000,',
            `#EXT-X-PROGRAM-DATE-TIME:${new Date(Date.UTC(2026, 9, 15) + n * 2000).toISOString()}`,
            `/stream/channels/${channelUuid}/hls/data${String(n).padStart(6, '0')}.ts`,
          );
        }
      };
      // Like ffmpeg: the whole file, renamed over the playlist
      const writePlaylist = async () => {
        await fs.writeFile(
          `${playlistPath}.tmp`,
          [...header, ...body].join('\n') + '\n',
        );
        await fs.rename(`${playlistPath}.tmp`, playlistPath);
      };

      // About 11 hours of 2-second segments
      addSegments(20_000);
      await writePlaylist();
      session.onSegmentRequested('10.0.0.1', 'data019990.ts');
      const first = (await session.trimPlaylist()).get();
      expect(first?.sequence).toBe(19_980);

      addSegments(2);
      await writePlaylist();
      session.onSegmentRequested('10.0.0.1', 'data019992.ts');

      const probe = await fs.open(playlistPath, 'r');
      const fileHandle = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      const readFile = vi.spyOn(fs, 'readFile');
      const read = vi.spyOn(fileHandle, 'read');
      let second;
      let bytesRead: number;
      try {
        second = (await session.trimPlaylist()).get();
        bytesRead =
          sumBy(readFile.mock.settledResults, (result) =>
            result.type === 'fulfilled' ? result.value.length : 0,
          ) +
          sumBy(read.mock.settledResults, (result) =>
            result.type === 'fulfilled' ? result.value.bytesRead : 0,
          );
      } finally {
        readFile.mockRestore();
        read.mockRestore();
      }

      const wholeFile = (await fs.stat(playlistPath)).size;
      expect(wholeFile).toBeGreaterThan(2_000_000);
      // The header, the bytes the parse continues from, and two entries
      expect(bytesRead).toBeLessThan(8 * 1024);

      // The same playlist as trimming the whole file
      const lines = (await fs.readFile(playlistPath, 'utf-8')).split('\n');
      const playlistStart = first?.playlistStart.subtract(19_980 * 2, 'second');
      expect(playlistStart).toBeDefined();
      if (playlistStart === undefined) {
        return;
      }
      const expected = new ReferenceHlsPlaylistTrim().trimPlaylist(
        playlistStart,
        {
          type: 'before_segment_number',
          segmentNumber: 19_992,
          segmentsToKeepBefore: 10,
          segmentFloor: 19_980,
        },
        lines,
        {
          maxSegmentsToKeep: 20,
          endWithDiscontinuity: false,
          targetDuration: 2,
          previousDiscontinuitySequence: first?.discontinuitySequence,
        },
      );
      expect(second?.playlist).toBe(expected.playlist);
      expect(second?.sequence).toBe(19_982);
    });

    // With a bounded hls_list_size, ffmpeg's file is a window of its newest
    // entries, rewritten after every segment: its first entry moves on every
    // time. The session's history is the reader's own.
    test('a request on a long session reads under 8 KiB of a windowed playlist', async () => {
      const session = makeSession(dir.name, { segmentSeconds: 2 });
      await (
        session as unknown as { startInternal(): Promise<void> }
      ).startInternal();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const workingDir = session.workingDirectory;
      await fs.mkdir(workingDir, { recursive: true });
      const playlistPath = path.join(workingDir, 'stream.m3u8');
      const writePlaylist = async (content: string) => {
        await fs.writeFile(`${playlistPath}.tmp`, content);
        await fs.rename(`${playlistPath}.tmp`, playlistPath);
      };
      // 15 minutes of 2-second segments
      const listSize = 450;
      const ffmpeg = new FfmpegHlsPlaylist(
        `/stream/channels/${channelUuid}/hls/`,
      );

      // About 11 hours, a program every 2,000 segments, requested often
      // enough that no segment leaves the window unread
      let previous: Awaited<ReturnType<HlsSession['trimPlaylist']>> | undefined;
      while (ffmpeg.segmentCount < 20_000) {
        if (ffmpeg.segmentCount % 2_000 === 0 && ffmpeg.segmentCount > 0) {
          ffmpeg.newProgram();
        }
        ffmpeg.segments(400);
        await writePlaylist(ffmpeg.window(listSize));
        session.onSegmentRequested(
          '10.0.0.1',
          `data${String(ffmpeg.segmentCount - 10).padStart(6, '0')}.ts`,
        );
        previous = await session.trimPlaylist();
      }
      const first = previous?.get();
      expect(first?.sequence).toBe(19_980);
      expect(first?.discontinuitySequence).toBe(9);

      ffmpeg.segments(2);
      await writePlaylist(ffmpeg.window(listSize));
      session.onSegmentRequested('10.0.0.1', 'data019992.ts');

      const probe = await fs.open(playlistPath, 'r');
      const fileHandle = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      const readFile = vi.spyOn(fs, 'readFile');
      const read = vi.spyOn(fileHandle, 'read');
      let second;
      let bytesRead: number;
      try {
        second = (await session.trimPlaylist()).get();
        bytesRead =
          sumBy(readFile.mock.settledResults, (result) =>
            result.type === 'fulfilled' ? result.value.length : 0,
          ) +
          sumBy(read.mock.settledResults, (result) =>
            result.type === 'fulfilled' ? result.value.bytesRead : 0,
          );
      } finally {
        readFile.mockRestore();
        read.mockRestore();
      }

      const windowFile = (await fs.stat(playlistPath)).size;
      expect(windowFile).toBeGreaterThan(50_000);
      expect(await fs.readFile(playlistPath, 'utf-8')).toContain(
        '#EXT-X-MEDIA-SEQUENCE:19552\n',
      );
      // The header, the end of the file, and two entries
      expect(bytesRead).toBeLessThan(8 * 1024);

      // The same playlist as trimming the whole session's playlist
      const playlistStart = first?.playlistStart.subtract(19_980 * 2, 'second');
      expect(playlistStart).toBeDefined();
      if (playlistStart === undefined) {
        return;
      }
      const expected = new ReferenceHlsPlaylistTrim().trimPlaylist(
        playlistStart,
        {
          type: 'before_segment_number',
          segmentNumber: 19_992,
          segmentsToKeepBefore: 10,
        },
        ffmpeg.whole().split('\n'),
        {
          maxSegmentsToKeep: 20,
          endWithDiscontinuity: false,
          targetDuration: 2,
          previousDiscontinuitySequence: first?.discontinuitySequence,
        },
      );
      expect(second?.playlist).toBe(expected.playlist);
      expect(second?.sequence).toBe(19_982);
      expect(second?.discontinuitySequence).toBe(9);
    });

    // What a player polling the session sees once ffmpeg keeps only the
    // session's 15-minute window: each program's ffmpeg reads the window
    // back in and continues it, the window's first entry moves on with every
    // rewrite, and program starts and their discontinuity tags leave the
    // file. The served playlists must stay continuous.
    test('keeps the media and discontinuity sequences continuous as the window slides', async () => {
      // Pruning runs every 30 s of the session's clock
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(Date.UTC(2026, 9, 19, 17));
        const session = makeSession(dir.name, { segmentSeconds: 2 });
        await (
          session as unknown as { startInternal(): Promise<void> }
        ).startInternal();
        await new Promise((resolve) => setTimeout(resolve, 20));

        const listSize = (
          session as unknown as { getHlsOptions(): { hlsListSize: number } }
        ).getHlsOptions().hlsListSize;
        const workingDir = session.workingDirectory;
        await fs.mkdir(workingDir, { recursive: true });
        const playlistPath = path.join(workingDir, 'stream.m3u8');
        const ffmpeg = new FfmpegHlsPlaylist(
          `/stream/channels/${channelUuid}/hls/`,
        );
        // Each segment's discontinuity number and start, from what ffmpeg
        // wrote, counted from the session's first segment
        const expected: { discontinuity: number; startMs: number }[] = [];
        let discontinuities = 0;
        let elapsedMs = 0;
        const addSegments = (count: number, seconds = 2) => {
          for (let i = 0; i < count; i++) {
            ffmpeg.segments(1, seconds);
            discontinuities += ffmpeg.entries.at(-1)?.tagsBefore ?? 0;
            expected.push({
              discontinuity: discontinuities,
              startMs: elapsedMs,
            });
            elapsedMs += seconds * 1000;
            vi.setSystemTime(Date.now() + seconds * 1000);
          }
        };

        let lastMediaSequence = -1;
        let lastDiscontinuitySequence = -1;
        let sessionStartMs: number | undefined;
        // Polls of a file that no longer starts at the session's first
        // segment, and of those, the ones whose window starts with a program
        let windowedPolls = 0;
        let tagsAtWindowHead = 0;
        const poll = async () => {
          const content = ffmpeg.window(listSize);
          if (!content.includes('#EXT-X-MEDIA-SEQUENCE:0\n')) {
            windowedPolls++;
            const header = content.slice(0, content.indexOf('#EXTINF:'));
            if (header.includes('#EXT-X-DISCONTINUITY')) {
              tagsAtWindowHead++;
            }
          }
          await fs.writeFile(`${playlistPath}.tmp`, content);
          await fs.rename(`${playlistPath}.tmp`, playlistPath);
          // A player a few segments behind the newest one
          session.onSegmentRequested(
            '10.0.0.1',
            `data${String(Math.max(0, ffmpeg.segmentCount - 3)).padStart(6, '0')}.ts`,
          );
          const served = (await session.trimPlaylist()).get();
          if (served === undefined) {
            throw new Error('No playlist served');
          }
          const { mediaSequence, discontinuitySequence, segments } =
            parseServedPlaylist(served.playlist);

          expect(segments.length).toBeGreaterThan(0);
          expect(mediaSequence).toBe(segments[0]?.number);
          expect(mediaSequence).toBeGreaterThanOrEqual(lastMediaSequence);
          expect(discontinuitySequence).toBeGreaterThanOrEqual(
            lastDiscontinuitySequence,
          );
          lastMediaSequence = mediaSequence ?? -1;
          lastDiscontinuitySequence = discontinuitySequence;

          sessionStartMs ??= segments[0]?.startMs;
          for (const [i, segment] of segments.entries()) {
            const want = expected[segment.number];
            expect(want).toBeDefined();
            // Every poll gives a segment the same discontinuity number and
            // start, those of the whole session's playlist
            expect(segment.discontinuity).toBe(want?.discontinuity);
            expect(segment.startMs - (sessionStartMs ?? 0)).toBe(want?.startMs);
            const previous = segments[i - 1];
            if (previous !== undefined) {
              expect(segment.number).toBe(previous.number + 1);
              expect(segment.startMs).toBe(
                previous.startMs + previous.seconds * 1000,
              );
            }
          }
        };

        // About 45 minutes of programs of 9 to 26 segments. Each program's
        // first segments come in a burst, as a read-ahead does, and its last
        // segment is short. The player polls after every segment or two.
        const programLengths = [10, 17, 9, 25, 12, 21, 15, 26];
        let program = 0;
        while (ffmpeg.segmentCount < 1_400) {
          if (program > 0) {
            ffmpeg.newProgram();
          }
          const length = programLengths[program % programLengths.length] ?? 10;
          const burst = program % 3 === 0 ? 6 : 1;
          addSegments(burst);
          await poll();
          for (let done = burst; done < length - 1; done += 2) {
            addSegments(Math.min(2, length - 1 - done));
            await poll();
          }
          addSegments(1, 0.5);
          program++;
        }
        await poll();

        // The file is a full window, and has slid past the session's start
        // with program starts at its head
        expect(listSize).toBe(450);
        const final = await fs.readFile(playlistPath, 'utf-8');
        expect(final.match(/#EXTINF:/g)).toHaveLength(450);
        expect(final).toContain(
          `#EXT-X-MEDIA-SEQUENCE:${ffmpeg.segmentCount - 450}\n`,
        );
        expect(final).not.toContain('#EXT-X-DISCONTINUITY-SEQUENCE');
        expect(windowedPolls).toBeGreaterThan(400);
        expect(tagsAtWindowHead).toBeGreaterThan(10);
        // Program starts long gone from the file are still counted
        expect(discontinuities).toBeGreaterThan(70);
        expect(lastDiscontinuitySequence).toBeGreaterThan(70);
        // The newest 20 segments
        expect(lastMediaSequence).toBe(ffmpeg.segmentCount - 20);
      } finally {
        vi.useRealTimers();
      }
      // About 2 s on an idle laptop: 900 rewrites of a 450-entry file
    }, 60_000);
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
      { untilWatching = false, realtime = true } = {},
    ) {
      const calls = speedWatcherCalls.current;
      const contexts: PlayerContext[] = [];
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
        transcodeConfig: {
          name: 'Default',
          threadCount: 4,
          hardwareAccelerationMode: 'none',
        },
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
        ((context: PlayerContext) => {
          contexts.push(context);
          return {
            context,
            on: vi.fn(),
            renditions: undefined,
            transcodeSession,
            setup: async () => Result.success(transcodeSession),
            start: async () => {
              calls.push('ffmpeg started');
            },
          } as unknown as ProgramStream;
        }) as (ctx: PlayerContext, fmt: OutputFormat) => ProgramStream,
      );
      await fs.mkdir(session.workingDirectory, { recursive: true });
      const internals = session as unknown as {
        state: string;
        transcode(realtime: boolean): Promise<void>;
        logger: { warn: Mock; info: Mock; error: Mock };
      };
      internals.state = 'started';
      const done = internals.transcode(realtime);
      await vi.waitFor(() =>
        expect(calls).toContain(untilWatching ? 'watching' : 'ffmpeg started'),
      );

      return {
        calls,
        contexts,
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

    // Plex answers a tune only once it has 5 s of video, so the transcode
    // that reads ahead is the one a viewer waits on
    test('a transcode that reads ahead gets up to 16 threads', async () => {
      const cores = vi.spyOn(os, 'availableParallelism').mockReturnValue(16);
      try {
        const { contexts, exit } = await startTranscode('hls', {
          realtime: false,
        });
        await exit();

        expect(contexts[0]?.transcodeConfig.threadCount).toBe(16);
      } finally {
        cores.mockRestore();
      }
    });

    test('a real-time transcode keeps the configured thread count', async () => {
      const cores = vi.spyOn(os, 'availableParallelism').mockReturnValue(16);
      try {
        const { contexts, exit } = await startTranscode('hls');
        await exit();

        expect(contexts[0]?.transcodeConfig.threadCount).toBe(4);
      } finally {
        cores.mockRestore();
      }
    });

    test('does not watch hls_direct_v2, which copies the video', async () => {
      const { exit } = await startTranscode('hls_direct_v2');
      await exit();

      expect(speedWatchers).toHaveLength(0);
    });
  });
});
