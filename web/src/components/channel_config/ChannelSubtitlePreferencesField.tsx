import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { Controller } from 'react-hook-form';
import { languageBy3LetterCode } from '../../helpers/language.ts';
import { useFfmpegSettings } from '../../hooks/settingsHooks.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import { ChannelSubtitlePreferencesTable } from './ChannelSubtitlePreferencesTable.tsx';

export function ChannelSubtitlePreferencesField() {
  const { t } = useLingui();
  const { control, watch } = useChannelFormContext();
  const { data: settings } = useFfmpegSettings();
  const [mode, subtitlesEnabled, streamMode] = watch([
    'subtitlePreferenceMode',
    'subtitlesEnabled',
    'streamMode',
  ]);
  const filters = {
    any: t`Any`,
    default: t`Default`,
    forced: t`Forced`,
    none: t`None (skip this row)`,
  };

  return (
    <Stack spacing={2}>
      {!subtitlesEnabled && (
        <Alert severity="info">
          <Trans>
            Subtitles are disabled for this channel. These preferences are
            saved, but do not enable subtitles.
          </Trans>
        </Alert>
      )}
      <FormControl fullWidth>
        <InputLabel id="channel-subtitle-preferences-label">
          <Trans>Subtitle preferences</Trans>
        </InputLabel>
        <Controller
          control={control}
          name="subtitlePreferenceMode"
          render={({ field }) => (
            <Select
              {...field}
              labelId="channel-subtitle-preferences-label"
              label={t`Subtitle preferences`}
            >
              <MenuItem value="inherit">
                <Trans>Use global defaults</Trans>
              </MenuItem>
              <MenuItem value="custom">
                <Trans>Customize for this channel</Trans>
              </MenuItem>
            </Select>
          )}
        />
        <FormHelperText>
          <Trans>
            Global defaults follow the saved Captions &amp; audio settings.
            Switching modes keeps this channel's custom preferences.
          </Trans>
        </FormHelperText>
      </FormControl>
      {mode === 'inherit' ? (
        <Box>
          <Typography variant="h6">
            <Trans>Current global subtitle defaults</Trans>
          </Typography>
          {settings.subtitlePreferences.length === 0 ? (
            <Typography variant="body2">
              <Trans>
                No global preferences. This channel keeps its stream mode's
                existing subtitle fallback.
              </Trans>
            </Typography>
          ) : (
            <Box component="ol" sx={{ pl: 3, my: 1 }}>
              {settings.subtitlePreferences.map((preference, index) => (
                <Box component="li" key={index} sx={{ mb: 1 }}>
                  <Typography variant="body2">
                    {languageBy3LetterCode[preference.languageCode] ??
                      preference.languageCode}
                    {' — '}
                    {filters[preference.filter]}
                    {'; '}
                    {preference.allowExternal
                      ? t`External allowed`
                      : t`External excluded`}
                    {'; '}
                    {preference.allowImageBased
                      ? t`Image based allowed`
                      : t`Image based excluded`}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            <Trans>
              Saved global changes apply to future stream selections. A program
              already playing keeps its selected subtitles.
            </Trans>
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          <Typography>
            <Trans>
              Uses only this channel's preferences. An empty list keeps this
              stream mode's existing subtitle fallback; it does not use global
              defaults.
            </Trans>
          </Typography>
          <ChannelSubtitlePreferencesTable />
        </Stack>
      )}
      <Typography variant="body2" color="text.secondary">
        {streamMode === 'hls_direct_v2' ? (
          <Trans>
            HLS Direct v2 supports text subtitles only. Allowing image based
            subtitles here does not make them available in this mode.
          </Trans>
        ) : (
          <Trans>
            Preferences choose tracks; embedded text may need extraction before
            it is available. Burn-in, closed captions and WebVTT still depend on
            stream mode and playback settings.
          </Trans>
        )}
      </Typography>
    </Stack>
  );
}
