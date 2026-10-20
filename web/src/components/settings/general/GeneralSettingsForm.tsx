import { LearnMoreLink } from '@/components/base/LearnMoreLink.tsx';
import { LoadingIcon } from '@/components/base/LoadingIcon.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import { isValidUrl } from '@/helpers/util.ts';
import {
  useSystemState,
  useUpdateSystemSettings,
} from '@/hooks/useSystemSettings.ts';
import { useVersion } from '@/hooks/useVersion.tsx';
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
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import type {
  LogCategories,
  LoggingSettings,
  TupleToUnion,
} from '@tunarr/types';
import {
  LogLevels,
  type LogLevel,
  type ServerSettings,
  type SystemSettings,
} from '@tunarr/types';
import { type UpdateSystemSettingsRequest } from '@tunarr/types/api';
import { type BackupSettings } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import { map, trim, trimEnd } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useCallback } from 'react';
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import type { StrictOmit } from 'ts-essentials';
import type { SettingsStateInternal } from '../../../store/settings/store.ts';
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

// Loading the page, a successful save and Reset all fill the form from this,
// so every field has the same shape after each of them.
function getDefaultFormValues(
  settings: SettingsStateInternal,
  systemSettings: SystemSettings,
): GeneralSettingsFormData {
  const { logRollConfig } = systemSettings.logging;
  return {
    backendUri: settings.backendUri,
    logLevel: systemSettings.logging.useEnvVarLevel
      ? 'env'
      : systemSettings.logging.logLevel,
    backup: systemSettings.backup,
    server: systemSettings.server,
    logging: {
      ...systemSettings.logging,
      logRollConfig: {
        ...logRollConfig,
        maxFileSizeBytes: logRollConfig.maxFileSizeBytes ?? 0,
        // An increment of 0 renders "Roll on Schedule" unticked. The save
        // handler omits the schedule in that case, because the API requires a
        // positive one.
        schedule: logRollConfig.schedule ?? {
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
  const settings = useSettings();
  const snackbar = useSnackbar();
  const versionInfo = useVersion({
    retry: 0,
  });
  const systemState = useSystemState();

  const { isLoading, isError } = versionInfo;

  const updateSystemSettings = useUpdateSystemSettings();

  const settingsForm = useForm<GeneralSettingsFormData>({
    defaultValues: getDefaultFormValues(settings, systemSettings),
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isValid, isSubmitting },
    watch,
  } = settingsForm;

  const { remove, append } = useFieldArray({
    control,
    name: 'backup.configurations',
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const [backupsValue] = watch(['backup']);
  const backupsEnabled = backupsValue.configurations.length > 0;

  const onSave = (data: GeneralSettingsFormData) => {
    const newBackendUri = trimEnd(trim(data.backendUri), '/');
    setBackendUri(newBackendUri);

    const rollSchedule =
      data.logging.logRollConfig.schedule?.type === 'every' &&
      data.logging.logRollConfig.schedule.increment > 0
        ? data.logging.logRollConfig.schedule
        : undefined;
    const updateReq: UpdateSystemSettingsRequest = {
      logging: {
        logLevel: data.logLevel === 'env' ? undefined : data.logLevel,
        useEnvVarLevel: data.logLevel === 'env',
        logRollConfig: {
          ...data.logging.logRollConfig,
          maxFileSizeBytes: data.logging.logRollConfig.maxFileSizeBytes
            ? Math.max(0, data.logging.logRollConfig.maxFileSizeBytes)
            : undefined,
          schedule: rollSchedule,
        },
        categoryLogLevel: {
          scheduling:
            data.logging.categoryLogLevel?.scheduling === 'inherit'
              ? null
              : data.logging.categoryLogLevel?.scheduling,
          streaming:
            data.logging.categoryLogLevel?.streaming === 'inherit'
              ? null
              : data.logging.categoryLogLevel?.streaming,
        },
      },
      backup: data.backup,
      server: data.server,
    };

    updateSystemSettings.mutate(
      { body: updateReq },
      {
        onSuccess(data) {
          reset(getDefaultFormValues(settings, data), { keepDirty: false });
          snackbar.enqueueSnackbar(t`Settings Saved!`, {
            variant: 'success',
          });
        },
        onError: (err) => {
          console.error(err);
          snackbar.enqueueSnackbar(
            t`Error while saving settings. Please check console for details.`,
            {
              variant: 'error',
            },
          );
        },
      },
    );
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
    <Box component="form" onSubmit={handleSubmit(onSave, console.error)}>
      <FormProvider {...settingsForm}>
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
                      How much the Tunarr server logs. "Use environment
                      settings" reads <code>TUNARR_LOG_LEVEL</code>, or uses
                      info when it's unset. <LearnMoreLink page="logLevels" />
                    </Trans>
                  </FormHelperText>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Typography sx={{ mb: 1 }}>
                  <Trans>Category Log Levels</Trans>
                </Typography>
                <Typography variant="subtitle2">
                  <Trans>
                    Log more or less for one area while you debug it.
                  </Trans>
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
        <Stack
          spacing={2}
          direction="row"
          justifyContent="right"
          sx={{ mt: 2 }}
        >
          {isDirty && (
            <Button
              variant="outlined"
              onClick={() => {
                reset(getDefaultFormValues(settings, systemSettings));
              }}
              // Reset is the way out of an invalid value, so it stays enabled
              disabled={isSubmitting || !isDirty}
            >
              <Trans>Reset Options</Trans>
            </Button>
          )}
          <Button
            variant="contained"
            type="submit"
            disabled={!isValid || isSubmitting || !isDirty}
          >
            <Trans>Save</Trans>
          </Button>
        </Stack>
      </FormProvider>
    </Box>
  );
}
export type GeneralSettingsFormData = {
  backendUri: string;
  logLevel: LogLevel | 'env';
  backup: BackupSettings;
  server: ServerSettings;
  logging: StrictOmit<LoggingSettings, 'categoryLogLevel'> & {
    categoryLogLevel?: Record<
      TupleToUnion<typeof LogCategories>,
      LogLevel | 'inherit'
    >;
  };
};

export type GeneralSetingsFormProps = {
  systemSettings: SystemSettings;
};
