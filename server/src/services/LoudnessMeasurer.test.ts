import { describe, expect, test } from 'vitest';
import {
  loudnessMeasureArgs,
  parseLoudnessReports,
} from './LoudnessMeasurer.ts';

describe('loudnessMeasureArgs', () => {
  test('reads the file once, audio only, one analysis per stream', () => {
    const args = loudnessMeasureArgs('/media/song.flac', [0]);

    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(args).toEqual(
      expect.arrayContaining(['-vn', '-sn', '-dn', '-i', '/media/song.flac']),
    );
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[0:0]loudnorm@s0=print_format=json[out0]',
    );
    expect(args.slice(-5)).toEqual(['-map', '[out0]', '-f', 'null', '-']);
  });

  test("names each stream's analysis after it, and maps each", () => {
    const args = loudnessMeasureArgs('/media/clip.mkv', [1, 2]);

    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[0:1]loudnorm@s1=print_format=json[out1];[0:2]loudnorm@s2=print_format=json[out2]',
    );
    expect(args.flatMap((a, i) => (a === '-map' ? [args[i + 1]] : []))).toEqual(
      ['[out1]', '[out2]'],
    );
  });
});

describe('parseLoudnessReports', () => {
  const report = (index: number, i: string, tp: string, lra: string) =>
    `[loudnorm@s${index} @ 0x7c7ec64300] \n{\n\t"input_i" : "${i}",\n\t"input_tp" : "${tp}",\n\t"input_lra" : "${lra}",\n\t"input_thresh" : "-26.56",\n\t"output_i" : "-24.10",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.10"\n}\n`;

  test("reads each stream's report, whatever order they come in", () => {
    const log = [
      'Input #0, matroska,webm, from \'/media/episode.mkv\':',
      report(2, '-31.40', '-9.80', '12.30'),
      '[out#0/null @ 0x7c7edb4000] video:0KiB audio:90000KiB',
      report(1, '-16.52', '-5.01', '1.90'),
    ].join('\n');

    expect(parseLoudnessReports(log)).toEqual(
      new Map([
        [1, { integrated: -16.52, truePeak: -5.01, range: 1.9 }],
        [2, { integrated: -31.4, truePeak: -9.8, range: 12.3 }],
      ]),
    );
  });

  test("reads loudnorm's -inf for silence as a floor under the silence gate", () => {
    expect(parseLoudnessReports(report(1, '-inf', '-inf', '0.00'))).toEqual(
      new Map([[1, { integrated: -99, truePeak: -99, range: 0 }]]),
    );
  });

  test('skips a stream without a complete report', () => {
    expect(
      parseLoudnessReports(
        `${report(1, '-20', '-3', '5').replace('"input_tp" : "-3"', '"input_tp" : "nan?"')}`,
      ).size,
    ).toBe(0);
    expect(parseLoudnessReports('[loudnorm@s1 @ 0x1] \n{ broken').size).toBe(0);
    expect(parseLoudnessReports('no reports at all').size).toBe(0);
  });
});
