import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import { describe, expect, it } from 'vitest';
import {
  ReadAheadMaxThreads,
  readAheadThreadCount,
  transcodeConfigFor,
} from './readAheadThreads.ts';

function config(
  threadCount: number,
  hardwareAccelerationMode: TranscodeConfigOrm['hardwareAccelerationMode'] = 'none',
) {
  return {
    uuid: 'config',
    name: 'Default',
    threadCount,
    hardwareAccelerationMode,
  } as TranscodeConfigOrm;
}

describe('readAheadThreadCount', () => {
  it.each([
    [0, 2],
    [4, 4],
    [16, 16],
  ])('honors a configured limit of %i', (limit, expected) => {
    expect(readAheadThreadCount(config(2), 64, limit)).toBe(expected);
    expect(transcodeConfigFor(config(2), false, 64, limit).threadCount).toBe(
      expected,
    );
  });

  it('uses up to 16 threads on a machine with the cores for them', () => {
    expect(ReadAheadMaxThreads).toBe(16);
    expect(readAheadThreadCount(config(8), 16)).toBe(16);
    expect(readAheadThreadCount(config(8), 64)).toBe(16);
  });

  it('never uses more threads than the cores Tunarr may run on', () => {
    expect(readAheadThreadCount(config(4), 12)).toBe(12);
  });

  it('never uses fewer threads than the transcode config asks for', () => {
    expect(readAheadThreadCount(config(8), 4)).toBe(8);
    expect(readAheadThreadCount(config(24), 32)).toBe(24);
  });

  it('leaves a config that lets ffmpeg choose (0) alone', () => {
    expect(readAheadThreadCount(config(0), 16)).toBe(0);
  });

  // Software decoding, and a software encoder when hardware encoding is
  // disabled or unavailable, use the count in a hardware pipeline too
  it('raises the count in a hardware pipeline as well', () => {
    expect(readAheadThreadCount(config(4, 'cuda'), 16)).toBe(16);
    expect(readAheadThreadCount(config(4, 'vaapi'), 16)).toBe(16);
  });
});

describe('transcodeConfigFor', () => {
  it('keeps the configured thread count for a real-time transcode', () => {
    const configured = config(8);
    expect(transcodeConfigFor(configured, true, 16)).toBe(configured);
  });

  it('raises the thread count for a transcode that reads ahead, leaving the config alone', () => {
    const configured = config(8);
    const used = transcodeConfigFor(configured, false, 16);

    expect(used.threadCount).toBe(16);
    expect(used.name).toBe('Default');
    expect(configured.threadCount).toBe(8);
  });

  it('returns the config itself when the count would not change', () => {
    const configured = config(8);
    expect(transcodeConfigFor(configured, false, 8)).toBe(configured);
  });
});
