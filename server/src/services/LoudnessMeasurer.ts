import { execFile } from 'node:child_process';
import { inject, injectable } from 'inversify';
import type { ISettingsDB } from '../db/interfaces/ISettingsDB.ts';
import type { MeasuredLoudness } from '../stream/types.ts';
import { KEYS } from '../types/inject.ts';

// Only files up to this long are measured: whole, which is exact and cheap for
// music, commercials and shorts (2-7 s each on a busy shared server). Episodes
// and films took 1-16 minutes each to read, a sample of them missed by up to
// 6 LU, and their loudness range is far wider than a levelling target's anyway
// (plans/loudness-measured-once.md, "Measurements")
export const MeasureUpToMs = 12 * 60 * 1000;
const MeasureTimeoutMs = 5 * 60 * 1000;

/**
 * ffmpeg arguments that measure the loudness of the given audio streams of a
 * file in one pass: one loudnorm analysis per stream, each named after its
 * stream (`loudnorm@s<index>`) so its report can be told apart. Audio only,
 * one thread.
 */
export function loudnessMeasureArgs(
  file: string,
  streamIndexes: readonly number[],
): string[] {
  const graph = streamIndexes
    .map(
      (index) => `[0:${index}]loudnorm@s${index}=print_format=json[out${index}]`,
    )
    .join(';');
  return [
    '-nostdin',
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'info',
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-vn',
    '-sn',
    '-dn',
    '-i',
    file,
    '-filter_complex',
    graph,
    ...streamIndexes.flatMap((index) => ['-map', `[out${index}]`]),
    '-f',
    'null',
    '-',
  ];
}

/**
 * The loudness of each stream from loudnorm's reports in ffmpeg's log (see
 * {@link loudnessMeasureArgs}). A stream without a complete report is missing
 * from the result.
 */
export function parseLoudnessReports(
  log: string,
): Map<number, MeasuredLoudness> {
  const found = new Map<number, MeasuredLoudness>();
  const report =
    /\[loudnorm@s(\d+) @ [^\]]+\][^{]*(\{[^}]*\})/g;
  for (const match of log.matchAll(report)) {
    const [, index, json] = match;
    if (index === undefined || json === undefined) {
      continue;
    }
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const integrated = reportValue(values['input_i']);
    const truePeak = reportValue(values['input_tp']);
    const range = reportValue(values['input_lra']);
    if (
      integrated !== undefined &&
      truePeak !== undefined &&
      range !== undefined
    ) {
      found.set(Number(index), { integrated, truePeak, range });
    }
  }
  return found;
}

// loudnorm reports a silent stream as -inf: that becomes SilentFloor, well
// under EBU R128's -70 LUFS gate, so levelling leaves it alone and it stores as
// a plain number
const SilentFloor = -99;

function reportValue(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return;
  }
  if (/^-inf/i.test(value.trim())) {
    return SilentFloor;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Measures programs' audio loudness with ffmpeg, at the lowest CPU priority
 * where `nice` exists, so playback on a shared server comes first.
 */
@injectable()
export class LoudnessMeasurer {
  constructor(@inject(KEYS.SettingsDB) private settingsDB: ISettingsDB) {}

  async measure(
    file: string,
    streamIndexes: readonly number[],
  ): Promise<Map<number, MeasuredLoudness>> {
    const ffmpeg = this.settingsDB.ffmpegSettings().ffmpegExecutablePath;
    const args = loudnessMeasureArgs(file, streamIndexes);
    const log =
      process.platform === 'win32'
        ? await run(ffmpeg, args)
        : await run('nice', ['-n', '19', ffmpeg, ...args]).catch(
            (e: unknown) => {
              // No nice on this system: run it as is
              if (isNotFound(e)) {
                return run(ffmpeg, args);
              }
              throw e;
            },
          );
    return parseLoudnessReports(log);
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: MeasureTimeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve(stderr);
        }
      },
    );
  });
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'ENOENT'
  );
}
