import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import type { ChannelStreamMode } from '@tunarr/types';
import { Controller } from 'react-hook-form';
import { useTranscodeConfigs } from '../../hooks/settingsHooks.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import useStore from '../../store/index.ts';
import { LearnMoreLink } from '../base/LearnMoreLink.tsx';
import { RouterLink } from '../base/RouterLink.tsx';
import { ChannelAudioTracksField } from './ChannelAudioTracksField.tsx';
import { ChannelCaptionsField } from './ChannelCaptionsField.tsx';
import { ChannelSubtitlePreferencesField } from './ChannelSubtitlePreferencesField.tsx';

export default function ChannelTranscodingConfig() {
  const { t } = useLingui();
  const ChannelStreamModeOptions: {
    value: ChannelStreamMode;
    label: string;
  }[] = [
    {
      value: 'hls',
      label: t`HLS (recommended)`,
    },
    {
      value: 'hls_slower',
      label: t`HLS Alt`,
    },
    {
      value: 'hls_direct_v2',
      label: t`HLS Direct v2`,
    },
    {
      value: 'hls_direct',
      label: t`HLS Direct`,
    },
    {
      value: 'mpegts',
      label: t`MPEG-TS (legacy)`,
    },
  ] as const;

  const channel = useStore((s) => s.channelEditor.currentEntity);
  const transcodeConfigs = useTranscodeConfigs();
  const { control, watch } = useChannelFormContext();
  const streamMode = watch('streamMode');

  return (
    channel && (
      <Stack divider={<Divider />} gap={2}>
        <Box>
          <Typography sx={{ mb: 1 }} variant="h5">
            <Trans>Transcoding Settings</Trans>
          </Typography>
          <Typography variant="subtitle1">
            <Trans>
              Override the global transcoding settings for this channel.
            </Trans>
          </Typography>
          <Stack direction={{ sm: 'column', md: 'row' }} useFlexGap spacing={2}>
            <FormControl margin="normal">
              <InputLabel>{t`Stream mode`}</InputLabel>
              <Controller
                control={control}
                name="streamMode"
                render={({ field }) => (
                  <Select<ChannelStreamMode> label={t`Stream mode`} {...field}>
                    {ChannelStreamModeOptions.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                )}
              />
              <FormHelperText>
                <Trans>
                  How Tunarr builds this channel's video stream.{' '}
                  <LearnMoreLink page="channelStreamMode" />
                </Trans>
              </FormHelperText>
            </FormControl>
            <FormControl margin="normal">
              <InputLabel>{t`Transcode config`}</InputLabel>
              <Controller
                control={control}
                name="transcodeConfigId"
                render={({ field }) => (
                  <Select<string> label={t`Transcode config`} {...field}>
                    {transcodeConfigs.data.map((opt) => (
                      <MenuItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </MenuItem>
                    ))}
                  </Select>
                )}
              />
              <FormHelperText>
                <Trans>
                  The video and audio settings this channel uses. Edit them
                  under{' '}
                  <RouterLink to="/settings/playback">
                    Settings › Playback
                  </RouterLink>
                  .
                </Trans>
              </FormHelperText>
            </FormControl>
          </Stack>
        </Box>
        <Stack gap={1}>
          <Stack>
            <Typography sx={{ mb: 1 }} variant="h5">
              <Trans>Audio &amp; Subtitles</Trans>
            </Typography>
            <Typography variant="subtitle1">
              <Trans>
                Choose a fixed audio output layout and subtitle preferences for
                this channel.
              </Trans>
            </Typography>
            <Divider sx={{ my: 2 }} />
            <ChannelAudioTracksField
              disabled={streamMode === 'hls_direct_v2'}
            />
            <FormControlLabel
              label={t`Enable subtitles`}
              sx={{
                width: 'auto',
              }}
              control={
                <Controller
                  control={control}
                  name="subtitlesEnabled"
                  render={({ field }) => (
                    <Switch {...field} checked={field.value} />
                  )}
                />
              }
            />
            <Divider sx={{ my: 2 }} />
            <ChannelSubtitlePreferencesField />
            <Divider sx={{ my: 2 }} />
            <ChannelCaptionsField />
          </Stack>
        </Stack>
      </Stack>
    )
  );
}
