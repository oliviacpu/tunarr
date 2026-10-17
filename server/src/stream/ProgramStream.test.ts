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
import { setGlobalOptionsUnchecked } from '../globals.ts';
import type { CacheImageService } from '../services/cacheImageService.ts';
import type { Result } from '../types/result.ts';
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
      { realtime, picture }: { realtime: boolean; picture?: string },
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
        offline: { mode: 'pic', picture },
      } as unknown as ChannelOrm;
      const stream = new ProgramStream(
        {} as ISettingsDB,
        {} as CacheImageService,
        (() => ({
          createPlaceholderSession,
        })) as unknown as FFmpegAssistedFactory,
        {} as MediaSourceDB,
        {} as ProgramStreamDetailsFetcher,
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
