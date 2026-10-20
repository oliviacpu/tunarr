import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { useSystemState } from '@/hooks/useSystemSettings.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { ExpandMore } from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
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
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FfmpegSettings, TupleToUnion } from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import type { TonemapAlgorithm } from '@tunarr/types/schemas';
import {
  CaptionAlignments,
  FfmpegLogLevels,
  TonemapAlgorithms,
} from '@tunarr/types/schemas';
import { capitalize, isEmpty, isEqual, map, some } from 'lodash-es';
import { useSnackbar } from 'notistack';
import type { SubmitHandler } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import UnsavedNavigationAlert from '../../components/settings/UnsavedNavigationAlert.tsx';

import { HelpTooltip } from '@/components/base/HelpTooltip.tsx';
import { LearnMoreLink } from '@/components/base/LearnMoreLink.tsx';
import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import { LanguagePreferencesList } from '@/components/LanguagePreferencesList';
import type { DeepRequired } from 'ts-essentials';
import { CaptionAppearanceFields } from '../../components/settings/ffmpeg/CaptionAppearanceFields.tsx';
import { TranscodeConfigsTable } from '../../components/settings/ffmpeg/TranscodeConfigsTable.tsx';
import {
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

// What probing the configured ffmpeg found. It loads on its own, so a slow or
// failed probe never hides the paths that fix it
function FfmpegProbeStatus({ isInContainer }: { isInContainer: boolean }) {
  const { t } = useLingui();
  const ffmpegInfo = useQuery({
    ...getApiFfmpegInfoOptions(),
  });

  // Saving invalidates this query but keeps the old data, so a re-probe has to
  // show as probing too; isFetching covers the first load and refetches
  if (ffmpegInfo.isFetching) {
    return <Skeleton variant="rounded" height={48} />;
  }

  // The server answers with no encoders when it can't run ffmpeg at all
  if (
    ffmpegInfo.isError ||
    ffmpegInfo.data === undefined ||
    (isEmpty(ffmpegInfo.data.videoEncoders) &&
      isEmpty(ffmpegInfo.data.audioEncoders))
  ) {
    const reason = ffmpegInfo.isError
      ? getApiErrorMessage(ffmpegInfo.error)
      : undefined;
    return (
      <Alert severity="warning">
        {isInContainer
          ? t`FFmpeg could not be probed.`
          : t`FFmpeg could not be probed. Check that the FFmpeg executable path below points to a working ffmpeg, then save.`}
        {reason !== undefined && (
          <Box component="span" sx={{ display: 'block', mt: 1 }}>
            {reason}
          </Box>
        )}
      </Alert>
    );
  }

  const { hardwareAccelerationTypes } = ffmpegInfo.data;
  const supported = hardwareAccelerationTypes.join(', ');
  return (
    <Typography variant="body2" color="text.secondary">
      {isEmpty(hardwareAccelerationTypes)
        ? t`FFmpeg is working. It reports no hardware acceleration.`
        : t`FFmpeg is working. Hardware acceleration it supports: ${supported}`}
    </Typography>
  );
}

export default function FfmpegSettingsPage() {
  const { t } = useLingui();
  const { data: ffmpegSettings } = useFfmpegSettings();

  const queryClient = useQueryClient();
  const systemState = useSystemState();

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

  const snackbar = useSnackbar();

  const updateFfmpegSettingsMutation = useMutation({
    ...putApiFfmpegSettingsMutation(),
    // mutationFn: apiClient.updateFfmpegSettings,
    onSuccess: (data) => {
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
    onError: (error) => {
      const message = getApiErrorMessage(error);
      snackbar.enqueueSnackbar(
        message !== undefined
          ? t`Could not save settings. ${message}`
          : t`Could not save settings`,
        { variant: 'error' },
      );
    },
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

  return (
    <Box component="form" onSubmit={handleSubmit(updateFfmpegSettings)}>
      <Typography variant="h2" sx={{ mb: 2 }}>
        <Trans>Global Options</Trans>
      </Typography>
      <Stack spacing={3} useFlexGap sx={{ mb: 2 }}>
        <FfmpegProbeStatus isInContainer={systemState.data.isInContainer} />
        {!systemState.data.isInContainer && (
          <>
            <FormControl fullWidth>
              <Controller
                control={control}
                name="ffmpegExecutablePath"
                render={({ field }) => (
                  <TextField
                    id="ffmpeg-executable-path"
                    label={t`FFmpeg executable path`}
                    helperText={t`Use FFmpeg 7.1 or later. The sidebar shows your current version.`}
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
                    label={t`FFprobe executable path`}
                    helperText={t`Use FFprobe 6.0 or later. It usually sits in the same folder as FFmpeg.`}
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
                <Trans>FFmpeg logging</Trans>
              </InputLabel>
              <Select<(typeof FfmpegLogOptions)[number]>
                labelId="ffmpeg-logging-label"
                id="ffmpeg-logging"
                label={t`FFmpeg logging`}
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
                  Where FFmpeg writes its log. File gives each FFmpeg process
                  its own log in the Tunarr log folder, deleted automatically.{' '}
                  <LearnMoreLink page="ffmpegLogging" />
                </Trans>
              </FormHelperText>
            </FormControl>
            {logSelectValue !== 'disable' && (
              <FormControl sx={{ flex: 1 }}>
                <InputLabel id="ffmpeg-logging-level">
                  <Trans>FFmpeg log level</Trans>
                </InputLabel>
                <Controller
                  control={control}
                  name="logLevel"
                  render={({ field }) => (
                    <Select
                      labelId="ffmpeg-logging-level"
                      id="ffmpeg-logging-level"
                      label={t`FFmpeg log level`}
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
                    How much detail FFmpeg logs. See{' '}
                    <MuiLink
                      target="_blank"
                      rel="noopener noreferrer"
                      href="https://ffmpeg.org/ffmpeg.html#:~:text=%2Dloglevel%20%5Bflags%2B%5Dloglevel%20%7C%20%2Dv%20%5Bflags%2B%5Dloglevel"
                    >
                      FFmpeg's log levels
                    </MuiLink>
                    .
                  </Trans>
                </FormHelperText>
              </FormControl>
            )}
          </Stack>
        </Stack>
        <FormControl sx={{ flexBasis: { xs: '100%', md: '50%' } }}>
          <InputLabel id="hls-direct-output-format-label">
            <Trans>HLS Direct output format</Trans>
          </InputLabel>
          <Controller
            control={control}
            name="hlsDirectOutputFormat"
            render={({ field }) => (
              <Select
                id="hls-direct-output-format"
                label={t`HLS Direct output format`}
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
              The container format for channels in the HLS Direct stream mode.
            </Trans>
          </FormHelperText>
        </FormControl>
        <FormControl sx={{ flexBasis: { xs: '100%', md: '50%' } }}>
          <InputLabel id="tonemap-algorithm-label">
            <Trans>HDR tone-map curve</Trans>
          </InputLabel>
          <Controller
            control={control}
            name="tonemapAlgorithm"
            render={({ field }) => (
              <Select
                id="tonemap-algorithm"
                label={t`HDR tone-map curve`}
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
              How HDR programs become SDR when HDR Tonemapping is on under
              Features. Applies from the next program.
            </Trans>
            <HelpTooltip about={t`HDR tone-map curve`}>
              <Trans>
                Hable is filmic and a little darker. BT.2390, the broadcast
                standard, is brighter and closer to the source. BT.2390 needs
                jellyfin-ffmpeg; other FFmpeg builds use Hable instead.
              </Trans>
            </HelpTooltip>
          </FormHelperText>
        </FormControl>
        <NumericFormControllerText
          control={control}
          name="hlsReadAheadMaxThreads"
          rules={{ min: 0, max: 256 }}
          TextFieldProps={{
            label: t`Read-ahead thread limit`,
            helperText: (
              <>
                {t`Lets HLS use up to this many encoder threads while it prepares video ahead of playback. 0 turns this off. Applies from the next program.`}
                <HelpTooltip about={t`Read-ahead thread limit`}>
                  {t`It only raises a transcode config's thread count, never lowers it, and stays within the CPU cores Tunarr may use.`}
                </HelpTooltip>
              </>
            ),
          }}
        />
        <Stack spacing={2} direction={{ sm: 'column', md: 'row' }}>
          <NumericFormControllerText
            control={control}
            name="hlsSegmentSeconds"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              label: t`HLS segment length (seconds)`,
              fullWidth: true,
              helperText: t`Shorter segments start an HLS channel sooner, at a small cost in picture quality. Applies when the channel's stream next starts.`,
            }}
          />
          <NumericFormControllerText
            control={control}
            name="hlsInitialSegmentCount"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              label: t`Segments before playback`,
              fullWidth: true,
              helperText: t`How many segments must be ready before a player gets an HLS channel's playlist.`,
            }}
          />
          <NumericFormControllerText
            control={control}
            name="hlsTsInitialBurstSeconds"
            rules={{ min: 0, max: 60 }}
            TextFieldProps={{
              label: t`MPEG-TS start-up burst (seconds)`,
              fullWidth: true,
              helperText: t`Sends up to this many seconds of video at once when Plex or another HDHomeRun client tunes in to an HLS channel. 0 turns it off.`,
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
                label={t`FFmpeg transcode path`}
                helperText={
                  <>
                    <Trans>
                      Where Tunarr writes HLS segments. Empty uses Tunarr's
                      working directory. Applies to new sessions.
                    </Trans>
                    <HelpTooltip about={t`FFmpeg transcode path`}>
                      <Trans>
                        Tunarr creates the folder if it is missing, but not the
                        folders above it. Sessions already running keep writing
                        to the old folder and clean up their segments when they
                        end.
                      </Trans>
                    </HelpTooltip>{' '}
                    <LearnMoreLink page="ffmpegTranscodePath" />
                  </>
                }
                {...field}
              />
            )}
          />
        </FormControl>
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Typography variant="h2" sx={{ mb: 2 }}>
        <Trans>Audio &amp; Subtitle Options</Trans>
      </Typography>
      <Stack spacing={3} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h3">
            <Trans>Subtitles</Trans>
          </Typography>
          <FormControl fullWidth>
            <Controller
              control={control}
              name="enableSubtitleExtraction"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label={t`Extract embedded subtitles`}
                />
              )}
            />

            <FormHelperText>
              <Trans>
                Copies text subtitles embedded in upcoming programs to a cache,
                so they can be burned in.{' '}
                <LearnMoreLink page="ffmpegSubtitleExtraction" />
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
                Sends text subtitles as closed captions viewers can turn on and
                off. For HLS channels with subtitles on, from the next program.
              </Trans>
              <HelpTooltip about={t`Closed captions for HDHomeRun clients`}>
                <Trans>
                  Tunarr's own players get these subtitles as a selectable track
                  instead of burned in. Forced and image-based subtitles stay
                  burned in.
                </Trans>
              </HelpTooltip>
            </FormHelperText>
          </FormControl>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="hdhr-caption-alignment-label">
              <Trans>Caption alignment</Trans>
            </InputLabel>
            <Controller
              control={control}
              name="hdhrCaptionAlignment"
              render={({ field }) => (
                <Select
                  id="hdhr-caption-alignment"
                  label={t`Caption alignment`}
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
                Where caption lines sit across the screen. Applies from the next
                program.
              </Trans>
              <HelpTooltip about={t`Caption alignment`}>
                <Trans>
                  Italics, underline and top-of-screen placement follow the
                  subtitle file. Text size, font and background are up to the
                  player: Plex Live TV draws captions in its own style, sized by
                  the Plex app's subtitle size setting.
                </Trans>
              </HelpTooltip>
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
                <FormHelperText>
                  <Trans>
                    A player may ignore some of these. Turn on the test pattern
                    below to see what yours shows. Applies from the next
                    program.
                  </Trans>
                  <HelpTooltip about={t`Caption appearance`}>
                    <Trans>
                      Plex draws captions itself, and an earlier test showed it
                      ignoring see-through boxes.
                    </Trans>
                  </HelpTooltip>
                </FormHelperText>
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
                      samples, each saying how it should look. Turn it off when
                      you're done.
                    </Trans>
                    <HelpTooltip about={t`Test pattern`}>
                      <Trans>
                        There is one sample per feature above. Turn captions on
                        in your player and note the numbers that look wrong.
                        Your settings above don't change the samples.
                      </Trans>
                    </HelpTooltip>
                  </FormHelperText>
                </FormControl>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Box>

        <Divider />
        <Typography variant="h3" sx={{ mt: 2, mb: 1 }}>
          <Trans>Audio Language Preferences</Trans>
        </Typography>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          <Trans>Audio languages to prefer, first to last.</Trans>
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
        {(isDirty || (isDirty && !isSubmitting)) && (
          <Button variant="outlined" onClick={() => reset(ffmpegSettings)}>
            <Trans>Reset Changes</Trans>
          </Button>
        )}
        <Button
          variant="contained"
          disabled={!isValid || isSubmitting || !isDirty}
          type="submit"
        >
          <Trans>Save</Trans>
        </Button>
      </Stack>
      <Divider sx={{ mt: 2 }} />

      <Typography variant="h2" sx={{ mt: 2, mb: 1 }}>
        <Trans>Transcoding Configs</Trans>
      </Typography>
      <Typography variant="subtitle1">
        <Trans>
          Each channel uses one transcode config: its video, audio and hardware
          settings. <LearnMoreLink page="transcodeConfigs" />
        </Trans>
      </Typography>
      <TranscodeConfigsTable />
      <UnsavedNavigationAlert isDirty={isDirty} />
    </Box>
  );
}
