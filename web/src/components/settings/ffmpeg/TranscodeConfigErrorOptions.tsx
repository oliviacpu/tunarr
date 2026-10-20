import { Trans, useLingui } from '@lingui/react/macro';
import { Grid } from '@mui/material';
import { LearnMoreLink } from '../../base/LearnMoreLink.tsx';
import type { DropdownOption } from '../../../helpers/DropdownOption.ts';
import { useTypedAppFormContext } from '../../../hooks/form.ts';
import type { BaseTranscodeConfigProps } from './BaseTranscodeConfigProps.ts';
import { useBaseTranscodeConfigFormOptions } from './useTranscodeConfigFormOptions.ts';

const supportedErrorScreens = [
  {
    value: 'pic',
    description: 'Default Generic Error Image',
  },
  { value: 'blank', description: 'Blank Screen' },
  { value: 'static', description: 'Static' },
  {
    value: 'testsrc',
    description: 'Test Pattern (color bars + timer)',
  },
  {
    value: 'text',
    description: 'Detailed error (requires ffmpeg with drawtext)',
  },
  {
    value: 'kill',
    description: 'Stop stream, show errors in logs',
  },
] satisfies DropdownOption<string>[];

const supportedErrorAudio = [
  { value: 'whitenoise', description: 'White Noise' },
  { value: 'sine', description: 'Beep' },
  { value: 'silent', description: 'No Audio' },
] satisfies DropdownOption<string>[];

export const TranscodeConfigErrorOptions = ({
  initialConfig,
}: BaseTranscodeConfigProps) => {
  const { t } = useLingui();
  const formOpts = useBaseTranscodeConfigFormOptions(initialConfig);
  const form = useTypedAppFormContext({ ...formOpts });
  return (
    <Grid container spacing={2}>
      <Grid size={{ sm: 12, md: 6 }}>
        <form.AppField
          name="errorScreen"
          children={(field) => (
            <field.BasicSelectInput
              formControlProps={{ sx: { mt: 2 }, fullWidth: true }}
              options={supportedErrorScreens}
              selectProps={{ label: t`Error screen` }}
              helperText={
                <Trans>
                  What a channel shows while a program fails to play. Tunarr
                  tries the program again every 60 seconds.{' '}
                  <LearnMoreLink page="transcodeConfigErrors" />
                </Trans>
              }
            />
          )}
        />
      </Grid>
      <Grid size={{ sm: 12, md: 6 }}>
        <form.AppField
          name="errorScreenAudio"
          children={(field) => (
            <field.BasicSelectInput
              formControlProps={{ sx: { mt: 2 }, fullWidth: true }}
              options={supportedErrorAudio}
              selectProps={{ label: t`Error audio`, fullWidth: true }}
            />
          )}
        />
      </Grid>
    </Grid>
  );
};
