import { Trans, useLingui } from '@lingui/react/macro';
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Stack,
} from '@mui/material';
import { defaultLogRollConfig } from '@tunarr/types';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { formatBytes } from '../../../helpers/util.ts';
import {
  CheckboxFormController,
  NumericFormControllerText,
} from '../../util/TypedController.tsx';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';
import { ScheduleFields } from './ScheduleFields.tsx';

export const LogRollForm = () => {
  const { t } = useLingui();
  const { control, getValues, setValue } =
    useFormContext<GeneralSettingsFormData>();
  const [enabled, onSchedule] = useWatch({
    control,
    name: ['logging.logRollConfig.enabled', 'logRollOnSchedule'],
  });

  // Ticking "Roll on schedule" with no usable schedule starts from daily at
  // midnight. Unticking keeps the schedule, so ticking again brings it back;
  // it is only left out of the save
  const scheduleOnTick = () => {
    const schedule = getValues('logging.logRollConfig.schedule');
    if (
      schedule?.type === 'every' &&
      typeof schedule.increment === 'number' &&
      schedule.increment >= 1
    ) {
      return;
    }
    setValue(
      'logging.logRollConfig.schedule',
      { type: 'every', increment: 1, unit: 'day', offsetMs: 0 },
      { shouldDirty: true },
    );
  };

  return (
    <Stack gap={2}>
      <FormControl>
        <FormControlLabel
          label={t`Enable log file rolling`}
          control={
            <CheckboxFormController
              control={control}
              name="logging.logRollConfig.enabled"
            />
          }
        />
        <FormHelperText>
          <Trans>
            Starts a new log file on a schedule, at a size limit, or both.
          </Trans>
        </FormHelperText>
      </FormControl>
      {enabled && (
        <>
          <Stack gap={2}>
            <FormControl>
              <FormControlLabel
                label={t`Roll on schedule`}
                control={
                  <Controller
                    control={control}
                    name="logRollOnSchedule"
                    render={({ field }) => (
                      <Checkbox
                        name={field.name}
                        inputRef={field.ref}
                        checked={field.value}
                        onBlur={field.onBlur}
                        onChange={(_, checked) => {
                          if (checked) {
                            scheduleOnTick();
                          }
                          field.onChange(checked);
                        }}
                      />
                    )}
                  />
                }
              />
              <FormHelperText>
                <Trans>
                  Roll the log file on a fixed schedule, regardless of file
                  size.
                </Trans>
              </FormHelperText>
            </FormControl>
            {onSchedule && (
              <ScheduleFields
                name="logging.logRollConfig.schedule"
                intervalLabel={t`Roll interval`}
                id="log-roll-schedule"
              />
            )}
          </Stack>
          <Stack direction="row">
            <FormControl fullWidth>
              <FormControlLabel
                label={t`Roll based on size`}
                control={
                  <Controller
                    control={control}
                    name="logging.logRollConfig.maxFileSizeBytes"
                    render={({ field }) => (
                      <Checkbox
                        checked={(field.value ?? 0) > 0}
                        onChange={(_, checked) =>
                          field.onChange(
                            checked
                              ? defaultLogRollConfig().maxFileSizeBytes
                              : 0,
                          )
                        }
                      />
                    )}
                  />
                }
              />
              <FormHelperText>
                <Trans>
                  Roll the log file when it grows past the maximum size.
                </Trans>
              </FormHelperText>
            </FormControl>
            <NumericFormControllerText
              control={control}
              name="logging.logRollConfig.maxFileSizeBytes"
              TextFieldProps={{
                fullWidth: true,
                label: t`Max file size (bytes)`,
                helperText: ({ field }) =>
                  field.value ? `${formatBytes(field.value)}` : '',
              }}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
};
