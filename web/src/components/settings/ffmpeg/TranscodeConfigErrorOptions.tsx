import { Trans, useLingui } from '@lingui/react/macro';
import { Grid } from '@mui/material';
import type { TranscodeConfig } from '@tunarr/types';
import { LearnMoreLink } from '../../base/LearnMoreLink.tsx';
import type { SelectOption } from '../../util/TypedController.tsx';
import { SelectFormController } from '../../util/TypedController.tsx';
import { useTranscodeConfigFormContext } from './useTranscodeConfigForm.ts';

export const TranscodeConfigErrorOptions = () => {
  const { t } = useLingui();
  const supportedErrorScreens: SelectOption<TranscodeConfig['errorScreen']>[] =
    [
      {
        value: 'pic',
        label: t`Default Generic Error Image`,
      },
      { value: 'blank', label: t`Blank Screen` },
      { value: 'static', label: t`Static` },
      {
        value: 'testsrc',
        label: t`Test Pattern (color bars + timer)`,
      },
      {
        value: 'text',
        label: t`Detailed error (requires ffmpeg with drawtext)`,
      },
      {
        value: 'kill',
        label: t`Stop stream, show errors in logs`,
      },
    ];

  const supportedErrorAudio: SelectOption<
    TranscodeConfig['errorScreenAudio']
  >[] = [
    { value: 'whitenoise', label: t`White Noise` },
    { value: 'sine', label: t`Beep` },
    { value: 'silent', label: t`No Audio` },
  ];

  const { control } = useTranscodeConfigFormContext();
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SelectFormController
          control={control}
          name="errorScreen"
          label={t`Error screen`}
          options={supportedErrorScreens}
          TextFieldProps={{ fullWidth: true, sx: { mt: 2 } }}
          helperText={
            <Trans>
              What a channel shows while a program fails to play. Tunarr tries
              the program again every 60 seconds.{' '}
              <LearnMoreLink page="transcodeConfigErrors" />
            </Trans>
          }
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SelectFormController
          control={control}
          name="errorScreenAudio"
          label={t`Error audio`}
          options={supportedErrorAudio}
          TextFieldProps={{ fullWidth: true, sx: { mt: 2 } }}
        />
      </Grid>
    </Grid>
  );
};
