import type { TupleToUnion } from '@/types/util.js';
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
 * it until midnight: every 4 hours from 3 is 3, 7, 11, 15, 19 and 23, and every
 * 24 hours (or more) from 3 is once a day at 3. The hours are listed rather
 * than stepped (`3-23/4`), so any interval works, including one past 23.
 */
export function hoursFromCrontab(
  everyHours: number,
  startHour = 0,
  minute = 0,
): string {
  const step = Math.max(1, Math.round(everyHours));
  const start = Math.min(23, Math.max(0, Math.round(startHour)));
  const hours: number[] = [];
  for (let hour = start; hour < 24; hour += step) {
    hours.push(hour);
  }
  return `0 ${minute} ${hours.join(',')} * * *`;
}

/** When the scheduled full guide rebuild (UpdateXmlTvTask) runs */
export function xmlTvRefreshCrontab(settings: {
  refreshHours: number;
  refreshStartHour: number;
}): string {
  return hoursFromCrontab(settings.refreshHours, settings.refreshStartHour);
}
