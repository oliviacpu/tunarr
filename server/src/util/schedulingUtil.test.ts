import { minimumXmlTvGuideHours } from '@tunarr/shared/util';
import { EverySchedule } from '@tunarr/types/schemas';
import parser from 'cron-parser';
import schedule from 'node-schedule';
import dayjs from './dayjs.ts';
import {
  hoursFromCrontab,
  scheduleRuleToCronString,
  xmlTvRefreshCrontab,
} from './schedulingUtil.ts';
test('should parse every schedules', () => {
  const schedule: EverySchedule = {
    type: 'every',
    offsetMs: dayjs.duration(4, 'hours').asMilliseconds(),
    increment: 1,
    unit: 'hour',
  };

  expect(scheduleRuleToCronString(schedule)).toEqual('0 4-23 * * *');
});

describe('hoursFromCrontab', () => {
  // The day and hour of the next `count` runs after `from` (by default
  // midnight on 2026-10-18), Central time (the box's container), as
  // cron-parser and so node-schedule read them
  function nextRuns(
    cron: string,
    count: number,
    from = '2026-10-18T00:00:00-05:00',
  ) {
    const runs = parser.parseExpression(cron, {
      currentDate: new Date(from),
      tz: 'America/Chicago',
    });
    return Array.from({ length: count }, () => {
      const run = runs.next();
      return `${run.getDate()} ${run.getHours()}:${run.getMinutes()}`;
    });
  }

  // The real time, in hours, from each of the next `count` runs after `from`
  // to the run after it
  function realGapsInHours(cron: string, count: number, from: string) {
    const runs = parser.parseExpression(cron, {
      currentDate: new Date(from),
      tz: 'America/Chicago',
    });
    const times = Array.from({ length: count + 1 }, () =>
      runs.next().getTime(),
    );
    return times
      .slice(1)
      .map((time, i) => (time - (times[i] ?? Number.NaN)) / 3600e3);
  }

  test('every 24 hours from 3 runs once a day at 03:00', () => {
    expect(hoursFromCrontab(24, 3)).toBe('0 0 3 * * *');
    expect(nextRuns(hoursFromCrontab(24, 3), 3)).toEqual([
      '18 3:0',
      '19 3:0',
      '20 3:0',
    ]);
  });

  test('every 4 hours from 3 runs at 3, 7, 11, 15, 19 and 23', () => {
    expect(hoursFromCrontab(4, 3)).toBe('0 0 3,7,11,15,19,23 * * *');
    expect(nextRuns(hoursFromCrontab(4, 3), 7)).toEqual([
      '18 3:0',
      '18 7:0',
      '18 11:0',
      '18 15:0',
      '18 19:0',
      '18 23:0',
      '19 3:0',
    ]);
  });

  test('every 4 hours from 12 carries on past midnight to 0, 4 and 8', () => {
    expect(hoursFromCrontab(4, 12)).toBe('0 0 0,4,8,12,16,20 * * *');
    expect(
      nextRuns(hoursFromCrontab(4, 12), 7, '2026-10-18T11:00:00-05:00'),
    ).toEqual([
      '18 12:0',
      '18 16:0',
      '18 20:0',
      '19 0:0',
      '19 4:0',
      '19 8:0',
      '19 12:0',
    ]);
  });

  test('every hour from 0 runs every hour', () => {
    expect(hoursFromCrontab(1, 0)).toBe(
      `0 0 ${Array.from({ length: 24 }, (_, h) => h).join(',')} * * *`,
    );
  });

  test('every 6 hours from 23 runs at 5, 11, 17 and 23', () => {
    expect(hoursFromCrontab(6, 23)).toBe('0 0 5,11,17,23 * * *');
    expect(nextRuns(hoursFromCrontab(6, 23), 5)).toEqual([
      '18 5:0',
      '18 11:0',
      '18 17:0',
      '18 23:0',
      '19 5:0',
    ]);
  });

  test('an interval that does not divide 24 starts again at the start hour', () => {
    // 19 + 5 is 0, and the next day's cycle starts at 4: one 4-hour gap a
    // day, rather than every hour that steps of 5 would reach
    expect(hoursFromCrontab(5, 4)).toBe('0 0 0,4,9,14,19 * * *');
    expect(hoursFromCrontab(7, 20)).toBe('0 0 3,10,17,20 * * *');
  });

  test('no gap is longer than the interval, for every start hour and interval', () => {
    // From the listed hours: running all 576 through cron-parser in a time
    // zone takes about 25 s. The tests around this one check that cron-parser
    // runs the listed hours
    for (let startHour = 0; startHour < 24; startHour++) {
      for (let everyHours = 1; everyHours <= 24; everyHours++) {
        const cron = hoursFromCrontab(everyHours, startHour);
        const context = `every ${everyHours} h from ${startHour}: ${cron}`;
        const fields = cron.split(' ');
        expect(fields, context).toHaveLength(6);
        const hours = (fields[2] ?? '').split(',').map(Number);
        const first = hours[0] ?? Number.NaN;
        const last = hours.at(-1) ?? Number.NaN;
        // Each hour to the next, and the last to the next day's first
        const gaps = [
          ...hours.slice(1).map((hour, i) => hour - (hours[i] ?? Number.NaN)),
          first + 24 - last,
        ];

        expect(Math.max(...gaps), context).toBeLessThanOrEqual(everyHours);
        expect(Math.min(...gaps), context).toBeGreaterThan(0);
        expect(hours, context).toContain(startHour);
        // No more runs a day than the interval needs
        expect(hours, context).toHaveLength(Math.ceil(24 / everyHours));
      }
    }
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 12, 24])(
    'from 0, interval %i matches the stepped crontab',
    (hours) => {
      expect(nextRuns(hoursFromCrontab(hours), 30)).toEqual(
        nextRuns(`0 0 */${hours} * * *`, 30),
      );
    },
  );

  test('more than 24 hours runs once a day, and odd values are clamped', () => {
    expect(hoursFromCrontab(48, 3)).toBe('0 0 3 * * *');
    expect(hoursFromCrontab(0, 0)).toBe(hoursFromCrontab(1, 0));
    expect(hoursFromCrontab(4, 30)).toBe(hoursFromCrontab(4, 23));
    expect(hoursFromCrontab(4, -2)).toBe(hoursFromCrontab(4, 0));
  });

  // The clocks change at 02:00 in the US: back to 01:00 on 2026-11-01, forward
  // to 03:00 on 2027-03-14
  describe('daylight saving time, from 02:00 Central time', () => {
    test('when the clocks go back, 02:00 runs once', () => {
      expect(
        nextRuns(hoursFromCrontab(24, 2), 3, '2026-10-31T12:00:00-05:00'),
      ).toEqual(['1 2:0', '2 2:0', '3 2:0']);
    });

    test('when the clocks go back, the gap across the change is an hour longer', () => {
      // 22:00 CDT to 02:00 CST is 5 hours, since 01:00 to 02:00 happens twice
      const from = '2026-10-31T21:00:00-05:00';
      expect(nextRuns(hoursFromCrontab(4, 2), 4, from)).toEqual([
        '31 22:0',
        '1 2:0',
        '1 6:0',
        '1 10:0',
      ]);
      expect(realGapsInHours(hoursFromCrontab(4, 2), 3, from)).toEqual([
        5, 4, 4,
      ]);
    });

    test('when the clocks go forward, 02:00 does not exist, so it runs at 03:00', () => {
      expect(
        nextRuns(hoursFromCrontab(24, 2), 3, '2027-03-13T12:00:00-06:00'),
      ).toEqual(['14 3:0', '15 2:0', '16 2:0']);
    });

    test('when the clocks go forward, no gap gets longer', () => {
      const from = '2027-03-13T21:00:00-06:00';
      expect(nextRuns(hoursFromCrontab(4, 2), 4, from)).toEqual([
        '13 22:0',
        '14 3:0',
        '14 6:0',
        '14 10:0',
      ]);
      expect(realGapsInHours(hoursFromCrontab(4, 2), 3, from)).toEqual([
        4, 3, 4,
      ]);
      // 02:00 moved to 03:00 runs once, not twice, when 03:00 is listed too
      expect(
        nextRuns(hoursFromCrontab(1, 2), 4, '2027-03-14T00:30:00-06:00'),
      ).toEqual(['14 1:0', '14 3:0', '14 4:0', '14 5:0']);
    });
  });

  test('node-schedule accepts it', () => {
    const job = schedule.scheduleJob(hoursFromCrontab(4, 3), () => {});
    try {
      expect(job).not.toBeNull();
      expect(job.nextInvocation()).toBeTruthy();
    } finally {
      job.cancel();
    }
  });
});

describe('xmlTvRefreshCrontab', () => {
  test('follows refreshHours and refreshStartHour', () => {
    expect(
      xmlTvRefreshCrontab({
        refreshHours: 24,
        refreshStartHour: 3,
        programmingHours: 72,
      }),
    ).toBe('0 0 3 * * *');
    expect(
      xmlTvRefreshCrontab({
        refreshHours: 4,
        refreshStartHour: 0,
        programmingHours: 12,
      }),
    ).toBe('0 0 0,4,8,12,16,20 * * *');
    expect(
      xmlTvRefreshCrontab({
        refreshHours: 6,
        refreshStartHour: 23,
        programmingHours: 12,
      }),
    ).toBe('0 0 5,11,17,23 * * *');
  });

  test('rebuilds more often when the guide is too short to last the timer', () => {
    // Saved before the API refused it: a 12-hour guide lasts an 11-hour wait,
    // with the hour the clocks go back
    expect(
      xmlTvRefreshCrontab({
        refreshHours: 24,
        refreshStartHour: 3,
        programmingHours: 12,
      }),
    ).toBe(hoursFromCrontab(10, 3));
    expect(
      xmlTvRefreshCrontab({
        refreshHours: 12,
        refreshStartHour: 0,
        programmingHours: 12,
      }),
    ).toBe('0 0 0,10,20 * * *');
  });
});

test('daily rebuild coverage includes the two-hour Antarctica/Troll rollback', () => {
  const runs = parser.parseExpression(hoursFromCrontab(24, 3), {
    currentDate: new Date('2026-10-24T00:00:00Z'),
    tz: 'Antarctica/Troll',
  });
  const before = runs.next().getTime();
  const after = runs.next().getTime();
  expect((after - before) / 3_600_000).toBe(26);
  expect(minimumXmlTvGuideHours(24)).toBeGreaterThanOrEqual(
    (after - before) / 3_600_000,
  );
});
