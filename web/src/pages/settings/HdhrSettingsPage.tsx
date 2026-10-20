import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  FormControl,
  FormControlLabel,
  FormHelperText,
  Stack,
} from '@mui/material';
import type { HdhrSettings } from '@tunarr/types';
import { defaultHdhrSettings } from '@tunarr/types';
import { isEqual } from 'lodash-es';
import { useEffect } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { useForm, useWatch } from 'react-hook-form';
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
  const { data } = useHdhrSettings();

  const form = useForm<HdhrSettings>({
    defaultValues: defaultHdhrSettings,
    // Save turns off as soon as a value stops being valid; a field says why
    // once it has been left
    mode: 'onTouched',
  });
  const {
    reset,
    control,
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

  const values = useWatch({ control });

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiHdhrSettingsMutation(),
    toFormValues: (saved) => saved,
    invalidate: { queryKey: getApiHdhrSettingsQueryKey() },
  });

  const save: SubmitHandler<HdhrSettings> = (settings) => {
    saveMutation.mutate({ body: settings });
  };

  return (
    <SettingsForm
      form={form}
      onSubmit={save}
      isSubmitting={saveMutation.isPending}
      onRestoreDefaults={
        isEqual(values, defaultHdhrSettings)
          ? undefined
          : () => reset(defaultHdhrSettings, { keepDefaultValues: true })
      }
    >
      <Stack spacing={2}>
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
      </Stack>
    </SettingsForm>
  );
}
