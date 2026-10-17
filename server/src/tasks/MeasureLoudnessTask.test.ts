import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import type { IFillerListDB } from '../db/interfaces/IFillerListDB.ts';
import type { IProgramDB } from '../db/interfaces/IProgramDB.ts';
import type { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { ProgramAudioLoudnessDB } from '../db/ProgramAudioLoudnessDB.ts';
import type { ProgramAudioLoudness } from '../db/schema/ProgramAudioLoudness.ts';
import type { TranscodeConfigDB } from '../db/TranscodeConfigDB.ts';
import type { LoudnessMeasurer } from '../services/LoudnessMeasurer.ts';
import type { TVGuideService } from '../services/TvGuideService.ts';
import type { ProgramStreamDetailsFetcher } from '../stream/ProgramStreamDetailsFetcher.ts';
import { Result } from '../types/result.ts';
import {
  MeasureLoudnessTask,
  RetryFailedAfterMs,
  needsMeasuring,
} from './MeasureLoudnessTask.ts';

dayjs.extend(duration);

vi.mock('@/util/logging/LoggerFactory.js', () => {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    setBindings: vi.fn(),
  };
  return {
    LoggerFactory: {
      isInitialized: true,
      root: logger,
      child: () => logger,
    },
  };
});

// Only an injection token here; the real one pulls in the DI container
vi.mock('../services/TvGuideService.ts', () => ({
  TVGuideService: class {},
}));

const row = (
  overrides: Partial<ProgramAudioLoudness>,
): ProgramAudioLoudness => ({
  programId: 'p',
  streamIndex: 1,
  filePath: '/media/a.flac',
  fileSize: 3,
  integrated: -14,
  truePeak: -1,
  range: 5,
  error: null,
  measuredAt: new Date(),
  ...overrides,
});

describe('needsMeasuring', () => {
  const now = Date.now();

  it('measures a track with no measurement', () => {
    expect(needsMeasuring(undefined, now)).toBe(true);
    expect(needsMeasuring([], now)).toBe(true);
  });

  it('leaves a measured track alone', () => {
    expect(needsMeasuring([row({})], now)).toBe(false);
  });

  it('tries a failed one again only after a while', () => {
    const failed = {
      integrated: null,
      truePeak: null,
      range: null,
      error: 'x',
    };
    expect(
      needsMeasuring(
        [row({ ...failed, measuredAt: new Date(now - 60_000) })],
        now,
      ),
    ).toBe(false);
    expect(
      needsMeasuring(
        [row({ ...failed, measuredAt: new Date(now - RetryFailedAfterMs) })],
        now,
      ),
    ).toBe(true);
  });
});

describe('MeasureLoudnessTask', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-measure-'));
    file = path.join(dir, 'clip.mkv');
    await fs.writeFile(file, 'abc');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function harness({
    levelled = true,
    rows = [] as ProgramAudioLoudness[],
    measure = vi
      .fn()
      .mockResolvedValue(
        new Map([[1, { integrated: -14, truePeak: -1, range: 5 }]]),
      ),
  } = {}) {
    const durations: Record<string, number> = {
      commercial: 60_000,
      episode: 44 * 60_000,
      track: 200_000,
    };
    const guideService = {
      get: vi.fn().mockResolvedValue(undefined),
      getChannelGuides: vi.fn().mockResolvedValue([
        {
          programs: [
            {
              type: 'content',
              id: 'episode',
              duration: durations.episode,
              start: 0,
            },
            {
              type: 'content',
              id: 'commercial',
              duration: durations.commercial,
              start: 1,
            },
            { type: 'flex', duration: 30_000, start: 2 },
          ],
        },
      ]),
    } as unknown as TVGuideService;
    const channelDB = {
      getAllChannels: vi.fn().mockResolvedValue([
        {
          uuid: 'channel',
          transcodeConfigId: 'config',
          offline: { mode: 'pic', musicListId: 'music' },
        },
      ]),
    } as unknown as IChannelDB;
    const transcodeConfigDB = {
      getAll: vi.fn().mockResolvedValue([
        {
          uuid: 'config',
          audioLoudnormConfig: levelled ? { i: -24, lra: 7, tp: -2 } : null,
        },
      ]),
    } as unknown as TranscodeConfigDB;
    const fillerDB = {
      getFillerPrograms: vi
        .fn()
        .mockResolvedValue([{ uuid: 'track', duration: durations.track }]),
    } as unknown as IFillerListDB;
    const programDB = {
      getProgramById: vi.fn((id: string) =>
        Promise.resolve({ uuid: id, mediaSourceId: 'source' }),
      ),
    } as unknown as IProgramDB;
    const mediaSourceDB = {
      getById: vi.fn().mockResolvedValue({ uuid: 'source' }),
    } as unknown as MediaSourceDB;
    const streamDetailsFetcher = {
      getStream: vi.fn(({ lineupItem }: { lineupItem: { uuid: string } }) =>
        Promise.resolve(
          Result.success({
            streamDetails: {
              duration: dayjs.duration(durations[lineupItem.uuid] ?? 0),
              audioDetails: [{ index: 1 }],
            },
            streamSource: { type: 'file', path: file },
          }),
        ),
      ),
    } as unknown as ProgramStreamDetailsFetcher;
    const loudnessDB = {
      getForProgram: vi.fn().mockResolvedValue(rows),
      getForPrograms: vi.fn().mockResolvedValue(rows),
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgramAudioLoudnessDB;
    const measurer = { measure } as unknown as LoudnessMeasurer;
    const task = new MeasureLoudnessTask(
      guideService,
      channelDB,
      transcodeConfigDB,
      fillerDB,
      programDB,
      mediaSourceDB,
      streamDetailsFetcher,
      loudnessDB,
      measurer,
    );
    return { task, measure, loudnessDB };
  }

  it('measures short programs airing soon and gap music, never long ones', async () => {
    const { task, measure, loudnessDB } = harness();

    await task.run({});

    expect(measure).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenCalledWith(file, [1]);
    const recorded = vi
      .mocked(loudnessDB.record)
      .mock.calls.map(([r]) => [r.programId, r.integrated, r.fileSize]);
    expect(recorded).toEqual([
      ['commercial', -14, 3],
      ['track', -14, 3],
    ]);
  });

  it('measures only gap music on a channel that levels nothing', async () => {
    const { task, measure, loudnessDB } = harness({ levelled: false });

    await task.run({});

    expect(measure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loudnessDB.record).mock.calls[0]?.[0].programId).toBe(
      'track',
    );
  });

  it('records a failure, to try again later', async () => {
    const { task, loudnessDB } = harness({
      measure: vi.fn().mockRejectedValue(new Error('ffmpeg exited with 1')),
    });

    await task.run({});

    expect(vi.mocked(loudnessDB.record).mock.calls[0]?.[0]).toMatchObject({
      programId: 'commercial',
      integrated: null,
      error: 'ffmpeg exited with 1',
    });
  });

  it('leaves a file that failed recently alone', async () => {
    const failedHere = () =>
      row({
        filePath: file,
        fileSize: 3,
        integrated: null,
        truePeak: null,
        range: null,
        error: 'ffmpeg exited with 1',
        measuredAt: new Date(),
      });
    const { task, measure, loudnessDB } = harness();
    vi.mocked(loudnessDB.getForProgram).mockResolvedValue([failedHere()]);

    await task.run({});

    expect(measure).not.toHaveBeenCalled();
  });
});
