import { useActions, useToasts, withReason } from '@/strings/actions';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  Stack,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HdhrSettings } from '@tunarr/types';
import { defaultHdhrSettings } from '@tunarr/types';
import { isEqual } from 'lodash-es';
import { useSnackbar } from 'notistack';
import React, { useEffect } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import UnsavedNavigationAlert from '../../components/settings/UnsavedNavigationAlert.tsx';
import {
  CheckboxFormController,
  NumericFormControllerText,
} from '../../components/util/TypedController.tsx';
import {
  getApiHdhrSettingsQueryKey,
  putApiHdhrSettingsMutation,
} from '../../generated/@tanstack/react-query.gen.ts';
import { useHdhrSettings } from '../../hooks/settingsHooks.ts';

export default function HdhrSettingsPage() {
  const { t } = useLingui();
  const actions = useActions();
  const toasts = useToasts();
  const [restoreTunarrDefaults, setRestoreTunarrDefaults] =
    React.useState<boolean>(false);

  const { data } = useHdhrSettings();

  const {
    reset,
    control,
    formState: { isDirty, isValid, isSubmitting, defaultValues },
    handleSubmit,
  } = useForm<HdhrSettings>({
    defaultValues: defaultHdhrSettings,
    mode: 'onBlur',
  });

  useEffect(() => {
    if (data) {
      reset(data);
    }
  }, [data, reset]);

  const snackbar = useSnackbar();
  const queryClient = useQueryClient();

  const updateHdhrSettingsMutation = useMutation({
    ...putApiHdhrSettingsMutation(),
    onSuccess: (data) => {
      snackbar.enqueueSnackbar(toasts.saved, {
        variant: 'success',
      });
      setRestoreTunarrDefaults(false);
      reset(data, { keepValues: true });
      return queryClient.invalidateQueries({
        queryKey: getApiHdhrSettingsQueryKey(),
      });
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      snackbar.enqueueSnackbar(
        withReason(toasts.couldNotSaveSettings, message),
        {
          variant: 'error',
        },
      );
    },
  });

  const updateHdhrSettings: SubmitHandler<HdhrSettings> = (
    data: HdhrSettings,
  ) => {
    updateHdhrSettingsMutation.mutate({
      body: {
        ...data,
      },
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(updateHdhrSettings)}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth>
          <FormControlLabel
            control={
              <CheckboxFormController
                control={control}
                name="autoDiscoveryEnabled"
              />
            }
            label={t`Network discovery`}
          />
          <FormHelperText>
            <Trans>
              Announces Tunarr as an HDHomeRun tuner on your network (SSDP), so
              Plex and other apps find it. Needs a restart.
            </Trans>
          </FormHelperText>
        </FormControl>
      </Grid>
      <NumericFormControllerText
        control={control}
        name="tunerCount"
        prettyFieldName={t`Tuner count`}
        // The server refuses fewer than 1 tuner
        rules={{ min: 1 }}
        TextFieldProps={{
          id: 'tuner-count',
          label: t`Tuner count`,
          helperText: t`How many tuners Tunarr reports to HDHomeRun clients. Plex plays at most this many channels at once.`,
          fullWidth: true,
          variant: 'filled',
        }}
      />
      <UnsavedNavigationAlert isDirty={isDirty} />
      <Stack spacing={2} direction="row" sx={{ mt: 2 }}>
        <Stack
          spacing={2}
          direction="row"
          justifyContent="left"
          sx={{ mt: 2, flexGrow: 1 }}
        >
          {!isEqual(defaultValues, defaultHdhrSettings) && (
            <Button
              variant="outlined"
              onClick={() => {
                reset(defaultHdhrSettings);
                setRestoreTunarrDefaults(true);
              }}
            >
              {actions.restoreDefaults}
            </Button>
          )}
        </Stack>
        <Stack spacing={2} direction="row" justifyContent="right">
          {isDirty && (
            <Button
              variant="outlined"
              onClick={() => {
                reset(data);
                setRestoreTunarrDefaults(false);
              }}
            >
              {actions.resetChanges}
            </Button>
          )}
          <Button
            variant="contained"
            disabled={
              !isValid || isSubmitting || (!isDirty && !restoreTunarrDefaults)
            }
            type="submit"
          >
            {actions.save}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
