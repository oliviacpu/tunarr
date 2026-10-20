import { AppliesWhen } from '@/components/settings/AppliesWhen.tsx';
import { HelpTooltip } from '@/components/base/HelpTooltip.tsx';
import { LearnMoreLink } from '@/components/base/LearnMoreLink.tsx';
import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { LanguagePreferencesList } from '@/components/LanguagePreferencesList';
import {
  NumericFormControllerText,
  SelectFormController,
  SwitchFormController,
} from '@/components/util/TypedController.tsx';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { ExpandMore } from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Divider,
  FormControl,
  FormHelperText,
  MenuItem,
  Link as MuiLink,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { FfmpegSettings, TupleToUnion } from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import type { TonemapAlgorithm } from '@tunarr/types/schemas';
import {
  CaptionAlignments,
  FfmpegLogLevels,
  TonemapAlgorithms,
} from '@tunarr/types/schemas';
import { capitalize, isEmpty, isEqual } from 'lodash-es';
import { useEffect, useState } from 'react';
import UnsavedNavigationAlert from '@/components/settings/UnsavedNavigationAlert.tsx';
import type { Control, SubmitHandler } from 'react-hook-form';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { DeepRequired } from 'ts-essentials';
import { CaptionAppearanceFields } from '../../components/settings/ffmpeg/CaptionAppearanceFields.tsx';
import { TranscodeConfigsTable } from '../../components/settings/ffmpeg/TranscodeConfigsTable.tsx';
import {
  getApiFfmpegInfoOptions,
  getApiFfmpegInfoQueryKey,
  getApiFfmpegSettingsQueryKey,
  getApiVersionQueryKey,
  getApiSystemStateOptions,
  putApiFfmpegSettingsMutation,
} from '../../generated/@tanstack/react-query.gen.ts';
import { useFfmpegSettings } from '../../hooks/settingsHooks.ts';
import FeaturesSettingsPage from './FeaturesSettingsPage.tsx';
import { useCaptionAlignmentNames } from '../../hooks/useCaptionAlignmentNames.ts';

const FfmpegLogOptions = ['disable', 'console', 'file'] as const;
type FfmpegLogOptions = TupleToUnion<typeof FfmpegLogOptions>;

type FfmpegFormValues = DeepRequired<Omit<FfmpegSettings, 'configVersion'>>;

// The form's values for saved settings: every field filled in, and a missing
// transcode directory as an empty one. The settings' configVersion rides
// along and is sent back as it came
function toFormValues(settings: FfmpegSettings): FfmpegFormValues {
  return {
    ...defaultFfmpegSettings,
    ...settings,
    transcodeDirectory: settings.transcodeDirectory ?? '',
  };
}

const HlsDirectOutputFormatOptions = [
  { value: 'mkv', label: 'MKV' },
  { value: 'mp4', label: 'MP4' },
  { value: 'mpegts', label: 'MPEG-TS' },
] as const;

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

function FfmpegBinariesFields({
  control,
}: {
  control: Control<FfmpegFormValues>;
}) {
  const { t } = useLingui();
  const systemState = useQuery(getApiSystemStateOptions());
  if (systemState.isPending) return <Skeleton variant="rounded" height={48} />;
  if (systemState.data === undefined) {
    return (
      <Alert severity="warning">
        <Trans>
          Server environment could not be loaded. Reload this page to edit
          executable paths.
        </Trans>
      </Alert>
    );
  }
  return (
    <>
      <AppliesWhen setting="ffmpegBinaries" />
      {systemState.isError && (
        <Alert severity="warning">
          <Trans>
            Server environment could not be refreshed. Using the last loaded
            environment; your edits are kept.
          </Trans>
        </Alert>
      )}
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
    </>
  );
}

export default function FfmpegSettingsPage({
  section = 'playback',
}: {
  section?: 'playback' | 'captions-audio';
}) {
  const [flagsDirty, setFlagsDirty] = useState(false);
  const { t } = useLingui();
  const { data: ffmpegSettings } = useFfmpegSettings();
  const captionAlignmentNames = useCaptionAlignmentNames();

  const form = useForm<FfmpegFormValues>({
    defaultValues: toFormValues(ffmpegSettings),
    // Save turns off as soon as a value stops being valid; a field says why
    // once it has been left
    mode: 'onTouched',
  });
  const {
    reset,
    setValue,
    control,
    formState: { defaultValues, isDirty },
  } = form;

  // Load the saved settings into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight
  useEffect(() => {
    const loaded = toFormValues(ffmpegSettings);
    if (!isEqual(loaded, defaultValues)) {
      reset(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ffmpegSettings]);

  const [
    ffmpegConsoleLoggingEnabled,
    ffmpegFileLoggingEnabled,
    hdhrClosedCaptions,
  ] = useWatch({
    control,
    name: ['enableLogging', 'enableFileLogging', 'hdhrClosedCaptions'],
  });

  let logSelectValue: FfmpegLogOptions = 'disable';
  if (ffmpegFileLoggingEnabled) {
    logSelectValue = 'file';
  } else if (ffmpegConsoleLoggingEnabled) {
    logSelectValue = 'console';
  }

  const handleFfmpegLogChange = (value: string) => {
    const logValue =
      FfmpegLogOptions.find((option) => option === value) ?? 'disable';

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

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiFfmpegSettingsMutation(),
    toFormValues,
    // A new executable path is probed again, and the sidebar shows its version
    invalidate: [
      { queryKey: getApiFfmpegSettingsQueryKey(), exact: true },
      { queryKey: getApiFfmpegInfoQueryKey(), exact: true },
      { queryKey: getApiVersionQueryKey(), exact: true },
    ],
  });

  const save: SubmitHandler<FfmpegFormValues> = (data) => {
    saveMutation.mutate({
      body: {
        configVersion: defaultFfmpegSettings.configVersion,
        ...data,
      },
    });
  };

  return (
    <Box>
      <UnsavedNavigationAlert isDirty={isDirty || flagsDirty} />
      <SettingsForm
        guardNavigation={false}
        form={form}
        onSubmit={save}
        isSubmitting={saveMutation.isPending}
      >
        {section === 'playback' && (
          <>
            <Typography variant="h3" sx={{ mb: 2 }}>
              <Trans>Global playback options</Trans>
            </Typography>
            <Stack spacing={3} useFlexGap sx={{ mb: 2 }}>
              <FfmpegBinariesFields control={control} />
              <AppliesWhen setting="ffmpegLogging" />
              <Stack spacing={2} direction={{ sm: 'column', md: 'row' }}>
                {/* Not a field of its own: it sets the two logging switches */}
                <TextField
                  select
                  id="ffmpeg-logging"
                  label={t`FFmpeg logging`}
                  value={logSelectValue}
                  onChange={(e) => handleFfmpegLogChange(e.target.value)}
                  sx={{ flexBasis: '50%' }}
                  helperText={
                    <Trans>
                      Where FFmpeg writes its log. File gives each FFmpeg
                      process its own log in the Tunarr log folder, deleted
                      automatically. <LearnMoreLink page="ffmpegLogging" />
                    </Trans>
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
                </TextField>
                {logSelectValue !== 'disable' && (
                  <SelectFormController
                    control={control}
                    name="logLevel"
                    label={t`FFmpeg log level`}
                    options={FfmpegLogLevels.map((level) => ({
                      value: level,
                      label: capitalize(level),
                    }))}
                    helperText={
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
                    }
                    TextFieldProps={{
                      id: 'ffmpeg-logging-level',
                      sx: { flex: 1 },
                    }}
                  />
                )}
              </Stack>
              <AppliesWhen setting="hlsDirectOutput" />
              <SelectFormController
                control={control}
                name="hlsDirectOutputFormat"
                label={t`HLS Direct output format`}
                options={HlsDirectOutputFormatOptions}
                helperText={
                  <Trans>
                    The container format for channels in the HLS Direct stream
                    mode.
                  </Trans>
                }
                TextFieldProps={{ id: 'hls-direct-output-format' }}
              />
              <AppliesWhen setting="videoFilters" />
              <SelectFormController
                control={control}
                name="scalingAlgorithm"
                label={t`Scaling algorithm`}
                options={[
                  { value: 'bicubic', label: 'Bicubic' },
                  { value: 'fast_bilinear', label: 'Fast bilinear' },
                  { value: 'lanczos', label: 'Lanczos' },
                  { value: 'spline', label: 'Spline' },
                ]}
                helperText={t`How FFmpeg resizes video.`}
              />
              <SelectFormController
                control={control}
                name="deinterlaceFilter"
                label={t`Deinterlace filter`}
                options={[
                  { value: 'none', label: t`None` },
                  ...['bwdif=0', 'bwdif=1', 'w3fdif', 'yadif=0', 'yadif=1'].map(
                    (value) => ({ value, label: value }),
                  ),
                ]}
                helperText={t`Filter used to deinterlace video.`}
              />
              <SelectFormController
                control={control}
                name="tonemapAlgorithm"
                label={t`HDR tone-map curve`}
                options={TonemapAlgorithms.map((algorithm) => ({
                  value: algorithm,
                  label: TonemapAlgorithmNames[algorithm],
                }))}
                helperText={
                  <>
                    <Trans>
                      How HDR programs become SDR when HDR Tonemapping is on
                      below. Applies from the next program.
                    </Trans>
                    <HelpTooltip about={t`HDR tone-map curve`}>
                      <Trans>
                        Hable is filmic and a little darker. BT.2390, the
                        broadcast standard, is brighter and closer to the
                        source. BT.2390 needs jellyfin-ffmpeg; other FFmpeg
                        builds use Hable instead.
                      </Trans>
                    </HelpTooltip>
                  </>
                }
                TextFieldProps={{ id: 'tonemap-algorithm' }}
              />
              <AppliesWhen setting="readAhead" />
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
              <AppliesWhen setting="hlsSession" />
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
              <AppliesWhen setting="transcodeDirectory" />
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
                            Where Tunarr writes HLS segments. Empty uses
                            Tunarr's working directory. Applies to new sessions.
                          </Trans>
                          <HelpTooltip about={t`FFmpeg transcode path`}>
                            <Trans>
                              Tunarr creates the folder if it is missing, but
                              not the folders above it. Sessions already running
                              keep writing to the old folder and clean up their
                              segments when they end.
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
          </>
        )}
        {section === 'captions-audio' && (
          <>
            <Stack spacing={3} sx={{ mb: 2 }}>
              <Stack spacing={2}>
                <Typography variant="h3">
                  <Trans>Subtitles</Trans>
                </Typography>
                <AppliesWhen setting="subtitleExtraction" />
                <SwitchFormController
                  control={control}
                  name="enableSubtitleExtraction"
                  label={t`Extract embedded subtitles`}
                  helperText={
                    <Trans>
                      Copies text subtitles embedded in upcoming programs to a
                      cache, so they can be burned in.{' '}
                      <LearnMoreLink page="ffmpegSubtitleExtraction" />
                    </Trans>
                  }
                  FormControlProps={{ fullWidth: true }}
                />
                <AppliesWhen setting="captionsEnabled" />
                <SwitchFormController
                  control={control}
                  name="hdhrClosedCaptions"
                  label={t`Closed captions for HDHomeRun clients (Plex)`}
                  helperText={
                    <>
                      <Trans>
                        Sends text subtitles as closed captions viewers can turn
                        on and off. For HLS channels with subtitles on, from the
                        next session.
                      </Trans>
                      <HelpTooltip
                        about={t`Closed captions for HDHomeRun clients`}
                      >
                        <Trans>
                          Tunarr's own players get these subtitles as a
                          selectable track instead of burned in. Forced and
                          image-based subtitles stay burned in.
                        </Trans>
                      </HelpTooltip>
                    </>
                  }
                  FormControlProps={{ fullWidth: true }}
                />
                <AppliesWhen setting="captionStyle" />
                <SelectFormController
                  control={control}
                  name="hdhrCaptionAlignment"
                  label={t`Caption alignment`}
                  disabled={!hdhrClosedCaptions}
                  options={CaptionAlignments.map((alignment) => ({
                    value: alignment,
                    label: captionAlignmentNames[alignment],
                  }))}
                  helperText={
                    <>
                      <Trans>
                        Where caption lines sit across the screen. Applies from
                        the next program.
                      </Trans>
                      <HelpTooltip about={t`Caption alignment`}>
                        <Trans>
                          Italics, underline and top-of-screen placement follow
                          the subtitle file. Text size, font and background are
                          up to the player: Plex Live TV draws captions in its
                          own style, sized by the Plex app's subtitle size
                          setting.
                        </Trans>
                      </HelpTooltip>
                    </>
                  }
                  TextFieldProps={{
                    id: 'hdhr-caption-alignment',
                    fullWidth: true,
                  }}
                />
                <Accordion disableGutters disabled={!hdhrClosedCaptions}>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography>
                      <Trans>Caption appearance (experimental)</Trans>
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <FormHelperText>
                        <Trans>
                          A player may ignore some of these. Turn on the test
                          pattern below to see what yours shows. Applies from
                          the next program.
                        </Trans>
                        <HelpTooltip about={t`Caption appearance`}>
                          <Trans>
                            Plex draws captions itself, and an earlier test
                            showed it ignoring see-through boxes.
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
                      <SwitchFormController
                        control={control}
                        name="hdhrCaptionTestPattern"
                        label={t`Test pattern`}
                        helperText={
                          <>
                            <Trans>
                              Replaces every program's captions with 39 numbered
                              samples, each saying how it should look. Turn it
                              off when you're done.
                            </Trans>
                            <HelpTooltip about={t`Test pattern`}>
                              <Trans>
                                There is one sample per feature above. Turn
                                captions on in your player and note the numbers
                                that look wrong. Your settings above don't
                                change the samples.
                              </Trans>
                            </HelpTooltip>
                          </>
                        }
                        FormControlProps={{ fullWidth: true }}
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Stack>

              <Divider />
              <Typography variant="h3" sx={{ mt: 2, mb: 1 }}>
                <Trans>Audio Language Preferences</Trans>
              </Typography>
              <AppliesWhen setting="audioLanguages" />
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
                          {
                            iso6391: 'en',
                            iso6392: 'eng',
                            displayName: 'English',
                          },
                        ]
                      }
                      onChange={field.onChange}
                      error={error}
                    />
                  )}
                />
              </FormControl>
            </Stack>
          </>
        )}
      </SettingsForm>
      <Box sx={{ mt: 3 }}>
        <FeaturesSettingsPage group={section} onDirtyChange={setFlagsDirty} />
      </Box>
      {section === 'playback' && (
        <>
          <Divider sx={{ mt: 2 }} />

          <Typography variant="h3" sx={{ mt: 2, mb: 1 }}>
            <Trans>Transcoding Configs</Trans>
          </Typography>
          <AppliesWhen setting="transcodeConfigs" />
          <Typography variant="subtitle1">
            <Trans>
              Each channel uses one transcode config: its video, audio and
              hardware settings. <LearnMoreLink page="transcodeConfigs" />
            </Trans>
          </Typography>
          <TranscodeConfigsTable />
        </>
      )}
    </Box>
  );
}
