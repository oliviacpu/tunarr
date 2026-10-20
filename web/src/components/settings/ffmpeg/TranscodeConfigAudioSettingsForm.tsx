import { useTypedAppFormContext } from '@/hooks/form.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  FormControl,
  FormHelperText,
  Grid,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import {
  LoudnormConfigSchema,
  type SupportedTranscodeAudioOutputFormats,
} from '@tunarr/types/schemas';
import { useQuery } from '@tanstack/react-query';
import { isNil } from 'lodash-es';
import { useCallback, useMemo, useState } from 'react';
import { getApiFfmpegInfoOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import type { DropdownOption } from '../../../helpers/DropdownOption.ts';
import type { BaseTranscodeConfigProps } from './BaseTranscodeConfigProps.ts';
import { useBaseTranscodeConfigFormOptions } from './useTranscodeConfigFormOptions.ts';

const AudioFormats: DropdownOption<SupportedTranscodeAudioOutputFormats>[] = [
  {
    description: 'AAC',
    value: 'aac',
  },
  {
    description: 'AC3',
    value: 'ac3',
  },
  {
    description: 'MP3',
    value: 'mp3',
  },
  {
    description: 'E-AC3',
    value: 'eac3',
  },
  {
    description: 'Opus (experimental)',
    value: 'libopus',
  },
  {
    description: 'Copy / Passthrough',
    value: 'copy',
  },
] as const;

export const TranscodeConfigAudioSettingsForm = ({
  initialConfig,
  showAdvancedSettings,
}: BaseTranscodeConfigProps) => {
  const { t } = useLingui();
  const ffmpegInfo = useQuery({
    ...getApiFfmpegInfoOptions(),
  });
  const formOpts = useBaseTranscodeConfigFormOptions(initialConfig);
  const form = useTypedAppFormContext({ ...formOpts });
  const [loudnormEnabled, setLoudnormEnabled] = useState(
    !isNil(form.getFieldValue('audioLoudnormConfig')),
  );

  const audioFormatOptions = useMemo(() => {
    const availableEncoders = ffmpegInfo.data?.audioEncoders;

    return AudioFormats.map((option) => {
      if (option.value === 'copy') {
        return option;
      }

      const isSupported = availableEncoders?.find((encoder) => {
        return (
          encoder.ffmpegName === option.value ||
          // 'mp3' is an alias, the actual encoders in ffmpeg are called libmp3lame and libshine
          (option.value === 'mp3' &&
            encoder.name.includes(`(codec ${option.value})`))
        );
      });

      return {
        ...option,
        disabled: ffmpegInfo.isSuccess && !isSupported,
      };
    });
  }, [ffmpegInfo.data?.audioEncoders, ffmpegInfo.isSuccess]);

  const onLoudnormChange = useCallback(
    (enabled: boolean) => {
      setLoudnormEnabled(enabled);
      if (enabled) {
        form.setFieldValue(
          'audioLoudnormConfig',
          LoudnormConfigSchema.decode({}),
        );
      } else {
        form.setFieldValue('audioLoudnormConfig', null);
      }
    },
    [form],
  );

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <form.AppField
            name="audioFormat"
            children={(field) => (
              <field.BasicSelectInput
                formControlProps={{ fullWidth: true }}
                selectProps={{
                  label: t`Audio format`,
                }}
                options={audioFormatOptions}
                helperText={
                  field.form.state.values.audioFormat === 'copy'
                    ? t`Passes the audio through unchanged. The settings below don't apply.`
                    : ''
                }
              />
            )}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <form.Subscribe
            selector={(s) => s.values.audioFormat}
            children={(encoder) => (
              <form.AppField
                name="audioBitRate"
                children={(field) => (
                  <field.BasicTextInput
                    fullWidth
                    label={t`Audio bitrate`}
                    disabled={encoder === 'copy'}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">kbps</InputAdornment>
                        ),
                      },
                    }}
                    helperText={
                      encoder === 'copy'
                        ? t`Not used when audio is copied.`
                        : null
                    }
                  />
                )}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <form.Subscribe
            selector={(s) => s.values.audioFormat}
            children={(encoder) => (
              <form.AppField
                name="audioBufferSize"
                children={(field) => (
                  <field.BasicTextInput
                    fullWidth
                    label={t`Audio buffer size`}
                    disabled={encoder === 'copy'}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">kb</InputAdornment>
                        ),
                      },
                    }}
                    helperText={
                      encoder === 'copy'
                        ? t`Not used when audio is copied.`
                        : null
                    }
                  />
                )}
              />
            )}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <form.Subscribe
            selector={(s) => s.values.audioFormat}
            children={(encoder) => (
              <form.AppField
                name="audioSampleRate"
                children={(field) => (
                  <field.BasicTextInput
                    fullWidth
                    label={t`Audio sample rate`}
                    disabled={encoder === 'copy'}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">kHz</InputAdornment>
                        ),
                      },
                    }}
                    helperText={
                      encoder === 'copy'
                        ? t`Not used when audio is copied.`
                        : null
                    }
                  />
                )}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <form.AppField
            name="audioChannels"
            children={(field) => (
              <field.BasicTextInput fullWidth label={t`Audio channels`} />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <form.AppField
            name="audioVolumePercent"
            children={(field) => (
              <field.BasicTextInput
                fullWidth
                label={t`Audio volume`}
                helperText={t`Changes the output volume (not recommended). Above 100 boosts it.`}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth>
            <InputLabel>
              <Trans>Loudness normalization</Trans>
            </InputLabel>
            <Select
              label={t`Loudness normalization`}
              value={loudnormEnabled ? 'enabled' : 'disabled'}
              onChange={() => onLoudnormChange(!loudnormEnabled)}
            >
              <MenuItem value={'disabled'}>
                <Trans>Disabled</Trans>
              </MenuItem>
              <MenuItem value={'enabled'}>
                <Trans>Enabled (loudnorm)</Trans>
              </MenuItem>
            </Select>
            <FormHelperText>
              <Trans>
                Evens out loudness between programs (
                <Link
                  href="https://en.wikipedia.org/wiki/EBU_R_128"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  EBU R 128
                </Link>
                ). Uses more CPU while streaming.
              </Trans>
            </FormHelperText>
          </FormControl>
        </Grid>
      </Grid>
      {showAdvancedSettings && (
        <form.Subscribe
          children={(state) => {
            const hasOneAdvancedSetting = !!state.values.audioLoudnormConfig;
            if (!hasOneAdvancedSetting) {
              return null;
            }

            return (
              <Stack>
                <Typography component="h6" variant="h6" mb={1}>
                  <Trans>Advanced Audio Options</Trans>
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <Trans>
                    Fine-tune loudness normalization. The defaults suit most
                    programs.
                  </Trans>
                </Typography>
                {!!state.values.audioLoudnormConfig && (
                  <>
                    <Typography sx={{ mb: 1 }}>
                      <Trans>Loudnorm Options</Trans>
                    </Typography>
                    <Stack direction={{ sm: 'column', md: 'row' }} spacing={2}>
                      <form.AppField
                        name="audioLoudnormConfig.i"
                        children={(field) => (
                          <field.BasicTextInput
                            fullWidth
                            label={t`Loudness target`}
                            helperText={t`From -70 to -5 LUFS.`}
                          />
                        )}
                      />
                      <form.AppField
                        name="audioLoudnormConfig.lra"
                        children={(field) => (
                          <field.BasicTextInput
                            fullWidth
                            label={t`Loudness range target`}
                            helperText={t`From 1 to 50 LU.`}
                          />
                        )}
                      />
                      <form.AppField
                        name="audioLoudnormConfig.tp"
                        children={(field) => (
                          <field.BasicTextInput
                            fullWidth
                            label={t`Max true peak`}
                            helperText={t`From -9 to 0 dBTP.`}
                          />
                        )}
                      />
                    </Stack>
                  </>
                )}
              </Stack>
            );
          }}
        />
      )}
    </Stack>
  );
};
