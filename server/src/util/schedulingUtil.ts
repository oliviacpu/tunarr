import type { TupleToUnion } from '@/types/util.js';
import { xmlTvScheduledIntervalHours } from '@tunarr/shared/util';
import type { EverySchedule } from '@tunarr/types/schemas';
import type {
  CronFields,
  DayOfTheMonthRange,
  HourRange,
  SixtyRange,
} from 'cron-parser';
import parser from 'cron-parser';
import CronExpression from 'cron-parser/lib/expression';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import { range, reduce } from 'lodash-es';
import { run } from './index.ts';

dayjs.extend(duration);

const Order: Record<EverySchedule['unit'], number> = {
  second: 0,
  minute: 1,
  hour: 2,
  day: 3,
  week: 4,
};

type Constraints = TupleToUnion<typeof CronExpression.constraints>;

const constraintsByType: Record<keyof CronFields, Constraints> = run(() => {
  return reduce(
    CronExpression.map,
    (acc, key, idx) => {
      const constraint = CronExpression.constraints[idx];
      return {
        ...acc,
        [key]: constraint,
      };
    },
    {} as Record<keyof CronFields, Constraints>,
  );
});

const defaultCronFields: CronFields = run(() => {
  return reduce(
    CronExpression.map,
    (acc, key, idx) => {
      const constraint = CronExpression.constraints[idx]!;
      return {
        ...acc,
        [key]: range(constraint.min, constraint.max + 1),
      };
    },
    {} as Partial<CronFields>,
  ) as Required<CronFields>;
});

export function scheduleRuleToCronString(schedule: EverySchedule) {
  const offset = dayjs.duration(schedule.offsetMs);

  function getRange(
    everyUnit: EverySchedule['unit'],
    cronUnit: keyof CronFields,
  ) {
    const isSmallerUnit = Order[everyUnit] < Order[schedule.unit];
    let rangeEnd: number;
    if (schedule.unit === everyUnit) {
      rangeEnd = constraintsByType[cronUnit].max + 1;
    } else if (isSmallerUnit) {
      // a smaller unit takes into account offset
      rangeEnd =
        Math.min(
          Math.max(offset.get(everyUnit), constraintsByType[cronUnit].min),
          constraintsByType[cronUnit].max,
        ) + 1;
    } else {
      // a larger unit is "all"
      rangeEnd = constraintsByType[cronUnit].max + 1;
    }

    return range(
      Math.min(
        Math.max(constraintsByType[cronUnit].min, offset.get(everyUnit)),
        constraintsByType[cronUnit].max,
      ),
      rangeEnd,
      schedule.unit === everyUnit ? schedule.increment : undefined,
    );
  }

  return parser
    .fieldsToExpression({
      month: defaultCronFields.month,
      dayOfMonth: getRange('day', 'dayOfMonth') as DayOfTheMonthRange[],
      dayOfWeek: defaultCronFields.dayOfWeek,
      hour: getRange('hour', 'hour') as HourRange[],
      minute: getRange('minute', 'minute') as SixtyRange[],
      second: getRange('second', 'second') as SixtyRange[],
    })
    .stringify();
}

/**
 * A crontab that runs at `startHour` (server time) and every `everyHours` after
 * it, around the clock: the hours are `(startHour + k * everyHours) mod 24` for
 * each k whose offset `k * everyHours` is under a day, sorted. Every 4 hours
 * from 12 is 0, 4, 8, 12, 16 and 20; every 6 hours from 23 is 5, 11, 17 and 23;
 * every 24 hours (or more) from 3 is once a day at 3. From 0 these are the
 * hours `*\/N` gave.
 *
 * When the interval doesn't divide 24, the cycle starts again at `startHour`
 * each day, so the gap before it is the short one: every 5 hours from 4 is 0,
 * 4, 9, 14 and 19. No gap is longer than the interval, and there are no more
 * runs a day than the interval needs. (Counting on until the hours repeat
 * would reach every multiple of the interval's greatest common divisor with
 * 24: every 5 hours would run every hour.)
 *
 * The hours are wall-clock hours, so daylight saving time moves the runs the
 * way node-schedule (cron-parser) reads them. On the day the clocks go forward,
 * an hour that doesn't exist (02:00 in the US) runs at the hour after it
 * (03:00), once even when that hour is listed too, so no gap gets longer. On
 * the day they go back, a repeated hour runs once, so the gap across the change
 * is an hour longer than the interval in real time.
 *
 * The hours are listed rather than stepped (`3-23/4`), so any interval works,
 * including one past 23.
 */
export function hoursFromCrontab(
  everyHours: number,
  startHour = 0,
  minute = 0,
): string {
  const step = Math.max(1, Math.round(everyHours));
  const start = Math.min(23, Math.max(0, Math.round(startHour)));
  const hours: number[] = [];
  for (let offset = 0; offset < 24; offset += step) {
    hours.push((start + offset) % 24);
  }
  hours.sort((a, b) => a - b);
  return `0 ${minute} ${hours.join(',')} * * *`;
}

/**
 * When the scheduled full guide rebuild (UpdateXmlTvTask) runs: every
 * refreshHours from refreshStartHour, or more often when the guide is too
 * short to last that long (`xmlTvScheduledIntervalHours`). The API refuses
 * such settings, but ones saved before it did still get a guide that lasts.
 */
export function xmlTvRefreshCrontab(settings: {
  refreshHours: number;
  refreshStartHour: number;
  programmingHours: number;
}): string {
  return hoursFromCrontab(
    xmlTvScheduledIntervalHours(settings),
    settings.refreshStartHour,
  );
}
