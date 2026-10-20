import { LearnMoreLink } from '@/components/base/LearnMoreLink.tsx';
import { LoadingIcon } from '@/components/base/LoadingIcon.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  getApiSystemSettingsQueryKey,
  putApiSystemSettingsMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { isValidUrl } from '@/helpers/util.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { useSystemState } from '@/hooks/useSystemSettings.ts';
import { useVersion } from '@/hooks/useVersion.tsx';
import useStore from '@/store/index.ts';
import { setBackendUri } from '@/store/settings/actions.ts';
import { useSettings } from '@/store/settings/selectors.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { CloudDoneOutlined, CloudOff } from '@mui/icons-material';
import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import type {
  LogCategories,
  LoggingSettings,
  LogRollConfig,
  TupleToUnion,
} from '@tunarr/types';
import {
  LogLevels,
  type LogLevel,
  type ServerSettings,
  type SystemSettings,
} from '@tunarr/types';
import { type UpdateSystemSettingsRequest } from '@tunarr/types/api';
import type { BackupSettings, Schedule } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import { isEqual, map, trim, trimEnd } from 'lodash-es';
import { useCallback, useEffect } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import type { StrictOmit } from 'ts-essentials';
import { BackupForm } from './BackupForm.tsx';
import { LogRollForm } from './LogRollForm.tsx';

const LogLevelChoices = [
  {
    description: 'Use environment settings',
    value: 'env',
  },
  ...map(LogLevels, (level) => ({
    description: level === 'http_out' ? 'http (egress)' : level,
    value: level,
  })),
];

const CategoryLogLevelChoices = [
  {
    description: 'Inherit default',
    value: 'inherit',
  },
  ...map(LogLevels, (level) => ({
    description: level === 'http_out' ? 'http (egress)' : level,
    value: level,
  })),
];

const LogCategorySelectInputs = ['streaming', 'scheduling'] as const;

// Loading the page and a successful save both fill the form from this, so
// every field has the same shape after each of them; Reset changes puts back
// what it last filled in.
function getDefaultFormValues(
  backendUri: string,
  systemSettings: SystemSettings,
): GeneralSettingsFormData {
  const { logRollConfig } = systemSettings.logging;
  const schedule = logRollConfig.schedule;
  return {
    backendUri,
    logLevel: systemSettings.logging.useEnvVarLevel
      ? 'env'
      : systemSettings.logging.logLevel,
    logRollOnSchedule:
      schedule !== undefined &&
      (schedule.type === 'cron' || schedule.increment > 0),
    backup: systemSettings.backup,
    server: systemSettings.server,
    logging: {
      ...systemSettings.logging,
      logRollConfig: {
        ...logRollConfig,
        maxFileSizeBytes: logRollConfig.maxFileSizeBytes ?? 0,
        // Without a schedule, "Roll on schedule" is unticked and the fields
        // behind it hold a placeholder; the save leaves the schedule out.
        schedule: schedule ?? {
          type: 'every',
          unit: 'day',
          increment: 0,
          offsetMs: 0,
        },
      },
      categoryLogLevel: {
        ...(systemSettings.logging.categoryLogLevel ?? {}),
        ...LogCategorySelectInputs.reduce(
          (prev, category) => {
            prev[category] ??=
              systemSettings.logging.categoryLogLevel?.[category] ?? 'inherit';
            return prev;
          },
          {} as Record<
            TupleToUnion<typeof LogCategories>,
            LogLevel | 'inherit'
          >,
        ),
      },
    },
  };
}

// What the server is sent for the form's values
function toUpdateRequest(
  data: GeneralSettingsFormData,
): UpdateSystemSettingsRequest {
  const { logRollConfig, categoryLogLevel } = data.logging;
  // With rolling off the server reads neither the schedule nor the size
  // limit, and the page hides both, so neither is sent
  const rolling = logRollConfig.enabled;
  return {
    logging: {
      logLevel: data.logLevel === 'env' ? undefined : data.logLevel,
      useEnvVarLevel: data.logLevel === 'env',
      logRollConfig: {
        ...logRollConfig,
        maxFileSizeBytes:
          rolling && logRollConfig.maxFileSizeBytes
            ? Math.max(0, logRollConfig.maxFileSizeBytes)
            : undefined,
        schedule:
          rolling && data.logRollOnSchedule
            ? logRollConfig.schedule
            : undefined,
      },
      categoryLogLevel: {
        scheduling:
          categoryLogLevel?.scheduling === 'inherit'
            ? null
            : categoryLogLevel?.scheduling,
        streaming:
          categoryLogLevel?.streaming === 'inherit'
            ? null
            : categoryLogLevel?.streaming,
      },
    },
    backup: data.backup,
    server: data.server,
  };
}

export function GeneralSettingsForm({
  systemSettings,
}: GeneralSetingsFormProps) {
  const { t } = useLingui();
  const categoryLogLevelLabels: Record<
    (typeof LogCategorySelectInputs)[number],
    string
  > = {
    streaming: t`Streaming log level`,
    scheduling: t`Scheduling log level`,
  };
  const { backendUri } = useSettings();
  const versionInfo = useVersion({
    retry: 0,
  });
  const systemState = useSystemState();

  const { isLoading, isError } = versionInfo;

  const form = useForm<GeneralSettingsFormData>({
    defaultValues: getDefaultFormValues(backendUri, systemSettings),
    // Save turns off as soon as a value stops being valid; a field says why
    // once it has been left
    mode: 'onTouched',
  });

  const {
    control,
    reset,
    formState: { defaultValues },
  } = form;

  // Load the saved settings into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight
  useEffect(() => {
    const loaded = getDefaultFormValues(backendUri, systemSettings);
    if (!isEqual(loaded, defaultValues)) {
      reset(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemSettings]);

  // The field array's own list changes with remove() and append(). A watched
  // value would lag a render behind, and in that render the backup fields
  // would register again and put the removed backup back
  const {
    fields: backupConfigurations,
    remove,
    append,
  } = useFieldArray({
    control,
    name: 'backup.configurations',
  });
  const backupsEnabled = backupConfigurations.length > 0;

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiSystemSettingsMutation(),
    // The server URL lives in this browser, not in the response. The save set
    // it just before sending, so read it now rather than from this render
    toFormValues: (saved) =>
      getDefaultFormValues(useStore.getState().settings.backendUri, saved),
    invalidate: { queryKey: getApiSystemSettingsQueryKey() },
  });

  const save: SubmitHandler<GeneralSettingsFormData> = (data) => {
    setBackendUri(trimEnd(trim(data.backendUri), '/'));
    saveMutation.mutate({ body: toUpdateRequest(data) });
  };

  const toggleBackupEnabled = useCallback(() => {
    if (backupsEnabled) {
      remove();
    } else {
      append({
        enabled: true,
        outputs: [
          {
            type: 'file',
            archiveFormat: 'tar',
            maxBackups: 3,
            outputPath: '',
          },
        ],
        schedule: {
          type: 'every',
          increment: 1,
          unit: 'day',
          offsetMs: dayjs.duration({ hours: 3 }).asMilliseconds(),
        },
      });
    }
  }, [append, backupsEnabled, remove]);

  function renderBackupsForm() {
    return (
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <FormControl fullWidth>
            <FormControlLabel
              control={
                <Checkbox
                  checked={backupsEnabled}
                  onChange={toggleBackupEnabled}
                />
              }
              label={t`Enable backups`}
            />
            <FormHelperText>
              <Trans>
                Turning backups on makes a first backup straight away.{' '}
                <LearnMoreLink page="backups" />
              </Trans>
            </FormHelperText>
          </FormControl>
        </Grid>
        {backupsEnabled && <BackupForm />}
      </Grid>
    );
  }

  return (
    <SettingsForm
      form={form}
      onSubmit={save}
      isSubmitting={saveMutation.isPending}
    >
      <Stack gap={2} divider={<Divider />}>
        <Stack gap={2}>
          <Typography variant="h2" sx={{ mb: 1 }}>
            <Trans>Server Settings</Trans>
          </Typography>
          <Stack direction={{ sm: 'column', md: 'row' }} gap={2}>
            {!systemState.data.isInContainer && (
              <NumericFormControllerText
                control={control}
                name="server.port"
                TextFieldProps={{
                  label: t`Server port`,
                  fullWidth: true,
                  sx: {
                    width: { sm: '100%', md: '50%' },
                  },
                  helperText: t`The port the Tunarr server listens on. Needs a restart.`,
                }}
              />
            )}
            <Controller
              control={control}
              name="backendUri"
              rules={{ validate: { isValidUrl: (s) => isValidUrl(s, true) } }}
              render={({ field, fieldState: { error } }) => (
                <TextField
                  sx={{
                    width: { sm: '100%', md: '50%' },
                  }}
                  fullWidth
                  label={t`Tunarr server URL`}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          {isLoading ? (
                            <LoadingIcon />
                          ) : !isError ? (
                            <CloudDoneOutlined color="success" />
                          ) : (
                            <CloudOff color="error" />
                          )}
                        </InputAdornment>
                      ),
                    },
                  }}
                  {...field}
                  error={error !== undefined}
                  helperText={
                    error?.type === 'isValidUrl'
                      ? t`Enter a full URL, such as http://192.168.1.10:8000, or leave it empty.`
                      : t`Where this web app reaches the Tunarr server. Leave empty to use the address in your browser.`
                  }
                />
              )}
            />
          </Stack>
        </Stack>
        <Stack gap={1}>
          <Typography variant="h3" sx={{ mb: 1 }}>
            <Trans>Logging</Trans>
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <FormControl
                sx={{
                  width: ['100%', '50%'],
                }}
              >
                <InputLabel id="log-level-label">
                  <Trans>Log Level</Trans>
                </InputLabel>
                <Controller
                  name="logLevel"
                  control={control}
                  render={({ field }) => (
                    <Select
                      labelId="log-level-label"
                      id="log-level"
                      label={t`Log Level`}
                      {...field}
                    >
                      {map(LogLevelChoices, ({ value, description }) => (
                        <MenuItem key={value} value={value}>
                          {description}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                />
                <FormHelperText>
                  <Trans>
                    How much the Tunarr server logs. "Use environment settings"
                    reads <code>TUNARR_LOG_LEVEL</code>, or uses info when it's
                    unset. <LearnMoreLink page="logLevels" />
                  </Trans>
                </FormHelperText>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography sx={{ mb: 1 }}>
                <Trans>Category Log Levels</Trans>
              </Typography>
              <Typography variant="subtitle2">
                <Trans>Log more or less for one area while you debug it.</Trans>
              </Typography>
            </Grid>
            {LogCategorySelectInputs.map((category) => (
              <Grid size={{ xs: 6 }} key={category}>
                <FormControl key={category} fullWidth>
                  <InputLabel id={`${category}-log-level-label`}>
                    {categoryLogLevelLabels[category]}
                  </InputLabel>
                  <Controller
                    name={`logging.categoryLogLevel.${category}`}
                    control={control}
                    render={({ field }) => (
                      <Select
                        labelId={`${category}-log-level-label`}
                        id={`${category}-log-level`}
                        label={categoryLogLevelLabels[category]}
                        {...field}
                      >
                        {map(
                          CategoryLogLevelChoices,
                          ({ value, description }) => (
                            <MenuItem key={value} value={value}>
                              {description}
                            </MenuItem>
                          ),
                        )}
                      </Select>
                    )}
                  />
                  <FormHelperText></FormHelperText>
                </FormControl>
              </Grid>
            ))}
          </Grid>
          <Divider />
          <Box>
            <LogRollForm />
          </Box>
        </Stack>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            <Trans>Backups</Trans>
          </Typography>
          {renderBackupsForm()}
        </Box>
      </Stack>
    </SettingsForm>
  );
}
export type GeneralSettingsFormData = {
  backendUri: string;
  logLevel: LogLevel | 'env';
  // Whether the log file rolls on its schedule. The schedule's fields stay in
  // the form while it is off, and the save leaves them out
  logRollOnSchedule: boolean;
  backup: BackupSettings;
  server: ServerSettings;
  logging: StrictOmit<LoggingSettings, 'categoryLogLevel' | 'logRollConfig'> & {
    // The form always holds a schedule, so its fields always exist
    logRollConfig: StrictOmit<LogRollConfig, 'schedule'> & {
      schedule: Schedule;
    };
    categoryLogLevel?: Record<
      TupleToUnion<typeof LogCategories>,
      LogLevel | 'inherit'
    >;
  };
};

export type GeneralSetingsFormProps = {
  systemSettings: SystemSettings;
};
