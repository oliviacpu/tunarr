import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  channelCaptionLook,
  channelHasOwnCaptionLook,
  normalizeChannelCaptions,
} from '@tunarr/shared/util';
import type { ChannelCaptions } from '@tunarr/types';
import type { CaptionAlignment } from '@tunarr/types/schemas';
import { CaptionAlignments } from '@tunarr/types/schemas';
import { map } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import {
  getApiFfmpegSettingsOptions,
  getApiFfmpegSettingsQueryKey,
} from '../../generated/@tanstack/react-query.gen.ts';
import { putApiFfmpegSettings } from '../../generated/sdk.gen.ts';
import { changedCaptionAppearance } from '../../helpers/channelCaptions.ts';
import { useCaptionAlignmentNames } from '../../hooks/useCaptionAlignmentNames.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import { CaptionAppearanceFields } from '../settings/ffmpeg/CaptionAppearanceFields.tsx';

/**
 * A channel's own closed-caption settings (Channel.captions): its own caption
 * look and its own test pattern, for trying caption options on one channel (a
 * test channel) without changing them for every channel. Copy to all channels
 * makes this channel's look the global one.
 */
export function ChannelCaptionsField() {
  const { t } = useLingui();
  const { control } = useChannelFormContext();
  const alignmentNames = useCaptionAlignmentNames();
  const globalSettings = useQuery(getApiFfmpegSettingsOptions());
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const [confirmCopy, setConfirmCopy] = useState(false);
  // The look's fields are open: a channel with nothing of its own yet shows
  // the global look there, and saves only the fields changed
  const [lookOpen, setLookOpen] = useState(false);

  const copyToAll = useMutation({
    // From the latest settings, not the ones this page loaded, so a change made
    // elsewhere since then isn't undone: neither another setting nor a caption
    // field the channel doesn't set itself
    mutationFn: async (captions: ChannelCaptions | null) => {
      const latest = await queryClient.fetchQuery({
        ...getApiFfmpegSettingsOptions(),
        staleTime: 0,
      });
      const look = channelCaptionLook(latest, captions);
      const { data } = await putApiFfmpegSettings({
        body: {
          ...latest,
          hdhrCaptionAppearance: look.appearance,
          hdhrCaptionAlignment: look.alignment,
        },
        throwOnError: true,
      });
      return data;
    },
    onError: () => {
      snackbar.enqueueSnackbar(t`Couldn't copy the caption look`, {
        variant: 'error',
      });
    },
    onSuccess: () => {
      snackbar.enqueueSnackbar(
        t`Every channel without its own caption look now uses this one`,
        { variant: 'success' },
      );
      return queryClient.invalidateQueries({
        queryKey: getApiFfmpegSettingsQueryKey(),
      });
    },
  });

  const global = globalSettings.data;
  if (!global) {
    return null;
  }

  return (
    <Controller
      control={control}
      name="captions"
      render={({ field }) => {
        const captions = field.value ?? null;
        const showLook = lookOpen || channelHasOwnCaptionLook(captions);
        const look = channelCaptionLook(global, captions);
        const update = (next: ChannelCaptions) =>
          field.onChange(normalizeChannelCaptions(next));
        const resetLook = () => {
          setLookOpen(false);
          update({ testPattern: captions?.testPattern });
        };

        return (
          <Box>
            <Typography variant="h6">
              <Trans>Captions for this channel</Trans>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              <Trans>
                Try closed-caption options on this channel only, without
                changing them for every channel. Needs closed captions turned on
                in the FFmpeg settings, the HLS stream mode and subtitles
                enabled. Applies from the next program.
              </Trans>
            </Typography>
            <FormControl fullWidth>
              <FormControlLabel
                control={
                  <Switch
                    checked={captions?.testPattern === true}
                    onChange={(e) =>
                      update({ ...captions, testPattern: e.target.checked })
                    }
                  />
                }
                label={t`Test pattern on this channel`}
              />
              <FormHelperText>
                <Trans>
                  Replaces this channel's captions with the numbered samples, as
                  the FFmpeg settings' test pattern does for every channel.
                </Trans>
              </FormHelperText>
            </FormControl>
            <FormControl fullWidth sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={showLook}
                    onChange={(e) =>
                      e.target.checked ? setLookOpen(true) : resetLook()
                    }
                  />
                }
                label={t`Use own caption look`}
              />
              <FormHelperText>
                <Trans>
                  The fields show the global look. A setting you change becomes
                  this channel's own; the rest keep following the global look.
                  Off: this channel uses the global look.
                </Trans>
              </FormHelperText>
            </FormControl>
            <Collapse in={showLook} unmountOnExit>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <FormControl fullWidth>
                  <InputLabel id="channel-caption-alignment-label">
                    <Trans>Caption Alignment</Trans>
                  </InputLabel>
                  <Select
                    label={t`Caption Alignment`}
                    labelId="channel-caption-alignment-label"
                    value={look.alignment}
                    onChange={(e) =>
                      update({
                        ...captions,
                        alignment: e.target.value as CaptionAlignment,
                      })
                    }
                  >
                    {map(CaptionAlignments, (alignment) => (
                      <MenuItem key={alignment} value={alignment}>
                        {alignmentNames[alignment]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <CaptionAppearanceFields
                  idPrefix="channel-caption"
                  value={look.appearance}
                  onChange={(appearance) =>
                    update({
                      ...captions,
                      appearance: {
                        ...captions?.appearance,
                        ...changedCaptionAppearance(
                          look.appearance,
                          appearance,
                        ),
                      },
                    })
                  }
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    onClick={() => setConfirmCopy(true)}
                    disabled={copyToAll.isPending}
                  >
                    <Trans>Copy to all channels</Trans>
                  </Button>
                  <Button onClick={resetLook}>
                    <Trans>Reset to global</Trans>
                  </Button>
                </Stack>
              </Stack>
            </Collapse>
            <Dialog open={confirmCopy} onClose={() => setConfirmCopy(false)}>
              <DialogTitle>
                <Trans>Copy this look to all channels?</Trans>
              </DialogTitle>
              <DialogContent>
                <DialogContentText>
                  <Trans>
                    Makes this channel's caption look the global one, used by
                    every channel without its own. Takes effect from each
                    channel's next program.
                  </Trans>
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirmCopy(false)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="contained"
                  onClick={() => {
                    setConfirmCopy(false);
                    copyToAll.mutate(captions);
                  }}
                >
                  <Trans>Copy</Trans>
                </Button>
              </DialogActions>
            </Dialog>
          </Box>
        );
      }}
    />
  );
}
