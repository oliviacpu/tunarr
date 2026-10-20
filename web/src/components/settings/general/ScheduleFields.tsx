import {
  NumericFormControllerText,
  SelectFormController,
} from '@/components/util/TypedController.tsx';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Stack, Typography } from '@mui/material';
import { TimePicker } from '@mui/x-date-pickers';
import type { EverySchedule } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';

/** The General settings fields that hold a schedule. */
export type SchedulePath =
  | 'backup.configurations.0.schedule'
  | 'logging.logRollConfig.schedule';

type ScheduleUnit = EverySchedule['unit'];

// Hours and days are what the page offers. A unit only settings.json can set
// is listed as well while it is the saved one, so it shows as it is
const OfferedUnits: ScheduleUnit[] = ['hour', 'day'];

function unitLabel(unit: ScheduleUnit, count: number) {
  switch (unit) {
    case 'second':
      return plural(count, { one: 'Second', other: 'Seconds' });
    case 'minute':
      return plural(count, { one: 'Minute', other: 'Minutes' });
    case 'hour':
      return plural(count, { one: 'Hour', other: 'Hours' });
    case 'day':
      return plural(count, { one: 'Day', other: 'Days' });
    case 'week':
      return plural(count, { one: 'Week', other: 'Weeks' });
  }
}

// The schedule's time of day is milliseconds after midnight
function offsetToTime(offsetMs: number) {
  const offset = dayjs.duration(offsetMs);
  return dayjs().startOf('day').hour(offset.hours()).minute(offset.minutes());
}

function timeToOffset(time: dayjs.Dayjs) {
  return dayjs
    .duration({ hours: time.hour(), minutes: time.minute() })
    .asMilliseconds();
}

type ScheduleFieldsProps = {
  /** Where the schedule sits in the General settings form. */
  name: SchedulePath;
  /**
   * Names the "every N" field: its label and the start of its validation
   * messages, such as "Backup interval".
   */
  intervalLabel: string;
  /** Prefix for the inputs' ids. */
  id: string;
};

/**
 * "Every N hours / days, at a time of day" for a schedule in the General
 * settings form: a number, a unit, and for daily schedules the time of day.
 * Each input has its own label. A cron schedule, which only settings.json can
 * set, is shown as text.
 */
export function ScheduleFields({
  name,
  intervalLabel,
  id,
}: ScheduleFieldsProps) {
  const { t } = useLingui();
  const { control } = useFormContext<GeneralSettingsFormData>();
  const schedule = useWatch({ control, name });

  if (schedule === undefined) {
    return null;
  }

  if (schedule.type === 'cron') {
    const cron = schedule.cron;
    return (
      <Typography variant="body2" color="text.secondary">
        <Trans>
          Runs on the cron schedule <code>{cron}</code>, set in settings.json.
        </Trans>
      </Typography>
    );
  }

  // The unit names follow the number, also while it is being typed
  const count =
    typeof schedule.increment === 'number' &&
    Number.isFinite(schedule.increment)
      ? schedule.increment
      : 2;
  const units = OfferedUnits.includes(schedule.unit)
    ? OfferedUnits
    : [...OfferedUnits, schedule.unit];
  const atLeastOne = t`${intervalLabel} must be at least 1.`;

  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}
    >
      <NumericFormControllerText
        control={control}
        name={`${name}.increment`}
        prettyFieldName={intervalLabel}
        rules={{ required: atLeastOne, min: { value: 1, message: atLeastOne } }}
        TextFieldProps={{
          id: `${id}-increment`,
          label: intervalLabel,
          sx: { width: 140 },
        }}
      />
      <SelectFormController
        control={control}
        name={`${name}.unit`}
        label={t`Unit`}
        options={units.map((unit) => ({
          value: unit,
          label: unitLabel(unit, count),
        }))}
        TextFieldProps={{ id: `${id}-unit`, sx: { width: 140 } }}
      />
      {schedule.unit === 'day' && (
        <Controller
          control={control}
          name={`${name}.offsetMs`}
          render={({ field }) => (
            <TimePicker
              label={t`Time of day`}
              value={offsetToTime(field.value)}
              onChange={(value) => {
                // Cleared means midnight. A time still being typed is left
                // to the picker until it is whole
                if (value === null) {
                  field.onChange(0);
                } else if (value.isValid()) {
                  field.onChange(timeToOffset(value));
                }
              }}
              inputRef={field.ref}
              slotProps={{
                textField: {
                  id: `${id}-time`,
                  onBlur: field.onBlur,
                  sx: { width: 180 },
                },
              }}
            />
          )}
        />
      )}
    </Stack>
  );
}
