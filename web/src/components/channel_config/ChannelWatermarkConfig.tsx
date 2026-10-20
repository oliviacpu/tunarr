import { useSettings } from '@/store/settings/selectors.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { isNonEmptyString } from '@tunarr/shared/util';
import type { Watermark } from '@tunarr/types';
import { find, map, range, round } from 'lodash-es';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { typedProperty } from '../../helpers/util.ts';
import { useTranscodeConfigs } from '../../hooks/settingsHooks.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import useStore from '../../store/index.ts';
import { LearnMoreLink } from '../base/LearnMoreLink.tsx';
import { ImageUploadInput } from '../settings/ImageUploadInput.tsx';
import {
  CheckboxFormController,
  NumericFormControllerText,
} from '../util/TypedController.tsx';

const watermarkPositionOptions: {
  value: Watermark['position'];
  label: string;
}[] = [
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'top-left', label: 'Top Left' },
];

export default function ChannelWatermarkConfig() {
  const { t } = useLingui();
  const { backendUri } = useSettings();
  const channel = useStore((s) => s.channelEditor.currentEntity);
  const transcodeConfigs = useTranscodeConfigs();
  const { control, watch, getValues, setValue } = useChannelFormContext();
  const [watermark, transcodeConfigId, fadePeriod, streamMode, watermarkPath] =
    watch([
      'watermark',
      'transcodeConfigId',
      'watermark.fadeConfig.0.periodMins',
      'streamMode',
      'watermark.url',
    ]);
  const transcodeConfig = find(
    transcodeConfigs.data,
    (conf) => conf.id === transcodeConfigId,
  );
  const [opacity, setOpacity] = useState(getValues('watermark.opacity'));
  const [safeTitleIndicatorVisible, setSafeTitleIndicatorVisible] =
    useState(false);
  if (!channel || !transcodeConfig) return null;
  const targetResForPreview = transcodeConfig.resolution;
  const paddingPct = round(
    100 * (targetResForPreview.heightPx / targetResForPreview.widthPx),
    2,
  );
  const aspectRatio = (
    targetResForPreview.widthPx / targetResForPreview.heightPx
  ).toFixed(2);
  const [safeVerticalPct, safeHorizontalPct] =
    aspectRatio === '1.33' ? [80, 80] : [90, 90];
  const isRight =
    watermark?.position === 'bottom-right' ||
    watermark?.position === 'top-right';
  const isBottom =
    watermark?.position === 'bottom-left' ||
    watermark?.position === 'bottom-right';
  return (
    <Box>
      <Typography variant="h5">
        <Trans>Watermark</Trans>
      </Typography>
      <FormControl fullWidth>
        <FormControlLabel
          control={
            <CheckboxFormController
              control={control}
              name="watermark.enabled"
              disabled={
                streamMode === 'hls_direct' || streamMode === 'hls_direct_v2'
              }
            />
          }
          label={t`Enable watermark`}
        />
        <FormHelperText>
          <Trans>
            Shows a logo (a "bug") over the channel's video. Not available in
            the HLS Direct stream modes.{' '}
            <LearnMoreLink page="channelWatermarks" />
          </Trans>
        </FormHelperText>
      </FormControl>
      {watermark?.enabled &&
        streamMode !== 'hls_direct' &&
        streamMode !== 'hls_direct_v2' && (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            mt={2}
            gap={2}
            useFlexGap
          >
            <Stack sx={{ minWidth: { md: '33%' } }} spacing={2}>
              <Box
                sx={{
                  width: '100%',
                  padding: `0 0 ${paddingPct}%`,
                  position: 'relative',
                  backgroundColor: (theme) => theme.palette.grey[200],
                  borderColor: (theme) => theme.palette.grey[700],
                  borderStyle: 'solid',
                  borderWidth: 2,
                  overflow: 'hidden',
                }}
              >
                <Box
                  component="img"
                  sx={{
                    position: 'absolute',
                    width:
                      watermark?.width && !watermark?.fixedSize
                        ? `${watermark.width}%`
                        : null,
                    opacity: opacity ? opacity / 100 : 1.0,
                    [isBottom ? 'bottom' : 'top']:
                      `${watermark?.verticalMargin}%`,
                    [isRight ? 'right' : 'left']:
                      `${watermark?.horizontalMargin}%`,
                  }}
                  src={
                    [watermarkPath, channel.icon.path].find(isNonEmptyString) ??
                    `${backendUri}/images/tunarr.png`
                  }
                />
                {safeTitleIndicatorVisible && (
                  <Box
                    sx={{
                      background: 'transparent',
                      border: '1px red dashed',
                      position: 'absolute',
                      height: `${safeVerticalPct}%`,
                      width: `${safeHorizontalPct}%`,
                      left: `${(100 - safeHorizontalPct) / 2}%`,
                      top: `${(100 - safeVerticalPct) / 2}%`,
                    }}
                  ></Box>
                )}
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={safeTitleIndicatorVisible}
                    onChange={(_, checked) =>
                      setSafeTitleIndicatorVisible(checked)
                    }
                  />
                }
                label={
                  <Trans>
                    Show{' '}
                    <Link
                      href="https://en.wikipedia.org/wiki/Safe_area_(television)#:~:text=The%20title%2Dsafe%20area%20or,screen%20location%20and%20display%20type."
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      safe title area
                    </Link>{' '}
                    lines in the preview
                  </Trans>
                }
              />
            </Stack>
            <Grid
              container
              spacing={2}
              sx={{ flexGrow: 1, height: 'fit-content' }}
            >
              <Grid size={{ xs: 12 }}>
                <Controller
                  name="watermark.url"
                  control={control}
                  render={({ field }) => (
                    <ImageUploadInput
                      // TODO: This should be something like {channel.id}_fallback_picture.ext
                      fileRenamer={typedProperty('name')}
                      label={t`Watermark image URL`}
                      onFormValueChange={(newPath) => field.onChange(newPath)}
                      onUploadError={console.error}
                      FormControlProps={{ fullWidth: true }}
                      value={field.value ?? ''}
                    >
                      <FormHelperText>
                        <Trans>Leave blank to use the channel's icon.</Trans>
                      </FormHelperText>
                    </ImageUploadInput>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <FormControl fullWidth margin="normal">
                  <InputLabel>{t`Position`}</InputLabel>
                  <Controller
                    name="watermark.position"
                    control={control}
                    render={({ field }) => (
                      <Select label={t`Position`} {...field}>
                        {map(watermarkPositionOptions, (opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    )}
                  />
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <NumericFormControllerText
                  control={control}
                  name="watermark.width"
                  float
                  rules={{
                    min: 0, //{ value: 0, message: 'Width must be >= 0' },
                    max: 100,
                  }}
                  TextFieldProps={{ label: t`Width (%)`, fullWidth: true }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <NumericFormControllerText
                  control={control}
                  name="watermark.horizontalMargin"
                  float
                  rules={{ min: 0, max: 100 }}
                  TextFieldProps={{
                    label: t`Horizontal margin (%)`,
                    fullWidth: true,
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <NumericFormControllerText
                  control={control}
                  name="watermark.verticalMargin"
                  float
                  rules={{ min: 0, max: 100 }}
                  TextFieldProps={{
                    label: t`Vertical margin (%)`,
                    fullWidth: true,
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <FormControl fullWidth>
                  <Typography gutterBottom>
                    <Trans>Opacity</Trans>
                  </Typography>
                  <Box sx={{ px: 2 }}>
                    <Slider
                      min={0}
                      max={100}
                      value={opacity}
                      marks={range(0, 100, 10).map((i) => ({ value: i }))}
                      valueLabelDisplay="auto"
                      sx={{ width: '100%' }}
                      onChange={(_, newValue) => setOpacity(newValue)}
                      onChangeCommitted={(_, newValue) =>
                        setValue('watermark.opacity', newValue, {
                          shouldDirty: true,
                        })
                      }
                      step={1}
                    />
                  </Box>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Divider />
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <FormControl fullWidth>
                  <FormControlLabel
                    control={
                      <CheckboxFormController
                        control={control}
                        name="watermark.fixedSize"
                      />
                    }
                    label={t`Disable image scaling`}
                  />
                  <FormHelperText>
                    <Trans>Shows the image at its actual size.</Trans>
                  </FormHelperText>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, lg: 6 }}>
                <FormControl fullWidth>
                  <FormControlLabel
                    control={
                      <CheckboxFormController
                        control={control}
                        name="watermark.animated"
                      />
                    }
                    label={t`Animated image`}
                  />
                  <FormHelperText>
                    <Trans>
                      Turn on for an animated GIF or PNG; it loops as the image
                      says. A still image with this on causes playback errors.
                    </Trans>
                  </FormHelperText>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, lg: 6 }}>
                <NumericFormControllerText
                  control={control}
                  name="watermark.fadeConfig.0.periodMins"
                  rules={{ min: 0 }}
                  TextFieldProps={{
                    label: t`Watermark period (minutes)`,
                    fullWidth: true,
                    helperText: t`Fades the watermark in and out every this many minutes. 0 turns fading off.`,
                  }}
                />
              </Grid>
              {(fadePeriod ?? 0) > 0 && (
                <Grid size={{ xs: 12, lg: 6 }}>
                  <FormControl fullWidth>
                    <FormControlLabel
                      control={
                        <CheckboxFormController
                          control={control}
                          name="watermark.fadeConfig.0.leadingEdge"
                        />
                      }
                      label={t`Show watermark at stream start`}
                    />
                    <FormHelperText>
                      <Trans>
                        On: the watermark fades in as the stream starts. Off: it
                        first fades in after one period.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                </Grid>
              )}
              <Grid size={{ xs: 12, lg: 6 }}>
                <NumericFormControllerText
                  control={control}
                  name="watermark.duration"
                  rules={{ min: 0 }}
                  TextFieldProps={{
                    label: t`Total watermark duration (seconds)`,
                    fullWidth: true,
                    helperText: t`How long the watermark shows during each program. 0 shows it throughout.`,
                  }}
                />
              </Grid>
            </Grid>
          </Stack>
        )}
    </Box>
  );
}
