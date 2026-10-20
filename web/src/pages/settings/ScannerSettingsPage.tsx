import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  getApiSettingsMediaSourceOptions,
  getApiTasksOptions,
  getApiTasksQueryKey,
  putApiSettingsMediaSourceMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { useDayjs } from '@/hooks/useDayjs.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { Stack, Typography } from '@mui/material';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { Task } from '@tunarr/types';
import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import { isEqual, minBy } from 'lodash-es';
import { useEffect } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { useForm } from 'react-hook-form';

// The server's scheduled library scan, as listed by GET /tasks
const ScanLibrariesTaskId = 'ScanLibrariesTask';

// When the server will next scan the libraries, in seconds since the epoch
function nextScanEpoch(tasks: Task[] | undefined): number | undefined {
  const scan = tasks?.find((task) => task.id === ScanLibrariesTaskId);
  return minBy(scan?.scheduledTasks, (job) => job.nextExecutionEpoch)
    ?.nextExecutionEpoch;
}

export const ScannerSettingsPage = () => {
  const { t } = useLingui();
  const dayjs = useDayjs();
  const settingsQuery = getApiSettingsMediaSourceOptions();
  const { data } = useSuspenseQuery(settingsQuery);
  const { data: tasks } = useQuery(getApiTasksOptions());
  const nextScan = nextScanEpoch(tasks);
  const nextScanTime =
    nextScan !== undefined ? dayjs(nextScan * 1000).format('llll') : undefined;

  const form = useForm<GlobalMediaSourceSettings>({
    defaultValues: data,
    // Save turns off as soon as a value stops being valid; a field says why
    // once it has been left
    mode: 'onTouched',
  });
  const {
    reset,
    formState: { defaultValues },
  } = form;

  // Load the saved settings into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight
  useEffect(() => {
    if (!isEqual(data, defaultValues)) {
      reset(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiSettingsMediaSourceMutation(),
    toFormValues: (saved) => saved,
    // The server moved the scheduled scan to the saved interval
    invalidate: [
      { queryKey: settingsQuery.queryKey },
      { queryKey: getApiTasksQueryKey() },
    ],
  });

  const save: SubmitHandler<GlobalMediaSourceSettings> = (settings) => {
    saveMutation.mutate({ body: settings });
  };

  return (
    <SettingsForm
      form={form}
      onSubmit={save}
      isSubmitting={saveMutation.isPending}
    >
      <Stack gap={1}>
        <NumericFormControllerText
          control={form.control}
          name="rescanIntervalHours"
          prettyFieldName={t`Rescan interval (hours)`}
          rules={{
            min: {
              value: 1,
              message: t`Rescan interval must be at least 1 hour.`,
            },
          }}
          TextFieldProps={{
            id: 'rescan-interval-hours',
            label: t`Rescan interval (hours)`,
            helperText: t`How often Tunarr scans your libraries, counted from midnight. A new interval applies as soon as you save.`,
          }}
        />
        {nextScanTime !== undefined && (
          <Typography variant="body2" color="text.secondary">
            <Trans>Next scan: {nextScanTime}</Trans>
          </Typography>
        )}
      </Stack>
    </SettingsForm>
  );
};
