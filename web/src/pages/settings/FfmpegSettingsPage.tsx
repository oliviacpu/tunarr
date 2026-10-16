import { useSystemState } from '@/hooks/useSystemSettings.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { ExpandMore } from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Link as MuiLink,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FfmpegSettings,
  TranscodeConfig,
  TupleToUnion,
} from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import type { TonemapAlgorithm } from '@tunarr/types/schemas';
import {
  CaptionAlignments,
  FfmpegLogLevels,
  TonemapAlgorithms,
} from '@tunarr/types/schemas';
import { capitalize, isEmpty, isEqual, isNull, map, some } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import UnsavedNavigationAlert from '../../components/settings/UnsavedNavigationAlert.tsx';

import { DeleteConfirmationDialog } from '@/components/DeleteConfirmationDialog.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import { LanguagePreferencesList } from '@/components/LanguagePreferencesList';
import type { DeepRequired } from 'ts-essentials';
import { CaptionAppearanceFields } from '../../components/settings/ffmpeg/CaptionAppearanceFields.tsx';
import { TranscodeConfigsTable } from '../../components/settings/ffmpeg/TranscodeConfigsTable.tsx';
import {
  deleteApiTranscodeConfigsByIdMutation,
  getApiFfmpegInfoOptions,
  getApiFfmpegInfoQueryKey,
  getApiFfmpegSettingsQueryKey,
  getApiVersionQueryKey,
  putApiFfmpegSettingsMutation,
} from '../../generated/@tanstack/react-query.gen.ts';
import { useFfmpegSettings } from '../../hooks/settingsHooks.ts';
import { useCaptionAlignmentNames } from '../../hooks/useCaptionAlignmentNames.ts';

const FfmpegLogOptions = ['disable', 'console', 'file'] as const;
type FfmpegLogOptions = TupleToUnion<typeof FfmpegLogOptions>;

type FfmpegFormValues = DeepRequired<Omit<FfmpegSettings, 'configVersion'>>;

const TonemapAlgorithmNames: Record<TonemapAlgorithm, string> = {
  hable: 'Hable',
  bt2390: 'BT.2390',
  mobius: 'Möbius',
  reinhard: 'Reinhard',
};

export default function FfmpegSettingsPage() {
  const { t } = useLingui();
  const { data: ffmpegSettings, error } = useFfmpegSettings();
  const ffmpegInfo = useQuery({
    ...getApiFfmpegInfoOptions(),
  });

  const queryClient = useQueryClient();
  const systemState = useSystemState();

  const [confirmDeleteTranscodeConfig, setConfirmDeleteTranscodeConfig] =
    useState<TranscodeConfig | null>(null);

  const {
    reset,
    setValue,
    control,
    formState: { isDirty, isValid, isSubmitting },
    handleSubmit,
    watch,
  } = useForm<FfmpegFormValues>({
    defaultValues: {
      ...defaultFfmpegSettings,
      ...ffmpegSettings,
      transcodeDirectory: ffmpegSettings.transcodeDirectory ?? '',
    },
  });

  const [ffmpegConsoleLoggingEnabled, ffmpegFileLoggingEnabled] = watch([
    'enableLogging',
    'enableFileLogging',
  ]);
  const hdhrClosedCaptions = watch('hdhrClosedCaptions');

  const captionAlignmentNames = useCaptionAlignmentNames();

  let logSelectValue: FfmpegLogOptions = 'disable';
  if (ffmpegFileLoggingEnabled) {
    logSelectValue = 'file';
  } else if (ffmpegConsoleLoggingEnabled) {
    logSelectValue = 'console';
  }

  const handleFfmpegLogChange = (value: string) => {
    let logValue: FfmpegLogOptions;
    if (!FfmpegLogOptions.some((v) => v === value)) {
      logValue = 'disable';
    } else {
      logValue = value as FfmpegLogOptions;
    }

    if (logValue === logSelectValue) {
      return;
    }

    switch (logValue) {
      case 'disable':
        setValue('enableLogging', false, { shouldDirty: true });
        setValue('enableFileLogging', false, { shouldDirty: true });
        break;
      case 'console':
        setValue('enableLogging', true, { shouldDirty: true });
        setValue('enableFileLogging', false, { shouldDirty: true });
        break;
      case 'file':
        setValue('enableLogging', false, { shouldDirty: true });
        setValue('enableFileLogging', true, { shouldDirty: true });
        break;
    }
  };

  const [restoreTunarrDefaults, setRestoreTunarrDefaults] = useState(false);

  const snackbar = useSnackbar();

  const updateFfmpegSettingsMutation = useMutation({
    ...putApiFfmpegSettingsMutation(),
    // mutationFn: apiClient.updateFfmpegSettings,
    onSuccess: (data) => {
      setRestoreTunarrDefaults(false);
      snackbar.enqueueSnackbar(t`Settings Saved!`, {
        variant: 'success',
      });
      reset(data, { keepValues: true });
      return queryClient.invalidateQueries({
        predicate(query) {
          return some(
            [
              getApiFfmpegSettingsQueryKey(),
              getApiFfmpegInfoQueryKey(),
              getApiVersionQueryKey(),
            ],
            (key) => isEqual(query.queryKey, key),
          );
        },
      });
    },
  });

  const deleteTranscodeConfig = useMutation({
    ...deleteApiTranscodeConfigsByIdMutation(),
    // mutationFn: (id: string) =>
    //   apiClient.deleteTranscodeConfig(undefined, { params: { id } }),
  });

  const updateFfmpegSettings: SubmitHandler<
    Omit<FfmpegSettings, 'configVersion'>
  > = (data) => {
    updateFfmpegSettingsMutation.mutate({
      body: {
        configVersion: defaultFfmpegSettings.configVersion,
        ...data,
      },
    });
  };

  if (error || ffmpegInfo.isPending || ffmpegInfo.isError) {
    return <div></div>;
  }

  return (
    <Box component="form" onSubmit={handleSubmit(updateFfmpegSettings)}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        <Trans>Global Options</Trans>
      </Typography>
      <Stack spacing={3} useFlexGap sx={{ mb: 2 }}>
        {!systemState.data.isInContainer && (
          <>
            <FormControl fullWidth>
              <Controller
                control={control}
                name="ffmpegExecutablePath"
                render={({ field }) => (
                  <TextField
                    id="ffmpeg-executable-path"
                    label={t`FFmpeg Executable Path`}
                    helperText={t`FFmpeg version 7.1+ recommended. Check your current version in the sidebar`}
                    {...field}
                  />
                )}
              />
            </FormControl>
            <FormControl fullWidth>
              <Controller
                control={control}
                name="ffprobeExecutablePath"
                render={({ field }) => (
                  <TextField
                    id="ffprobe-executable-path"
                    label={t`FFprobe Executable Path`}
                    helperText={t`FFprobe version 6.0+ recommended. Check your current version in the sidebar`}
                    {...field}
                  />
                )}
              />
            </FormControl>
          </>
        )}
        <Stack spacing={2} useFlexGap>
          <Stack spacing={2} direction={{ sm: 'column', md: 'row' }}>
            <FormControl sx={{ flexBasis: '50%' }}>
              <InputLabel id="ffmpeg-logging-label">
                <Trans>FFMPEG Log Method</Trans>
              </InputLabel>
              <Select<(typeof FfmpegLogOptions)[number]>
                labelId="ffmpeg-logging-label"
                id="ffmpeg-logging"
                label={t`FFMPEG Log Method`}
                value={logSelectValue}
                onChange={(e: SelectChangeEvent<FfmpegLogOptions>) =>
                  handleFfmpegLogChange(e.target.value)
                }
              >
                <MenuItem value="disable">
                  <Trans>Disabled</Trans>
                </MenuItem>
                <MenuItem value="console">
                  <Trans>Console</Trans>
                </MenuItem>
                <MenuItem value="file">
                  <Trans>File</Trans>
                </MenuItem>
              </Select>

              <FormHelperText>
                <Trans>
                  Enable ffmpeg logging to different sinks. Outputting to a file
                  will create a new log file for every spawned ffmpeg process in
                  the Tunarr log directory. These files are automatically
                  cleaned up by a background process.
                </Trans>
              </FormHelperText>
            </FormControl>
            {logSelectValue !== 'disable' && (
              <FormControl sx={{ flex: 1 }}>
                <InputLabel id="ffmpeg-logging-level">
                  <Trans>FFMPEG Log Level</Trans>
                </InputLabel>
                <Controller
                  control={control}
                  name="logLevel"
                  render={({ field }) => (
                    <Select
                      labelId="ffmpeg-logging-level"
                      id="ffmpeg-logging-level"
                      label={t`FFMPEG Log Level`}
                      {...field}
                    >
                      {map(FfmpegLogLevels, (level) => (
                        <MenuItem key={level} value={level}>
                          {capitalize(level)}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                />

                <FormHelperText>
                  <Trans>
                    Log level to pass to ffmpeg. Read more about ffmpeg's log
                    levels{' '}
                    <MuiLink
                      target="_blank"
                      href="https://ffmpeg.org/ffmpeg.html#:~:text=%2Dloglevel%20%5Bflags%2B%5Dloglevel%20%7C%20%2Dv%20%5Bflags%2B%5Dloglevel"
                    >
                      here
                    </MuiLink>
                  </Trans>
                </FormHelperText>
              </FormControl>
            )}
          </Stack>
        </Stack>
        <FormControl sx={{ flexBasis: { xs: '100%', md: '50%' } }}>
          <InputLabel id="hls-direct-output-format-label">
            <Trans>HLS Direct Output Format</Trans>
          </InputLabel>
          <Controller
            control={control}
            name="hlsDirectOutputFormat"
            render={({ field }) => (
              <Select
                id="hls-direct-output-format"
                label={t`HLS Direct Output Format`}
                labelId="hls-direct-output-format-label"
                {...field}
              >
                <MenuItem value="mkv">MKV</MenuItem>
                <MenuItem value="mp4">MP4</MenuItem>
                <MenuItem value="mpegts">MPEG-TS</MenuItem>
              </Select>
            )}
          />
          <FormHelperText>
            <Trans>
              Channels configured to use the HLS Direct stream mode will output
              in the selected container format.
            </Trans>
          </FormHelperText>
        </FormControl>
        <FormControl sx={{ flexBasis: { xs: '100%', md: '50%' } }}>
          <InputLabel id="tonemap-algorithm-label">
            <Trans>HDR Tone-map Curve</Trans>
          </InputLabel>
          <Controller
            control={control}
            name="tonemapAlgorithm"
            render={({ field }) => (
              <Select
                id="tonemap-algorithm"
                label={t`HDR Tone-map Curve`}
                labelId="tonemap-algorithm-label"
                {...field}
              >
                {map(TonemapAlgorithms, (algorithm) => (
                  <MenuItem key={algorithm} value={algorithm}>
                    {TonemapAlgorithmNames[algorithm]}
                  </MenuItem>
                ))}
              </Select>
            )}
          />
          <FormHelperText>
            <Trans>
              How HDR programs are converted to SDR when HDR Tonemapping is
              enabled. Hable is filmic and a little darker. BT.2390, the
              broadcast standard, is brighter and closer to the source. Takes
              effect from the next program. BT.2390 needs jellyfin-ffmpeg; other
              ffmpeg builds use Hable instead.
            </Trans>
          </FormHelperText>
        </FormControl>
        <Stack spacing={2} direction={{ sm: 'column', md: 'row' }}>
          <NumericFormControllerText
            control={control}
            name="hlsSegmentSeconds"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              label: t`HLS Segment Length (seconds)`,
              fullWidth: true,
              helperText: t`Length of each segment for channels in the HLS stream mode. Shorter segments let a channel start sooner. Applies when a channel's stream next starts.`,
            }}
          />
          <NumericFormControllerText
            control={control}
            name="hlsInitialSegmentCount"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              label: t`Segments Before Playback`,
              fullWidth: true,
              helperText: t`How many segments must be ready before a client gets an HLS channel's playlist.`,
            }}
          />
          <NumericFormControllerText
            control={control}
            name="hlsTsInitialBurstSeconds"
            rules={{ min: 0, max: 60 }}
            TextFieldProps={{
              label: t`MPEG-TS Start-up Burst (seconds)`,
              fullWidth: true,
              helperText: t`How far ahead an HLS channel's .ts stream (what HDHomeRun clients such as Plex read) may send at start, instead of real-time pace from the first byte. 0 turns it off.`,
            }}
          />
        </Stack>
        <FormControl fullWidth>
          <Controller
            control={control}
            name="transcodeDirectory"
            render={({ field }) => (
              <TextField
                id="ffmpeg-transcode-path"
                label={t`FFmpeg Transcode Path`}
                helperText={
                  <Trans>
                    <span>
                      Configure the directory where Tunarr writes HLS segment
                      files when transcoding. Tunarr will create the target
                      directory (but not intermediate directories) if it doesn't
                      exist.
                      <br />
                      Changing this field will only affect new sessions.
                      Existing sessions will continue writing to the previous
                      setting, but will clean out segments when the segment
                      ends.
                      <br />
                      When unset, Tunarr will write segments to its current
                      working directory.
                    </span>
                  </Trans>
                }
                {...field}
              />
            )}
          />
        </FormControl>
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Typography variant="h5" sx={{ mb: 2 }}>
        <Trans>Audio &amp; Subtitle Options</Trans>
      </Typography>
      <Stack spacing={3} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">
            <Trans>Subtitles</Trans>
          </Typography>
          <FormControl fullWidth>
            <Controller
              control={control}
              name="enableSubtitleExtraction"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label={t`Enable embedded subtitle extraction`}
                />
              )}
            />

            <FormHelperText>
              <Trans>
                Enabling embedded subtitle extaction will periodically scan your
                upcoming programming for embedded text-based subtitle streams
                and extract them to a local cache. This is necessary in order to
                enable subtitle burning for text-based subtitles which are not
                external streams.
              </Trans>
            </FormHelperText>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <Controller
              control={control}
              name="hdhrClosedCaptions"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label={t`Closed captions for HDHomeRun clients (Plex)`}
                />
              )}
            />

            <FormHelperText>
              <Trans>
                Sends a program's full text subtitles as closed captions in the
                stream HDHomeRun clients such as Plex Live TV read, so viewers
                can switch them on and off. Instead of being burned in, those
                subtitles also reach Tunarr's own players as selectable
                subtitles. Forced and image-based subtitles stay burned in.
                Applies to channels in the HLS stream mode with subtitles
                enabled, from the next program.
              </Trans>
            </FormHelperText>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="hdhr-caption-alignment-label">
              <Trans>Caption Alignment</Trans>
            </InputLabel>
            <Controller
              control={control}
              name="hdhrCaptionAlignment"
              render={({ field }) => (
                <Select
                  id="hdhr-caption-alignment"
                  label={t`Caption Alignment`}
                  labelId="hdhr-caption-alignment-label"
                  {...field}
                  disabled={!hdhrClosedCaptions}
                >
                  {map(CaptionAlignments, (alignment) => (
                    <MenuItem key={alignment} value={alignment}>
                      {captionAlignmentNames[alignment]}
                    </MenuItem>
                  ))}
                </Select>
              )}
            />
            <FormHelperText>
              <Trans>
                Where closed caption lines sit across the screen. Italics,
                underline and top-of-screen placement follow the subtitle file.
                Text size, font and background are up to the player: Plex Live
                TV draws captions in its own style, sized by the Plex app's
                subtitle size setting. Takes effect from the next program.
              </Trans>
            </FormHelperText>
          </FormControl>
          <Accordion
            disableGutters
            disabled={!hdhrClosedCaptions}
            sx={{ mt: 2 }}
          >
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>
                <Trans>Caption appearance (experimental)</Trans>
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  <Trans>
                    Everything closed captions can ask for. A player may ignore
                    some of it: Plex draws captions itself, and an earlier test
                    showed it ignoring see-through boxes. Turn on the test
                    pattern below to see what your player shows. Changes take
                    effect from the next program.
                  </Trans>
                </Typography>
                <Controller
                  control={control}
                  name="hdhrCaptionAppearance"
                  render={({ field }) => (
                    <CaptionAppearanceFields
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
                <FormControl fullWidth>
                  <Controller
                    control={control}
                    name="hdhrCaptionTestPattern"
                    render={({ field }) => (
                      <FormControlLabel
                        control={<Switch {...field} checked={field.value} />}
                        label={t`Test pattern`}
                      />
                    )}
                  />
                  <FormHelperText>
                    <Trans>
                      Replaces every program's captions with 39 numbered
                      samples, one per feature above, each saying what it should
                      look like. Turn captions on in your player, note the
                      numbers that look wrong, then turn this off. Your settings
                      above don't change the samples.
                    </Trans>
                  </FormHelperText>
                </FormControl>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Box>

        <Divider />
        <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
          <Trans>Audio Language Preferences</Trans>
        </Typography>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          <Trans>Configure preferred audio languages globally.</Trans>
        </Typography>
        <FormControl fullWidth>
          <Controller
            control={control}
            name="languagePreferences.preferences"
            rules={{
              validate: {
                minLength: (v) =>
                  isEmpty(v)
                    ? t`Must define at least one language preference`
                    : undefined,
              },
            }}
            render={({ field, fieldState: { error } }) => (
              <LanguagePreferencesList
                preferences={
                  field.value ?? [
                    { iso6391: 'en', iso6392: 'eng', displayName: 'English' },
                  ]
                }
                onChange={field.onChange}
                error={error}
              />
            )}
          />
        </FormControl>
      </Stack>
      <Stack spacing={2} direction="row" justifyContent="right">
        {(isDirty || (isDirty && !isSubmitting) || restoreTunarrDefaults) && (
          <Button
            variant="outlined"
            onClick={() => {
              reset(ffmpegSettings);
              setRestoreTunarrDefaults(false);
            }}
          >
            <Trans>Reset Changes</Trans>
          </Button>
        )}
        <Button
          variant="contained"
          disabled={
            !isValid || isSubmitting || (!isDirty && !restoreTunarrDefaults)
          }
          type="submit"
        >
          <Trans>Save</Trans>
        </Button>
      </Stack>
      <Divider sx={{ mt: 2 }} />

      <Typography variant="h5" sx={{ mt: 2, mb: 1 }}>
        <Trans>Transcoding Configs</Trans>
      </Typography>
      <Typography variant="subtitle1">
        <Trans>
          Configure transcoding settings for Tunarr's streams. Each channel is
          assigned one transcode configuration.
        </Trans>
      </Typography>
      <TranscodeConfigsTable />
      <UnsavedNavigationAlert isDirty={isDirty} />
      <DeleteConfirmationDialog
        open={!isNull(confirmDeleteTranscodeConfig)}
        title={t`Delete Transcoding Config "${confirmDeleteTranscodeConfig?.name}"?`}
        body={t`All channels assigned to this config will be set to use the default configuration. If this is the last configuration, a new default configuration will be created.`}
        onConfirm={() =>
          deleteTranscodeConfig.mutate({
            path: { id: confirmDeleteTranscodeConfig!.id },
          })
        }
        onClose={() => setConfirmDeleteTranscodeConfig(null)}
        dialogProps={{
          maxWidth: 'sm',
          fullWidth: true,
        }}
      />
    </Box>
  );
}
