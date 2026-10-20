import { AppliesWhen } from '@/components/settings/AppliesWhen.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { SwitchFormController } from '@/components/util/TypedController.tsx';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { FeatureFlagsApplicationGroups } from '@tunarr/types';
import { isEqual, pick } from 'lodash-es';
import { useEffect } from 'react';
import type { Control, SubmitHandler } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import {
  getApiSettingsFeatureFlagsOptions,
  getApiSettingsFeatureFlagsQueryKey,
  putApiSettingsFeatureFlagsMutation,
} from '../../generated/@tanstack/react-query.gen.ts';
import type { GetApiSettingsFeatureFlagsResponse } from '../../generated/types.gen.ts';
import { featureFlagMessages } from './featureFlagMessages.ts';

type FlagFormValues = GetApiSettingsFeatureFlagsResponse['flags'];
type FlagKey = keyof FlagFormValues;

type MetaEntry = GetApiSettingsFeatureFlagsResponse['metadata'][number];
type FlagMeta = MetaEntry & { key: FlagKey };

// The server describes each flag; one this page has no value for is left out
function isFlagMeta(meta: MetaEntry, flags: FlagFormValues): meta is FlagMeta {
  return Object.prototype.hasOwnProperty.call(flags, meta.key);
}

function FlagSection({
  title,
  flags,
  control,
}: {
  title: string;
  flags: FlagMeta[];
  control: Control<FlagFormValues>;
}) {
  const { i18n } = useLingui();
  if (flags.length === 0) return null;

  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        {title}
      </Typography>
      <Stack spacing={2}>
        {flags.map((meta) => {
          const messages = featureFlagMessages[meta.key];
          const timing = FeatureFlagsApplicationGroups[meta.key];
          return (
            <Stack
              key={meta.key}
              direction="row"
              alignItems="flex-start"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <SwitchFormController
                control={control}
                name={meta.key}
                label={
                  messages ? i18n._(messages.displayName) : meta.displayName
                }
                helperText={
                  messages ? i18n._(messages.description) : meta.description
                }
                // The environment variable wins over the saved value
                disabled={meta.envOverride}
              />
              {timing !== undefined && <AppliesWhen setting={timing} />}
              {meta.envOverride && (
                <Chip
                  label={<Trans>Set by environment variable</Trans>}
                  size="small"
                  sx={{ mt: 1 }}
                />
              )}
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

type FlagGroup = 'playback' | 'captions-audio' | 'experimental';

const flagGroups: Partial<Record<FlagKey, FlagGroup>> = {
  tonemapEnabled: 'playback',
  disableVulkan: 'playback',
  disableVaapiPad: 'playback',
  webvttSidecarEnabled: 'captions-audio',
};

export default function FeaturesSettingsPage({
  group = 'experimental',
  onDirtyChange,
}: {
  group?: FlagGroup;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { t } = useLingui();
  const query = useQuery(getApiSettingsFeatureFlagsOptions());
  if (query.isPending)
    return (
      <Skeleton
        variant="rounded"
        height={80}
        aria-label={t`Loading optional features`}
      />
    );
  if (query.data === undefined)
    return (
      <Alert
        severity="warning"
        action={
          <Button onClick={() => void query.refetch()}>
            <Trans>Try again</Trans>
          </Button>
        }
      >
        <Trans>Optional feature settings could not be loaded.</Trans>
      </Alert>
    );
  return (
    <>
      {query.isError && (
        <Alert
          severity="warning"
          action={
            <Button onClick={() => void query.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          }
        >
          <Trans>
            Optional feature settings could not be refreshed. Your unsaved edits
            are kept.
          </Trans>
        </Alert>
      )}
      <FeatureFlagsForm
        data={query.data}
        group={group}
        onDirtyChange={onDirtyChange}
      />
    </>
  );
}

function FeatureFlagsForm({
  data,
  group,
  onDirtyChange,
}: {
  data: GetApiSettingsFeatureFlagsResponse;
  group: FlagGroup;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { t } = useLingui();
  const form = useForm<FlagFormValues>({ defaultValues: data.flags });
  const {
    control,
    reset,
    formState: { defaultValues, isDirty },
  } = form;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Load the saved flags into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight
  useEffect(() => {
    if (!isEqual(data.flags, defaultValues)) {
      reset(data.flags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiSettingsFeatureFlagsMutation(),
    toFormValues: (saved) => saved.flags,
    invalidate: { queryKey: getApiSettingsFeatureFlagsQueryKey() },
  });

  const save: SubmitHandler<FlagFormValues> = (flags) => {
    saveMutation.mutate({
      body: pick(
        flags,
        metadata.map((meta) => meta.key),
      ),
    });
  };

  const metadata = data.metadata.filter(
    (meta): meta is FlagMeta =>
      isFlagMeta(meta, data.flags) &&
      (flagGroups[meta.key] ?? 'experimental') === group,
  );
  const experimental = metadata.filter((m) => m.category === 'experimental');
  const escapeHatches = metadata.filter((m) => m.category === 'escape-hatch');

  return (
    <SettingsForm
      form={form}
      guardNavigation={onDirtyChange === undefined}
      onSubmit={save}
      isSubmitting={saveMutation.isPending}
    >
      <Stack spacing={4}>
        <FlagSection
          title={
            group === 'experimental'
              ? t`Experimental features`
              : t`Optional features`
          }
          flags={experimental}
          control={control}
        />
        <FlagSection
          title={t`Escape hatches`}
          flags={escapeHatches}
          control={control}
        />
      </Stack>
    </SettingsForm>
  );
}
