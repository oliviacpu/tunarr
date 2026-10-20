import { Trans, useLingui } from '@lingui/react/macro';
import {
  InputAdornment,
  MenuItem,
  Link as MuiLink,
  Stack,
  TextField,
} from '@mui/material';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { SupportedTranscodeVideoOutputFormat } from '@tunarr/types';
import type { SupportedHardwareAccels } from '@tunarr/types/schemas';
import { useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { getApiFfmpegInfoOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import { TranscodeResolutionOptions } from '../../../helpers/constants.ts';
import {
  resolutionFromAnyString,
  resolutionToString,
} from '../../../helpers/util.ts';
import { HelpTooltip } from '../../base/HelpTooltip.tsx';
import type { SelectOption } from '../../util/TypedController.tsx';
import {
  NumericFormControllerText,
  SelectFormController,
} from '../../util/TypedController.tsx';
import { TranscodeConfigCheckbox } from './TranscodeConfigCheckbox.tsx';
import { useTranscodeConfigFormContext } from './useTranscodeConfigForm.ts';

const VideoFormats: SelectOption<SupportedTranscodeVideoOutputFormat>[] = [
  {
    label: 'H.264',
    value: 'h264',
  },
  {
    label: 'HEVC (H.265)',
    value: 'hevc',
  },
  {
    label: 'MPEG-2',
    value: 'mpeg2video',
  },
];

const VideoHardwareAccelerationOptions: SelectOption<SupportedHardwareAccels>[] =
  [
    {
      label: 'Software (no GPU)',
      value: 'none',
    },
    {
      label: 'Nvidia (CUDA)',
      value: 'cuda',
    },
    {
      label: 'Video Acceleration API (VA-API)',
      value: 'vaapi',
    },
    {
      label: 'Intel QuickSync',
      value: 'qsv',
    },
    {
      label: 'VideoToolbox',
      value: 'videotoolbox',
    },
  ];

// libx264/libx265 presets offered for software encoding, fastest first. The server uses veryfast when the config has
// none (or an unknown one), so an empty value is shown as veryfast.
const VideoPresetOptions: SelectOption<string>[] = [
  { label: 'ultrafast', value: 'ultrafast' },
  { label: 'superfast', value: 'superfast' },
  { label: 'veryfast (default)', value: 'veryfast' },
  { label: 'faster', value: 'faster' },
  { label: 'fast', value: 'fast' },
  { label: 'medium', value: 'medium' },
  { label: 'slow', value: 'slow' },
  { label: 'slower', value: 'slower' },
  { label: 'veryslow', value: 'veryslow' },
];

// The preset the server will use for a saved one. The saved value is kept
// until another preset is picked
const displayedVideoPreset = (preset: string | null) =>
  VideoPresetOptions.find(({ value }) => value === preset)?.value ?? 'veryfast';

export const TranscodeConfigVideoSettingsForm = () => {
  const { t } = useLingui();
  const ffmpegInfo = useSuspenseQuery({
    ...getApiFfmpegInfoOptions(),
  });
  const { control } = useTranscodeConfigFormContext();
  const [hardwareAccelerationMode, videoFormat] = useWatch({
    control,
    name: ['hardwareAccelerationMode', 'videoFormat'],
  });

  const hardwareAccelerationOptions = useMemo(() => {
    return VideoHardwareAccelerationOptions.filter(
      ({ value }) =>
        value === 'none' ||
        ffmpegInfo.data.hardwareAccelerationTypes.includes(value),
    );
  }, [ffmpegInfo.data.hardwareAccelerationTypes]);

  return (
    <Stack spacing={2}>
      <SelectFormController
        control={control}
        name="videoFormat"
        label={t`Video format`}
        options={VideoFormats}
      />
      <SelectFormController
        control={control}
        name="hardwareAccelerationMode"
        label={t`Hardware acceleration`}
        options={hardwareAccelerationOptions}
      />
      {(hardwareAccelerationMode === 'qsv' ||
        hardwareAccelerationMode === 'vaapi') && (
        <Controller
          control={control}
          name="vaapiDevice"
          render={({ field }) => (
            <TextField
              fullWidth
              label={
                hardwareAccelerationMode === 'qsv'
                  ? t`QSV Device`
                  : t`VA-API Device`
              }
              {...field}
              value={field.value ?? ''}
              helperText={
                <Trans>
                  Override the default{' '}
                  {hardwareAccelerationMode === 'qsv' ? 'QSV' : 'VA-API'} device
                  path (defaults to <code>/dev/dri/renderD128</code> on Linux
                  and blank otherwise)
                </Trans>
              }
            />
          )}
        />
      )}

      {hardwareAccelerationMode === 'none' &&
        (videoFormat === 'h264' || videoFormat === 'hevc') && (
          <Controller
            control={control}
            name="videoPreset"
            render={({ field }) => (
              <TextField
                select
                label={t`Video preset`}
                name={field.name}
                value={displayedVideoPreset(field.value)}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                inputRef={field.ref}
                helperText={
                  <>
                    {t`How hard the software encoder works per frame. Faster presets use less CPU but need a higher bitrate for the same quality.`}
                    <HelpTooltip about={t`Video preset`}>
                      {t`HLS and HLS Alt channels keep the settings their stream started with, so a change applies once everyone stops watching and the stream starts again. HLS Direct and MPEG-TS channels pick it up from the next program.`}
                    </HelpTooltip>
                  </>
                }
              >
                {VideoPresetOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        )}

      <Controller
        control={control}
        name="resolution"
        render={({ field }) => (
          <TextField
            select
            label={t`Resolution`}
            name={field.name}
            // The form holds the width and height; the options are WxH
            value={resolutionToString(field.value)}
            onChange={(e) => {
              const resolution = resolutionFromAnyString(e.target.value);
              if (resolution !== undefined) {
                field.onChange(resolution);
              }
            }}
            onBlur={field.onBlur}
            inputRef={field.ref}
          >
            {TranscodeResolutionOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.description}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <Stack direction={{ sm: 'column', md: 'row' }} spacing={2} useFlexGap>
        <NumericFormControllerText
          control={control}
          name="videoBitRate"
          prettyFieldName={t`Video bitrate`}
          TextFieldProps={{
            fullWidth: true,
            label: t`Video bitrate`,
            slotProps: {
              input: {
                endAdornment: (
                  <InputAdornment position="end">kbps</InputAdornment>
                ),
              },
            },
          }}
        />
        <NumericFormControllerText
          control={control}
          name="videoBufferSize"
          prettyFieldName={t`Video buffer size`}
          TextFieldProps={{
            fullWidth: true,
            label: t`Video buffer size`,
            slotProps: {
              input: {
                endAdornment: (
                  <InputAdornment position="end">kb</InputAdornment>
                ),
              },
            },
            helperText: (
              <Trans>
                A smaller buffer holds the bitrate more strictly; a larger one
                lets it vary more.{' '}
                <MuiLink
                  target="_blank"
                  rel="noopener noreferrer"
                  href="https://trac.ffmpeg.org/wiki/Limiting%20the%20output%20bitrate#Whatdoes-bufsizedo"
                >
                  How the buffer works
                </MuiLink>
              </Trans>
            ),
          }}
        />
      </Stack>
      <Stack gap={1} direction={{ sm: 'column', md: 'row' }}>
        <TranscodeConfigCheckbox
          name="deinterlaceVideo"
          label={t`Auto deinterlace video`}
          helperText={t`Deinterlaces programs whose video is interlaced, such as TV recordings.`}
        />
        <TranscodeConfigCheckbox
          name="normalizeFrameRate"
          label={t`Normalize frame rate`}
          helperText={t`Output video at a constant frame rate.`}
        />
      </Stack>
    </Stack>
  );
};
