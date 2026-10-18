import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StreamLineupItem } from '../db/derived_types/StreamLineup.ts';
import type { ISettingsDB } from '../db/interfaces/ISettingsDB.ts';
import type { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { ChannelOrm } from '../db/schema/Channel.ts';
import type { TranscodeConfigOrm } from '../db/schema/TranscodeConfig.ts';
import {
  HlsOutputFormat,
  defaultHlsOptions,
} from '../ffmpeg/builder/constants.ts';
import type { FFmpegAssistedFactory } from '../ffmpeg/FFmpegModule.ts';
import type {
  PlaceholderSessionOpts,
  TranscodeSessionResult,
} from '../ffmpeg/types.ts';
import { NowPlayingFontFileName } from '../ffmpeg/nowPlayingText.ts';
import { setGlobalOptionsUnchecked } from '../globals.ts';
import type { CacheImageService } from '../services/cacheImageService.ts';
import { Result } from '../types/result.ts';
import { uploadVersion, uploadsDirectory } from '../util/iconUtil.ts';
import { PlayerContext } from './PlayerStreamContext.ts';
import { ProgramStream } from './ProgramStream.ts';
import type { ProgramStreamDetailsFetcher } from './ProgramStreamDetailsFetcher.ts';
import { FileStreamSource } from './types.ts';

class ThrowingProgramStream extends ProgramStream {
  protected override setupInternal(): Promise<Result<TranscodeSessionResult>> {
    return Promise.reject(
      new Error('Streams with no video are not currently supported.'),
    );
  }
}

describe('ProgramStream', () => {
  it('turns a setup throw into a failed result', async () => {
    const stream = new ThrowingProgramStream(
      {} as ISettingsDB,
      {} as CacheImageService,
      {} as FFmpegAssistedFactory,
      {} as MediaSourceDB,
      {} as ProgramStreamDetailsFetcher,
      [],
      {} as PlayerContext,
      HlsOutputFormat(defaultHlsOptions),
    );

    const result = await stream.setup();

    expect(result.isFailure()).toBe(true);
    expect(stream.isInitialized()).toBe(false);
  });

  // A session's first transcode reads ahead (realtime false). Gaps and error
  // screens used to ignore the session's pace and always start at real time,
  // so a tune-in that landed in a gap waited seconds longer for its first
  // segments.
  describe('placeholder items', () => {
    let databaseDirectory: string;
    const card = new TextEncoder().encode('png');

    beforeAll(async () => {
      databaseDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'tunarr-program-stream-'),
      );
      setGlobalOptionsUnchecked({
        database: databaseDirectory,
        log_level: 'error',
        verbose: 0,
      });
      const uploads = uploadsDirectory(databaseDirectory);
      await fs.mkdir(uploads, { recursive: true });
      await fs.writeFile(path.join(uploads, 'card.png'), card);
    });

    afterAll(async () => {
      await fs.rm(databaseDirectory, { recursive: true, force: true });
    });

    function setUp(
      lineupItem: StreamLineupItem,
      {
        realtime,
        picture,
        showNowPlaying,
        musicPlays = true,
      }: {
        realtime: boolean;
        picture?: string;
        showNowPlaying?: boolean;
        // whether the gap music track's stream resolves
        musicPlays?: boolean;
      },
    ) {
      const createPlaceholderSession = vi.fn(
        (_opts: PlaceholderSessionOpts) => {
          return Promise.resolve({
            session: { on: vi.fn() },
            renditions: { audio: [] },
          });
        },
      );
      const channel = {
        uuid: 'channel',
        number: 6,
        offline: { mode: 'pic', picture, showNowPlaying },
      } as unknown as ChannelOrm;
      const mediaSourceDB = {
        getById: vi.fn(() => Promise.resolve({ uuid: 'music-source' })),
      } as unknown as MediaSourceDB;
      const programStreamDetails = {
        getStream: vi.fn(() =>
          Promise.resolve(
            musicPlays
              ? Result.success({
                  streamDetails: {
                    audioDetails: [{ index: 0, codec: 'flac', channels: 2 }],
                  },
                  streamSource: new FileStreamSource(
                    '/music/les-exemples/08.flac',
                  ),
                })
              : Result.failure(new Error('gone')),
          ),
        ),
      } as unknown as ProgramStreamDetailsFetcher;
      const stream = new ProgramStream(
        {} as ISettingsDB,
        {} as CacheImageService,
        (() => ({
          createPlaceholderSession,
        })) as unknown as FFmpegAssistedFactory,
        mediaSourceDB,
        programStreamDetails,
        [],
        new PlayerContext(
          lineupItem,
          channel,
          channel,
          {} as TranscodeConfigOrm,
          { audioOnly: false, realtime, streamMode: 'hls' },
        ),
        HlsOutputFormat(defaultHlsOptions),
        // what an HLS session passes: no realtime of its own
        { ptsOffset: 0, isFirstTranscode: true },
      );
      return { stream, createPlaceholderSession };
    }

    const gap: StreamLineupItem = {
      type: 'offline',
      duration: 60_000,
      streamDuration: 60_000,
      programBeginMs: 0,
    };
    const error: StreamLineupItem = {
      type: 'error',
      duration: 60_000,
      streamDuration: 60_000,
      programBeginMs: 0,
      error: 'broken',
    };

    it.each([
      ['a gap', gap],
      ['an error screen', error],
    ])("%s follows the session's pace", async (_, item) => {
      for (const realtime of [false, true]) {
        const { stream, createPlaceholderSession } = setUp(item, { realtime });

        expect((await stream.setup()).isSuccess()).toBe(true);
        expect(createPlaceholderSession.mock.calls[0]?.[0]?.realtime).toBe(
          realtime,
        );
      }
    });

    it('reads an uploaded offline picture from disk', async () => {
      const { stream, createPlaceholderSession } = setUp(gap, {
        realtime: false,
        picture: `https://tv.example/images/uploads/card.png?v=${uploadVersion(card)}`,
      });

      await stream.setup();

      const opts = createPlaceholderSession.mock.calls[0]?.[0];
      expect(opts?.kind === 'offline' && opts.picture).toEqual(
        new FileStreamSource(
          path.join(uploadsDirectory(databaseDirectory), 'card.png'),
        ),
      );
    });

    const gapWithMusic: StreamLineupItem = {
      ...gap,
      type: 'offline',
      backgroundMusic: {
        program: {
          uuid: 'track',
          title: 'Le matin à Paris',
          duration: 60_000,
          mediaSourceId: 'music-source',
        } as never,
        fillerListId: 'music-list',
        artist: 'Les Exemples',
      },
    };

    it("draws the gap music's artist and title, with a font ffmpeg can read", async () => {
      const { stream, createPlaceholderSession } = setUp(gapWithMusic, {
        realtime: false,
      });

      await stream.setup();

      const opts = createPlaceholderSession.mock.calls[0]?.[0];
      const fontFile = path.join(
        databaseDirectory,
        'fonts',
        NowPlayingFontFileName,
      );
      expect(opts?.kind === 'offline' && opts.nowPlaying).toEqual({
        text: '♪  Les Exemples — Le matin à Paris',
        fontFile,
      });
      expect((await fs.stat(fontFile)).size).toBeGreaterThan(0);
    });

    it('copies the font again if it went missing', async () => {
      const fontFile = path.join(
        databaseDirectory,
        'fonts',
        NowPlayingFontFileName,
      );
      await setUp(gapWithMusic, { realtime: false }).stream.setup();
      await fs.rm(fontFile);

      await setUp(gapWithMusic, { realtime: false }).stream.setup();

      expect((await fs.stat(fontFile)).size).toBeGreaterThan(0);
    });

    it.each([
      ['the channel turned it off', { showNowPlaying: false }],
      ["the track doesn't play", { musicPlays: false }],
    ])('draws no title when %s', async (_, opts) => {
      const { stream, createPlaceholderSession } = setUp(gapWithMusic, {
        realtime: false,
        ...opts,
      });

      await stream.setup();

      const sessionOpts = createPlaceholderSession.mock.calls[0]?.[0];
      expect(
        sessionOpts?.kind === 'offline' && sessionOpts.nowPlaying,
      ).toBeUndefined();
    });

    it.each([
      ['a picture elsewhere', 'https://cdn.example/card.png'],
      [
        'a missing upload',
        `https://tv.example/images/uploads/gone.png?v=${uploadVersion(card)}`,
      ],
      ['no picture', undefined],
    ])('leaves %s to the URL', async (_, picture) => {
      const { stream, createPlaceholderSession } = setUp(gap, {
        realtime: false,
        picture,
      });

      await stream.setup();

      const opts = createPlaceholderSession.mock.calls[0]?.[0];
      expect(opts?.kind === 'offline' && opts.picture).toBeUndefined();
    });
  });
});
