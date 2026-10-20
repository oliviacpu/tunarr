import { AppliesWhen } from '@/components/settings/AppliesWhen.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, VisibilityOff } from '@mui/icons-material';
import {
  Box,
  Divider,
  Grid,
  Stack,
  TextField,
  ToggleButton,
  Typography,
} from '@mui/material';
import { useEffect, useRef } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import useStore from '../../../store/index.ts';
import { setShowAdvancedSettings } from '../../../store/settings/actions.ts';
import Breadcrumbs from '../../Breadcrumbs.tsx';
import { LearnMoreLink } from '../../base/LearnMoreLink.tsx';
import { NumericFormControllerText } from '../../util/TypedController.tsx';
import { TranscodeConfigAdvancedOptions } from './TranscodeConfigAdvancedOptions.tsx';
import { TranscodeConfigAudioSettingsForm } from './TranscodeConfigAudioSettingsForm.tsx';
import { TranscodeConfigCheckbox } from './TranscodeConfigCheckbox.tsx';
import { TranscodeConfigErrorOptions } from './TranscodeConfigErrorOptions.tsx';
import { TranscodeConfigVideoSettingsForm } from './TranscodeConfigVideoSettingsForm.tsx';
import type { TranscodeConfigFormValues } from './useTranscodeConfigForm.ts';
import { useTranscodeConfigForm } from './useTranscodeConfigForm.ts';

type Props = {
  initialConfig: TranscodeConfigFormValues;
  isNew?: boolean;
};

export const TranscodeConfigSettingsForm = ({
  initialConfig,
  isNew = false,
}: Props) => {
  const { t } = useLingui();
  const showAdvancedSettings = useStore(
    (s) => s.settings.ui.showAdvancedSettings,
  );
  const { form, save, isSaving } = useTranscodeConfigForm({
    initialConfig,
    isNew,
  });
  const { control } = form;
  const hardwareAccelerationMode = useWatch({
    control,
    name: 'hardwareAccelerationMode',
  });
  const configName = initialConfig.name;

  // A create moves to the new config's page when it is saved, which would
  // drop anything changed meanwhile, so nothing can change until then. A
  // disabled fieldset stops the native inputs; `inert` also stops the
  // selects, which are not native controls. React 18 has no `inert` prop
  const creating = isNew && isSaving;
  const fieldsRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    fieldsRef.current?.toggleAttribute('inert', creating);
  }, [creating]);

  return (
    <SettingsForm form={form} onSubmit={save} isSubmitting={isSaving}>
      <Breadcrumbs />
      <AppliesWhen setting="transcodeConfigs" />
      <Box
        component="fieldset"
        ref={fieldsRef}
        disabled={creating}
        aria-busy={creating}
        sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
      >
        <Stack spacing={2} divider={<Divider />}>
          <Stack direction={'row'}>
            <Typography variant="h4">
              {isNew ? (
                <Trans>New transcode config</Trans>
              ) : (
                <Trans>Edit transcode config: "{configName}"</Trans>
              )}
            </Typography>
            <ToggleButton
              value={showAdvancedSettings}
              selected={showAdvancedSettings}
              onChange={() => setShowAdvancedSettings(!showAdvancedSettings)}
              sx={{ ml: 'auto' }}
            >
              {showAdvancedSettings ? (
                <VisibilityOff sx={{ mr: 0.5 }} />
              ) : (
                <Check sx={{ mr: 0.5 }} />
              )}{' '}
              {showAdvancedSettings ? (
                <Trans>Hide Advanced</Trans>
              ) : (
                <Trans>Show Advanced</Trans>
              )}
            </ToggleButton>
          </Stack>
          <Box>
            <Typography variant="h5" sx={{ mb: 2 }}>
              <Trans>General</Trans>
            </Typography>
            <Grid container columnSpacing={2}>
              <Grid size={{ sm: 12, md: 6 }}>
                <Controller
                  control={control}
                  name="name"
                  render={({ field, fieldState: { error } }) => (
                    <TextField
                      fullWidth
                      label={t`Name`}
                      {...field}
                      error={error !== undefined}
                      helperText={error?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={{ sm: 12, md: 6 }}>
                <NumericFormControllerText
                  control={control}
                  rawValue
                  name="threadCount"
                  prettyFieldName={t`Threads`}
                  TextFieldProps={{
                    label: t`Threads`,
                    fullWidth: true,
                    helperText: (
                      <Trans>
                        CPU threads FFmpeg may use; 0 lets FFmpeg decide.
                        Hardware decoding always uses one decoding thread.{' '}
                        <LearnMoreLink page="transcodeConfigGeneral" />
                      </Trans>
                    ),
                  }}
                />
              </Grid>
              <Grid size={12}>
                <TranscodeConfigCheckbox
                  name="disableChannelOverlay"
                  label={t`Disable watermarks`}
                  helperText={
                    <Trans>Channels using this config show no watermark.</Trans>
                  }
                />
              </Grid>
            </Grid>
          </Box>

          <Stack spacing={2}>
            <Typography component="h5" variant="h5">
              <Trans>Video Options</Trans>
            </Typography>
            <TranscodeConfigVideoSettingsForm />
            {showAdvancedSettings && hardwareAccelerationMode !== 'none' && (
              <Box>
                <Typography component="h6" variant="h6" mb={1}>
                  <Trans>Advanced Video Options</Trans>
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <Trans>
                    Change these only to work around a hardware problem or to
                    debug a stream.{' '}
                    <LearnMoreLink page="transcodeConfigAdvanced" />
                  </Trans>
                </Typography>
                <TranscodeConfigAdvancedOptions />
              </Box>
            )}
          </Stack>
          <Box>
            <Typography component="h5" variant="h5" sx={{ mb: 2 }}>
              <Trans>Audio Options</Trans>
            </Typography>
            <TranscodeConfigAudioSettingsForm
              showAdvancedSettings={showAdvancedSettings}
            />
          </Box>
          <Box>
            <Typography component="h6" variant="h6" sx={{ pb: 1 }}>
              <Trans>Error Options</Trans>
            </Typography>
            <TranscodeConfigErrorOptions />
          </Box>
        </Stack>
      </Box>
    </SettingsForm>
  );
};
