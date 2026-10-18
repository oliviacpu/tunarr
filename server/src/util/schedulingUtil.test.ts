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
  // The day and hour of the next `count` runs after midnight on 2026-10-18,
  // Central time (the box's container), as cron-parser and so node-schedule
  // read them
  function nextRuns(cron: string, count: number) {
    const runs = parser.parseExpression(cron, {
      currentDate: new Date('2026-10-18T00:00:00-05:00'),
      tz: 'America/Chicago',
    });
    return Array.from({ length: count }, () => {
      const run = runs.next();
      return `${run.getDate()} ${run.getHours()}:${run.getMinutes()}`;
    });
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

  test('every hour from 0 runs every hour', () => {
    expect(hoursFromCrontab(1, 0)).toBe(
      `0 0 ${Array.from({ length: 24 }, (_, h) => h).join(',')} * * *`,
    );
  });

  test('every 6 hours from 23 runs once a day at 23:00', () => {
    expect(hoursFromCrontab(6, 23)).toBe('0 0 23 * * *');
    expect(nextRuns(hoursFromCrontab(6, 23), 2)).toEqual([
      '18 23:0',
      '19 23:0',
    ]);
  });

  test('from 0 it runs at the same hours the stepped crontab did', () => {
    for (const hours of [1, 2, 3, 4, 5, 6, 7, 8, 12, 24]) {
      expect(nextRuns(hoursFromCrontab(hours), 30)).toEqual(
        nextRuns(`0 0 */${hours} * * *`, 30),
      );
    }
  });

  test('more than 24 hours runs once a day, and odd values are clamped', () => {
    expect(hoursFromCrontab(48, 3)).toBe('0 0 3 * * *');
    expect(hoursFromCrontab(0, 0)).toBe(hoursFromCrontab(1, 0));
    expect(hoursFromCrontab(4, 30)).toBe('0 0 23 * * *');
    expect(hoursFromCrontab(4, -2)).toBe(hoursFromCrontab(4, 0));
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

test('xmlTvRefreshCrontab follows refreshHours and refreshStartHour', () => {
  expect(xmlTvRefreshCrontab({ refreshHours: 24, refreshStartHour: 3 })).toBe(
    '0 0 3 * * *',
  );
  expect(xmlTvRefreshCrontab({ refreshHours: 4, refreshStartHour: 0 })).toBe(
    '0 0 0,4,8,12,16,20 * * *',
  );
});
