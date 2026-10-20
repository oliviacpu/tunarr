import { Trans, useLingui } from '@lingui/react/macro';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormHelperText from '@mui/material/FormHelperText';
import TextField from '@mui/material/TextField';
import { Controller } from 'react-hook-form';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import { HelpTooltip } from '../base/HelpTooltip.tsx';
import { NumericFormController } from '../util/TypedController.tsx';

export default function ChannelEpgConfig() {
  const { t } = useLingui();
  const { control } = useChannelFormContext();

  return (
    <>
      <Box>
        <FormGroup>
          <Controller
            name="stealth"
            control={control}
            render={({ field }) => (
              <FormControl>
                <FormControlLabel
                  control={<Checkbox {...field} checked={field.value} />}
                  label={t`Stealth mode`}
                />
                <FormHelperText>
                  <Trans>
                    Hides the channel from the guide, the HDHomeRun tuner and
                    the M3U playlist. You can still stream it directly or
                    redirect to it.
                  </Trans>
                </FormHelperText>
              </FormControl>
            )}
          />

          <Controller
            control={control}
            name="guideFlexTitle"
            render={({ field }) => (
              <TextField
                helperText={t`What the guide shows during flex time. Leave empty to show the channel name.`}
                label={t`Guide title for flex`}
                margin="normal"
                {...field}
                value={field.value ?? ''}
              />
            )}
          />

          <NumericFormController
            control={control}
            name="guideMinimumDuration"
            render={({ field, formState: { errors } }) => (
              <TextField
                label={t`Shortest program in the guide (seconds)`}
                helperText={
                  errors?.guideMinimumDuration?.message ?? (
                    <>
                      {t`Programs this short or shorter show as flex in the guide. 0 shows every program.`}
                      <HelpTooltip
                        about={t`Shortest program in the guide (seconds)`}
                      >
                        {t`The guide merges them into the program before, or shows a run of them as one flex block. A very large value shows only flex.`}
                      </HelpTooltip>
                    </>
                  )
                }
                margin="normal"
                {...field}
              />
            )}
          />
        </FormGroup>
      </Box>
    </>
  );
}
