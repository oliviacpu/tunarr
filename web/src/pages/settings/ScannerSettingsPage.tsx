import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  getApiSettingsMediaSourceOptions,
  getApiTasksOptions,
  getApiTasksQueryKey,
  putApiSettingsMediaSourceMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { useDayjs } from '@/hooks/useDayjs.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { Box, Button, Stack, Typography } from '@mui/material';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type { Task } from '@tunarr/types';
import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import { minBy } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useCallback } from 'react';
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
  const queryClient = useQueryClient();
  const { data: mediaSourceSettings } = useSuspenseQuery(
    getApiSettingsMediaSourceOptions(),
  );
  const { data: tasks } = useQuery(getApiTasksOptions());
  const nextScan = nextScanEpoch(tasks);
  const nextScanTime =
    nextScan !== undefined ? dayjs(nextScan * 1000).format('llll') : undefined;

  const settingsForm = useForm<GlobalMediaSourceSettings>({
    defaultValues: mediaSourceSettings,
  });

  const snackbar = useSnackbar();

  const updateMediaSourceSettingsMut = useMutation({
    ...putApiSettingsMediaSourceMutation(),
    onSuccess: (returned) => {
      settingsForm.reset(returned);
      snackbar.enqueueSnackbar({
        variant: 'success',
        message: t`Successfully updated Media Source settings.`,
      });
      // The server moved the scheduled scan to the saved interval
      return queryClient.invalidateQueries({
        queryKey: getApiTasksQueryKey(),
      });
    },
    onError: (err) => {
      console.error(err);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message: t`Failed to update Media Source settings. Please check server and browser logs for details.`,
      });
    },
  });

  const onSubmit = useCallback(
    (data: GlobalMediaSourceSettings) => {
      updateMediaSourceSettingsMut.mutate({
        body: data,
      });
    },
    [updateMediaSourceSettingsMut],
  );

  const onError = useCallback(() => {
    snackbar.enqueueSnackbar({
      variant: 'error',
      message: t`There was an error submitting the request to update Media Source settings. Please check the form and try again`,
    });
  }, [snackbar, t]);

  return (
    <Stack>
      <Box
        component="form"
        onSubmit={settingsForm.handleSubmit(onSubmit, onError)}
      >
        <Stack gap={2}>
          <Stack gap={1}>
            <NumericFormControllerText
              control={settingsForm.control}
              name="rescanIntervalHours"
              prettyFieldName={t`Rescan interval (hours)`}
              rules={{
                min: {
                  value: 1,
                  message: t`Rescan interval must be at least 1 hour.`,
                },
              }}
              TextFieldProps={{
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
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              variant="contained"
              disabled={!settingsForm.formState.isDirty}
            >
              <Trans>Save</Trans>
            </Button>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
};
