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
import { useQuery } from '@tanstack/react-query';
import {
  LoudnormConfigSchema,
  type SupportedTranscodeAudioOutputFormats,
} from '@tunarr/types/schemas';
import { useCallback, useId, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { getApiFfmpegInfoOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import type { SelectOption } from '../../util/TypedController.tsx';
import {
  NumericFormControllerText,
  SelectFormController,
} from '../../util/TypedController.tsx';
import { useTranscodeConfigFormContext } from './useTranscodeConfigForm.ts';

const AudioFormats: SelectOption<SupportedTranscodeAudioOutputFormats>[] = [
  {
    label: 'AAC',
    value: 'aac',
  },
  {
    label: 'AC3',
    value: 'ac3',
  },
  {
    label: 'MP3',
    value: 'mp3',
  },
  {
    label: 'E-AC3',
    value: 'eac3',
  },
  {
    label: 'Opus (experimental)',
    value: 'libopus',
  },
  {
    label: 'Copy / Passthrough',
    value: 'copy',
  },
];

type Props = {
  showAdvancedSettings: boolean;
};

export const TranscodeConfigAudioSettingsForm = ({
  showAdvancedSettings,
}: Props) => {
  const { t } = useLingui();
  const ffmpegInfo = useQuery({
    ...getApiFfmpegInfoOptions(),
  });
  const { control, setValue } = useTranscodeConfigFormContext();
  const [audioFormat, audioLoudnormConfig] = useWatch({
    control,
    name: ['audioFormat', 'audioLoudnormConfig'],
  });
  const loudnormEnabled = audioLoudnormConfig !== null;
  const isCopy = audioFormat === 'copy';
  const loudnormLabelId = useId();

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
      setValue(
        'audioLoudnormConfig',
        enabled ? LoudnormConfigSchema.decode({}) : null,
        { shouldDirty: true, shouldValidate: true },
      );
    },
    [setValue],
  );

  const notUsedWhenCopied = isCopy ? t`Not used when audio is copied.` : null;
  const loudnormFields = [
    {
      name: 'audioLoudnormConfig.i',
      label: t`Loudness target`,
      helperText: t`From -70 to -5 LUFS.`,
    },
    {
      name: 'audioLoudnormConfig.lra',
      label: t`Loudness range target`,
      helperText: t`From 1 to 50 LU.`,
    },
    {
      name: 'audioLoudnormConfig.tp',
      label: t`Max true peak`,
      helperText: t`From -9 to 0 dBTP.`,
    },
  ] as const;

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <SelectFormController
            control={control}
            name="audioFormat"
            label={t`Audio format`}
            options={audioFormatOptions}
            helperText={
              isCopy
                ? t`Passes the audio through unchanged. The settings below don't apply.`
                : undefined
            }
            TextFieldProps={{ fullWidth: true }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <NumericFormControllerText
            control={control}
            rawValue
            name="audioBitRate"
            prettyFieldName={t`Audio bitrate`}
            TextFieldProps={{
              fullWidth: true,
              label: t`Audio bitrate`,
              disabled: isCopy,
              slotProps: {
                input: {
                  endAdornment: (
                    <InputAdornment position="end">kbps</InputAdornment>
                  ),
                },
              },
              helperText: notUsedWhenCopied,
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <NumericFormControllerText
            control={control}
            rawValue
            name="audioBufferSize"
            prettyFieldName={t`Audio buffer size`}
            TextFieldProps={{
              fullWidth: true,
              label: t`Audio buffer size`,
              disabled: isCopy,
              slotProps: {
                input: {
                  endAdornment: (
                    <InputAdornment position="end">kb</InputAdornment>
                  ),
                },
              },
              helperText: notUsedWhenCopied,
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <NumericFormControllerText
            control={control}
            rawValue
            name="audioSampleRate"
            prettyFieldName={t`Audio sample rate`}
            TextFieldProps={{
              fullWidth: true,
              label: t`Audio sample rate`,
              disabled: isCopy,
              slotProps: {
                input: {
                  endAdornment: (
                    <InputAdornment position="end">kHz</InputAdornment>
                  ),
                },
              },
              helperText: notUsedWhenCopied,
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <NumericFormControllerText
            control={control}
            rawValue
            name="audioChannels"
            prettyFieldName={t`Audio channels`}
            TextFieldProps={{
              fullWidth: true,
              label: t`Audio channels`,
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <NumericFormControllerText
            control={control}
            rawValue
            name="audioVolumePercent"
            prettyFieldName={t`Audio volume`}
            TextFieldProps={{
              fullWidth: true,
              label: t`Audio volume`,
              helperText: t`Changes the output volume (not recommended). Above 100 boosts it.`,
              slotProps: {
                input: {
                  endAdornment: (
                    <InputAdornment position="end">%</InputAdornment>
                  ),
                },
              },
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth>
            <InputLabel id={loudnormLabelId}>
              <Trans>Loudness normalization</Trans>
            </InputLabel>
            <Select
              labelId={loudnormLabelId}
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
      {showAdvancedSettings && loudnormEnabled && (
        <Stack>
          <Typography component="h6" variant="h6" mb={1}>
            <Trans>Advanced Audio Options</Trans>
          </Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            <Trans>
              Fine-tune loudness normalization. The defaults suit most programs.
            </Trans>
          </Typography>
          <Typography sx={{ mb: 1 }}>
            <Trans>Loudnorm Options</Trans>
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {loudnormFields.map(({ name, label, helperText }) => (
              <NumericFormControllerText
                key={name}
                control={control}
                name={name}
                rawValue
                prettyFieldName={label}
                TextFieldProps={{ fullWidth: true, label, helperText }}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};
