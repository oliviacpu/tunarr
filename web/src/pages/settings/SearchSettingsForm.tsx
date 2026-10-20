import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  getApiSystemSettingsQueryKey,
  putApiSystemSettingsMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { useSystemSettingsSuspense } from '@/hooks/useSystemSettings.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { Chip, Stack, TextField, Typography } from '@mui/material';
import type { SystemSettings } from '@tunarr/types';
import { isEqual } from 'lodash-es';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';

type SearchSettings = SystemSettings['server']['searchSettings'];

function toFormValues(settings: SearchSettings): SearchSettings {
  return { ...settings, maxIndexingMemory: settings.maxIndexingMemory };
}

export function SearchSettingsForm() {
  const { t } = useLingui();
  const { data: systemSettings } = useSystemSettingsSuspense();
  const settings = systemSettings.server.searchSettings;
  const form = useForm<SearchSettings>({
    defaultValues: toFormValues(settings),
    mode: 'onTouched',
  });
  const {
    control,
    reset,
    formState: { defaultValues },
  } = form;

  useEffect(() => {
    const loaded = toFormValues(settings);
    if (!isEqual(loaded, defaultValues)) reset(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const mutation = useSettingsMutation({
    form,
    mutation: putApiSystemSettingsMutation(),
    toFormValues: (saved) => toFormValues(saved.server.searchSettings),
    invalidate: { queryKey: getApiSystemSettingsQueryKey() },
  });

  return (
    <SettingsForm
      form={form}
      onSubmit={(searchSettings) =>
        mutation.mutate({
          body: { server: { ...systemSettings.server, searchSettings } },
        })
      }
      isSubmitting={mutation.isPending}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h3">
            <Trans>Search indexing</Trans>
          </Typography>
          <Chip size="small" label={t`Restart required`} />
        </Stack>
        <NumericFormControllerText
          control={control}
          name="snapshotIntervalHours"
          prettyFieldName={t`Search snapshot interval (hours)`}
          rules={{ min: 1 }}
          TextFieldProps={{
            label: t`Search snapshot interval (hours)`,
            helperText: t`How often the search index is saved to a snapshot.`,
            fullWidth: true,
          }}
        />
        <Controller
          control={control}
          name="maxIndexingMemory"
          rules={{
            min: { value: 0, message: t`Memory limit must be 0 or greater.` },
          }}
          render={({ field, fieldState: { error } }) => (
            <TextField
              {...field}
              value={field.value ?? ''}
              type="number"
              onChange={(event) =>
                field.onChange(
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value),
                )
              }
              label={t`Indexing memory limit (bytes)`}
              helperText={
                error?.message ??
                t`Leave empty to use Meilisearch's default. TUNARR_SEARCH_MAX_MEMORY takes precedence.`
              }
              error={error !== undefined}
              fullWidth
            />
          )}
        />
      </Stack>
    </SettingsForm>
  );
}
