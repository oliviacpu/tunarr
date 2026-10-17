import type { ContentGuideProgram } from '@tunarr/types';
import { Mutex } from 'async-mutex';
import dayjs from 'dayjs';
import { inject, injectable } from 'inversify';
import { partition, sample } from 'lodash-es';
import fs from 'node:fs/promises';
import z from 'zod';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import type { IFillerListDB } from '../db/interfaces/IFillerListDB.ts';
import type { IProgramDB } from '../db/interfaces/IProgramDB.ts';
import { MediaSourceDB } from '../db/mediaSourceDB.ts';
import { ProgramAudioLoudnessDB } from '../db/ProgramAudioLoudnessDB.ts';
import type { ProgramAudioLoudness } from '../db/schema/ProgramAudioLoudness.ts';
import { TranscodeConfigDB } from '../db/TranscodeConfigDB.ts';
import {
  LoudnessMeasurer,
  MeasureUpToMs,
} from '../services/LoudnessMeasurer.ts';
import { TVGuideService } from '../services/TvGuideService.ts';
import { ProgramStreamDetailsFetcher } from '../stream/ProgramStreamDetailsFetcher.ts';
import { KEYS } from '../types/inject.ts';
import { OpenDateTimeRange } from '../types/OpenDateTimeRange.ts';
import { caughtErrorToError, isNonEmptyString } from '../util/index.ts';
import { Task2 } from './Task.ts';
import { taskDef } from './TaskRegistry.ts';

// How far ahead the guide is read for programs to measure
const HorizonMs = 3 * 60 * 60 * 1000;
// Each run measures at most this many files, within this much time, one at a
// time: a shared server's CPU and disk are for playback first
export const MaxFilesPerRun = 8;
const RunBudgetMs = 10 * 60 * 1000;
// Gap-music tracks per channel per run
const GapTracksPerChannel = 4;
// The most audio streams of one file measured
const MaxStreams = 6;
// A failed measurement is tried again after this long
export const RetryFailedAfterMs = 24 * 60 * 60 * 1000;

const MeasureLoudnessTaskRequest = z.object({}).optional();

/**
 * Measures the audio loudness of short programs (music, commercials, shorts)
 * about to air on channels that level loudness, and of channels' gap music, so
 * playback can level them with a fixed gain instead of live loudnorm
 * (plans/loudness-measured-once.md). Never the whole library: only what is
 * coming up, each file once.
 */
@injectable()
@taskDef({
  name: MeasureLoudnessTask.name,
  description:
    'Measures the audio loudness of programs airing soon and of gap music, so they can be levelled without delaying tune-ins',
  schema: MeasureLoudnessTaskRequest,
})
export class MeasureLoudnessTask extends Task2<
  typeof MeasureLoudnessTaskRequest
> {
  static KEY = MeasureLoudnessTask.name;
  static ID = MeasureLoudnessTask.name;
  public ID = MeasureLoudnessTask.ID;

  private static runLock = new Mutex();

  schema = MeasureLoudnessTaskRequest;

  constructor(
    @inject(TVGuideService) private guideService: TVGuideService,
    @inject(KEYS.ChannelDB) private channelDB: IChannelDB,
    @inject(TranscodeConfigDB) private transcodeConfigDB: TranscodeConfigDB,
    @inject(KEYS.FillerListDB) private fillerDB: IFillerListDB,
    @inject(KEYS.ProgramDB) private programDB: IProgramDB,
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(ProgramStreamDetailsFetcher)
    private streamDetailsFetcher: ProgramStreamDetailsFetcher,
    @inject(ProgramAudioLoudnessDB) private loudnessDB: ProgramAudioLoudnessDB,
    @inject(LoudnessMeasurer) private measurer: LoudnessMeasurer,
  ) {
    super();
  }

  protected async runInternal(): Promise<void> {
    if (MeasureLoudnessTask.runLock.isLocked()) {
      return;
    }
    await MeasureLoudnessTask.runLock.runExclusive(async () => {
      const started = Date.now();
      let measured = 0;
      for (const programId of await this.candidates()) {
        if (measured >= MaxFilesPerRun || Date.now() - started > RunBudgetMs) {
          break;
        }
        if (await this.measureProgram(programId)) {
          measured++;
        }
      }
      if (measured > 0) {
        this.logger.debug(
          'Measured the loudness of %d file(s) in %d ms',
          measured,
          Date.now() - started,
        );
      }
    });
  }

  // Programs airing soonest first, then a few gap-music tracks per channel
  // that have never been measured
  private async candidates(): Promise<string[]> {
    const channels = await this.channelDB.getAllChannels();
    const configs = new Map(
      (await this.transcodeConfigDB.getAll()).map((config) => [
        config.uuid,
        config,
      ]),
    );
    const levelled = channels.filter((channel) =>
      Boolean(configs.get(channel.transcodeConfigId)?.audioLoudnormConfig),
    );

    const ids: string[] = [];
    if (levelled.length > 0) {
      await this.guideService.get();
      const now = dayjs();
      const range = OpenDateTimeRange.create(now, now.add(HorizonMs));
      if (range) {
        const guides = await this.guideService.getChannelGuides(
          range,
          levelled.map((channel) => channel.uuid),
        );
        const airing = guides
          .flatMap(({ programs }) => programs)
          .filter(
            (program): program is ContentGuideProgram =>
              program.type === 'content' && program.duration <= MeasureUpToMs,
          )
          .sort((a, b) => a.start - b.start);
        ids.push(...airing.map((program) => program.id));
      }
    }

    for (const channel of channels) {
      const listId = channel.offline?.musicListId;
      if (!isNonEmptyString(listId)) {
        continue;
      }
      const tracks = await this.fillerDB.getFillerPrograms(listId);
      const rows = groupRows(
        await this.loudnessDB.getForPrograms(tracks.map((track) => track.uuid)),
      );
      const [unmeasured, measured] = partition(
        tracks.filter((track) => track.duration <= MeasureUpToMs),
        (track) => needsMeasuring(rows.get(track.uuid)),
      );
      ids.push(
        ...unmeasured.slice(0, GapTracksPerChannel).map((track) => track.uuid),
      );
      // One measured track a run is checked against its file again, so a
      // replaced track is measured again in time; ffmpeg runs only if it was
      const recheck = sample(measured);
      if (recheck) {
        ids.push(recheck.uuid);
      }
    }
    return [...new Set(ids)];
  }

  // Measures the program's audio streams that have no measurement for its
  // current file. True when ffmpeg ran.
  private async measureProgram(programId: string): Promise<boolean> {
    const program = await this.programDB.getProgramById(programId);
    if (!program?.mediaSourceId) {
      return false;
    }
    const mediaSource = await this.mediaSourceDB.getById(program.mediaSourceId);
    if (!mediaSource) {
      return false;
    }
    const stream = await this.streamDetailsFetcher.getStream({
      server: mediaSource,
      lineupItem: { ...program, mediaSourceId: mediaSource.uuid },
    });
    if (stream.isFailure()) {
      return false;
    }
    const { streamDetails, streamSource } = stream.get();
    // Only short files this server can read; anything else stays on live
    // loudnorm (see MeasureUpToMs)
    if (
      streamSource.type !== 'file' ||
      streamDetails.duration.asMilliseconds() > MeasureUpToMs
    ) {
      return false;
    }
    // The fetcher attached the measurements that match this file
    const missing = (streamDetails.audioDetails ?? [])
      .filter((audio) => !audio.loudness)
      .slice(0, MaxStreams);
    if (missing.length === 0) {
      return false;
    }

    const rows = await this.loudnessDB.getForProgram(programId);
    const size = await fs
      .stat(streamSource.path)
      .then((stat) => stat.size)
      .catch(() => undefined);
    if (size === undefined) {
      return false;
    }
    const failedRecently = missing.every((audio) => {
      const row = rows.find((row) => row.streamIndex === audio.index);
      return (
        row !== undefined &&
        row.error !== null &&
        row.filePath === streamSource.path &&
        row.fileSize === size &&
        Date.now() - +row.measuredAt < RetryFailedAfterMs
      );
    });
    if (failedRecently) {
      return false;
    }

    const indexes = missing.map((audio) => audio.index);
    let results = new Map<
      number,
      { integrated: number; truePeak: number; range: number }
    >();
    let error: string | undefined;
    try {
      results = await this.measurer.measure(streamSource.path, indexes);
    } catch (e) {
      error = caughtErrorToError(e).message.slice(0, 500);
      this.logger.debug(e, 'Measuring the loudness of %s failed', programId);
    }
    for (const index of indexes) {
      const result = results.get(index);
      await this.loudnessDB.record({
        programId,
        streamIndex: index,
        filePath: streamSource.path,
        fileSize: size,
        integrated: result?.integrated ?? null,
        truePeak: result?.truePeak ?? null,
        range: result?.range ?? null,
        error: result ? null : (error ?? 'no loudness report'),
        measuredAt: new Date(),
      });
    }
    return true;
  }
}

function groupRows(rows: ProgramAudioLoudness[]) {
  const byProgram = new Map<string, ProgramAudioLoudness[]>();
  for (const row of rows) {
    byProgram.set(row.programId, [
      ...(byProgram.get(row.programId) ?? []),
      row,
    ]);
  }
  return byProgram;
}

// A gap-music track with no measurement yet, or only a failure old enough to
// try again
export function needsMeasuring(
  rows: readonly ProgramAudioLoudness[] | undefined,
  now = Date.now(),
): boolean {
  if (!rows || rows.length === 0) {
    return true;
  }
  return rows.every(
    (row) => row.error !== null && now - +row.measuredAt >= RetryFailedAfterMs,
  );
}
