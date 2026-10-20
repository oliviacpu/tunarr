import { renderHook } from '@testing-library/react';
import dayjs from 'dayjs';
import { describe, expect, test, vi } from 'vitest';
import type { UIChannelProgramWithOffset } from '../types/index.ts';
import { useGetProgramsForDayFunc } from './calendarHooks.ts';

const fixture = vi.hoisted(() => ({
  channel: { startTime: 0, duration: 0 },
  programs: [] as UIChannelProgramWithOffset[],
}));

vi.mock('./useChannels.ts', () => ({
  useChannelSuspense: () => ({ data: fixture.channel }),
}));
vi.mock('./useSuspendedStore.ts', () => ({
  useSuspendedStore: () => fixture.programs,
}));

const hour = 3_600_000;
const day = dayjs('2026-10-20').startOf('day');

function preview(
  durations: number[],
  start = day,
  savedDurationHours?: number,
) {
  let offset = 0;
  fixture.programs = durations.map((hours, index) => {
    const program: UIChannelProgramWithOffset = {
      type: 'flex',
      duration: hours * hour,
      uiIndex: index,
      originalIndex: index,
      startTimeOffset: offset,
    };
    offset += program.duration;
    return program;
  });
  fixture.channel = {
    startTime: +start,
    duration:
      savedDurationHours === undefined ? offset : savedDurationHours * hour,
  };
  return renderHook(() => useGetProgramsForDayFunc('channel')).result.current(
    day,
  );
}

describe('calendar cycle timestamps', () => {
  test('advances every repeated seven-hour cycle and clips its final program', () => {
    const programs = preview([7]);
    expect(
      programs.map(({ actualStartTime }) => +actualStartTime - +day),
    ).toEqual([0, 7, 14, 21].map((hours) => hours * hour));
    expect(programs.map(({ howFarIntoDay }) => howFarIntoDay)).toEqual(
      [0, 7, 14, 21].map((hours) => hours * hour),
    );
    expect(programs.map(({ duration }) => duration)).toEqual(
      [7, 7, 7, 3].map((hours) => hours * hour),
    );
    expect(
      new Set(programs.map(({ actualStartTime }) => +actualStartTime)).size,
    ).toBe(programs.length);
  });

  test('advances a mixed cycle after its last item without changing item order', () => {
    const durations = [1, 0.5, 1, 2, 1, 1, 0.5];
    const programs = preview(durations);
    const offsets = [0, 1, 1.5, 2.5, 4.5, 5.5, 6.5];
    expect(
      programs
        .slice(0, 21)
        .map(({ actualStartTime }) => +actualStartTime - +day),
    ).toEqual(
      [0, 7, 14].flatMap((cycle) =>
        offsets.map((offset) => (cycle + offset) * hour),
      ),
    );
    expect(programs.map(({ program }) => program)).toEqual(
      programs.map(
        (_, index) => fixture.programs[index % fixture.programs.length],
      ),
    );
    expect(programs[programs.length - 1]?.duration).toBe(0.5 * hour);
  });

  test('retains the first partial program then advances later cycles', () => {
    const programs = preview([6, 1], day.subtract(3, 'hour'));
    expect(
      programs
        .slice(0, 4)
        .map(({ actualStartTime }) => +actualStartTime - +day),
    ).toEqual([-3, 3, 4, 10].map((hours) => hours * hour));
    expect(programs[0]?.howFarIntoDay).toBe(0);
    expect(programs[0]?.duration).toBe(3 * hour);
    expect(programs.reduce((total, { duration }) => total + duration, 0)).toBe(
      24 * hour,
    );
  });

  test('preserves a non-repeating cycle and its final day clipping', () => {
    const programs = preview([12, 14]);
    expect(
      programs.map(({ actualStartTime }) => +actualStartTime - +day),
    ).toEqual([0, 12 * hour]);
    expect(programs.map(({ duration }) => duration)).toEqual([
      12 * hour,
      12 * hour,
    ]);
  });

  test('starts at a channel launched partway through the current day', () => {
    const programs = preview([12, 14], day.add(12, 'hour'));
    expect(programs).toHaveLength(1);
    expect(programs.map(({ actualStartTime }) => +actualStartTime)).toEqual([
      +day.add(12, 'hour'),
    ]);
    expect(programs[0]?.howFarIntoDay).toBe(12 * hour);
    expect(programs[0]?.duration).toBe(12 * hour);
  });

  test('uses an appended unsaved program in the cycle length instead of the saved duration', () => {
    const programs = preview([7, 1], day, 7);
    expect(
      programs.map(({ actualStartTime }) => +actualStartTime - +day),
    ).toEqual([0, 7, 8, 15, 16, 23].map((hours) => hours * hour));
    expect(
      new Set(programs.map(({ actualStartTime }) => +actualStartTime)).size,
    ).toBe(programs.length);
  });

  test.each([
    { name: 'appended', durations: [7, 1], elapsedHours: 9, firstDuration: 6 },
    { name: 'shortened', durations: [3, 1], elapsedHours: 5, firstDuration: 2 },
  ])(
    'uses the current $name list for the initial cycle phase',
    ({ durations, elapsedHours, firstDuration }) => {
      const programs = preview(
        durations,
        day.subtract(elapsedHours, 'hour'),
        7,
      );
      expect(programs[0]?.actualStartTime.valueOf()).toBe(+day - hour);
      expect(programs[0]?.program).toBe(fixture.programs[0]);
      expect(programs[0]?.duration).toBe(firstDuration * hour);
      expect(programs[1]?.howFarIntoDay).toBe(firstDuration * hour);
      expect(
        programs.reduce((total, { duration }) => total + duration, 0),
      ).toBe(24 * hour);
    },
  );

  test.each([{ durations: [] }, { durations: [0] }])(
    'an empty or zero-length current cycle returns no preview: $durations',
    ({ durations }) => {
      expect(preview(durations, day, 7)).toEqual([]);
    },
  );

  test.each([
    { elapsedHours: 7, remainingHours: 1 },
    { elapsedHours: 7.5, remainingHours: 0.5 },
  ])(
    'selects the final program at cycle phase $elapsedHours hours',
    ({ elapsedHours, remainingHours }) => {
      const programs = preview([7, 1], day.subtract(elapsedHours, 'hour'), 7);
      expect(programs[0]?.program).toBe(fixture.programs[1]);
      expect(programs[0]?.actualStartTime.valueOf()).toBe(
        +day - (elapsedHours - 7) * hour,
      );
      expect(programs[0]?.howFarIntoDay).toBe(0);
      expect(programs[0]?.duration).toBe(remainingHours * hour);
      expect(programs.every(({ duration }) => duration > 0)).toBe(true);
      expect(
        programs.reduce((total, { duration }) => total + duration, 0),
      ).toBe(24 * hour);
    },
  );
});
