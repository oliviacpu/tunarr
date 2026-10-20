import { DefaultFallbackPicturePath } from '@/helpers/constants.ts';
import { useSettings } from '@/store/settings/selectors.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { Delete } from '@mui/icons-material';
import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  find,
  isNumber,
  isUndefined,
  map,
  pullAt,
  range,
  reject,
  round,
  some,
  sumBy,
} from 'lodash-es';
import { useCallback, useState } from 'react';
import { Controller, useFieldArray } from 'react-hook-form';
import { useDebounceCallback } from 'usehooks-ts';
import { isNonEmptyString, typedProperty } from '../../helpers/util.ts';
import { useChannelFormContext } from '../../hooks/useChannelFormContext.ts';
import { useFillerLists } from '../../hooks/useFillerLists.ts';
import { HelpTooltip } from '../base/HelpTooltip.tsx';
import { LearnMoreLink } from '../base/LearnMoreLink.tsx';
import useStore from '../../store/index.ts';
import { RouterLink } from '../base/RouterLink.tsx';
import { ImageUploadInput } from '../settings/ImageUploadInput.tsx';
import { NumericFormController } from '../util/TypedController.tsx';

export function ChannelFlexConfig() {
  const { t } = useLingui();
  const { backendUri } = useSettings();
  const channel = useStore((s) => s.channelEditor.currentEntity);
  const { data: fillerLists, isPending: fillerListsLoading } = useFillerLists();
  const { control, watch } = useChannelFormContext();
  const collectionControls = useFieldArray({
    control,
    name: 'fillerCollections',
    keyName: 'formId', // Filler lists already claim the "id" field
  });
  const channelFillerLists = collectionControls.fields;

  const [offlineMode, offlinePicture, musicListId] = watch([
    'offline.mode',
    'offline.picture',
    'offline.musicListId',
  ]);

  const offlinePictureSrc = isNonEmptyString(offlinePicture)
    ? offlinePicture
    : `${backendUri}${DefaultFallbackPicturePath}`;

  const [weights, setWeights] = useState<number[]>(
    map(channelFillerLists, 'weight'),
  );

  const updateFormWeights = useDebounceCallback(
    useCallback(() => {
      collectionControls.replace(
        map(channelFillerLists, (cfl, idx) => ({
          ...cfl,
          weight: weights[idx],
        })),
      );
    }, [channelFillerLists, collectionControls, weights]),
    100,
  );

  const addFillerList = useCallback(
    (id: string) => {
      if (id === '_unused') {
        return;
      }
      const oldLists = channelFillerLists ? [...channelFillerLists] : [];

      const newWeight = round(100 / (oldLists.length + 1), 2);
      const distributeWeight = round(newWeight / oldLists.length, 2);
      const newLists = [
        {
          id,
          cooldownSeconds: 30,
          weight: newWeight,
        },
        ...map(oldLists, (list) => ({
          ...list,
          weight: list.weight - distributeWeight,
        })),
      ];

      setWeights(map(newLists, 'weight'));
      collectionControls.replace(newLists);
    },
    [channelFillerLists, collectionControls],
  );

  const removeSelectedFillerList = useCallback(
    (idx: number) => {
      if (!channelFillerLists) {
        return;
      }

      const removed = pullAt(channelFillerLists, idx);
      const removedWeight = sumBy(removed, 'weight');
      const distributeWeight =
        channelFillerLists.length > 0
          ? round(removedWeight / channelFillerLists.length, 2)
          : 0;
      const newLists = map(channelFillerLists, (list) => ({
        ...list,
        weight: list.weight + distributeWeight,
      }));

      setWeights(map(newLists, 'weight'));
      collectionControls.replace(newLists);
    },
    [channelFillerLists, collectionControls],
  );

  const adjustWeights = useCallback(
    (idx: number, value: string | number, upscaleAmt: number) => {
      if (!channelFillerLists) {
        return;
      }

      let newWeight = isNumber(value) ? value : parseInt(value);
      if (isNaN(newWeight)) {
        return;
      }
      newWeight /= upscaleAmt;
      const oldWeight = weights[idx];
      const scale = round((newWeight - oldWeight) / oldWeight, 2);
      if (scale === 0) {
        return;
      }
      const newRemainingWeight = 100 - newWeight;
      const oldRemainingWeight = 100 - oldWeight;

      const newWeights = map(range(channelFillerLists.length), (i) => {
        if (idx === i) {
          return newWeight;
        } else if (weights[i] === 0) {
          // If the adjusted slot is coming down from 100% weight
          // just distribute the remaining weight among the other slots
          return round(newRemainingWeight / (channelFillerLists.length - 1), 2);
        } else {
          // Take the percentage portion of the old weight
          // from the newRemainingWeight. This scales the weights
          // relative to their existing proportion.
          const prevWeight = weights[i];
          const prevPortion = round(prevWeight / oldRemainingWeight, 4);
          return round(newRemainingWeight * prevPortion, 2);
        }
      });

      setWeights(newWeights);

      updateFormWeights();
    },
    [channelFillerLists, updateFormWeights, weights],
  );

  const renderFillerLists = () => {
    if (!channelFillerLists || channelFillerLists.length === 0) {
      return null;
    }

    const unclaimedLists = reject(fillerLists, (list) =>
      some(channelFillerLists, { id: list.id }),
    ).map((list) => (
      <MenuItem key={list.id} value={list.id}>
        {list.name}
      </MenuItem>
    ));

    return (
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        {map(channelFillerLists, (cfl, index) => {
          const actualList = find(fillerLists, { id: cfl.id });
          if (isUndefined(actualList)) {
            return null;
          }

          const thisListOpt = (
            <MenuItem key={cfl.id} value={cfl.id}>
              {actualList.name}
            </MenuItem>
          );

          const listOpts = [thisListOpt, ...unclaimedLists];

          return (
            <Paper key={cfl.id} variant="outlined" sx={{ p: 1.5, px: 2 }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: channelFillerLists.length > 1 ? 1.5 : 0 }}
              >
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <Select
                    value={cfl.id}
                    disabled={unclaimedLists.length === 0}
                    size="small"
                  >
                    {listOpts}
                  </Select>
                </FormControl>
                <Stack direction="row" spacing={1} alignItems="center">
                  <NumericFormController
                    control={control}
                    name={`fillerCollections.${index}.cooldownSeconds`}
                    rules={{ min: 0, max: 525600 }}
                    render={({ field }) => (
                      <TextField
                        label={t`Cooldown (s)`}
                        size="small"
                        sx={{ width: 120 }}
                        {...field}
                      />
                    )}
                  />
                  <IconButton
                    size="small"
                    onClick={() => removeSelectedFillerList(index)}
                  >
                    <Delete fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
              {channelFillerLists.length > 1 && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ flexShrink: 0 }}
                  >
                    <Trans>Weight</Trans>
                  </Typography>
                  <Slider
                    size="small"
                    min={0}
                    max={1000}
                    value={weights[index] * 10}
                    onChange={(_, value) => adjustWeights(index, value, 10)}
                    onChangeCommitted={(_, value) =>
                      adjustWeights(index, value, 10)
                    }
                  />
                  <Typography
                    variant="body2"
                    sx={{ flexShrink: 0, minWidth: 48, textAlign: 'right' }}
                  >
                    {weights[index]}%
                  </Typography>
                </Stack>
              )}
            </Paper>
          );
        })}
      </Stack>
    );
  };

  const renderAddFillerListEditor = () => {
    if (!fillerLists) {
      return null;
    }

    if (fillerLists.length === 0) {
      return (
        <Typography>
          <Trans>
            You haven't created any filler lists yet! Go to the{' '}
            <RouterLink to="/library/fillers">Filler Lists</RouterLink> page to
            create one.
          </Trans>
        </Typography>
      );
    }

    const unclaimedLists = reject(fillerLists, (list) =>
      some(channelFillerLists, { id: list.id }),
    ).map((list) => (
      <MenuItem key={list.id} value={list.id}>
        {list.name}
      </MenuItem>
    ));

    const opts = [
      <MenuItem key="null" value="_unused">
        {unclaimedLists.length === 0
          ? t`All lists are used`
          : t`Add a Filler List`}
      </MenuItem>,
      ...unclaimedLists,
    ];

    return (
      <FormControl sx={{ mb: 1 }}>
        <InputLabel>{t`Filler List`}</InputLabel>
        <Select
          value="_unused"
          label={t`Filler List`}
          onChange={(e) => addFillerList(e.target.value)}
          disabled={unclaimedLists.length === 0}
        >
          {opts}
        </Select>
      </FormControl>
    );
  };

  return (
    channel && (
      <>
        <Box>
          <Box>
            <Box>
              <Typography variant="h5" sx={{ mb: 1 }}>
                <Trans>Filler Content</Trans>
              </Typography>
              <Typography variant="body1" sx={{ mb: 2 }}>
                <Trans>
                  Flex time plays random videos from these lists, skipping ones
                  on cooldown or too long to fit. A list's cooldown limits how
                  often it plays. <LearnMoreLink page="fillerSelection" />
                </Trans>
              </Typography>
              {!fillerListsLoading && renderFillerLists()}
              {fillerListsLoading ? <Skeleton /> : renderAddFillerListEditor()}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h5" sx={{ mb: 1 }}>
              <Trans>Filler Options</Trans>
            </Typography>
            <Controller
              name="fillerRepeatCooldown"
              control={control}
              rules={{ validate: (v) => isNumber(v) && !isNaN(v) }}
              render={({ field, formState: { errors } }) => (
                <>
                  <TextField
                    fullWidth
                    label={t`Clip repeat cooldown (seconds)`}
                    margin="normal"
                    helperText={
                      errors.fillerRepeatCooldown?.type === 'validate'
                        ? t`Filler cooldown must be a number`
                        : t`The shortest time before the same filler clip plays again, whatever list it's in.`
                    }
                    {...field}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      field.onChange(isNaN(v) ? '' : v);
                    }}
                  />
                </>
              )}
            />
            <Controller
              control={control}
              name="disableFillerOverlay"
              render={({ field }) => (
                <FormControl fullWidth margin="normal">
                  <FormControlLabel
                    control={<Checkbox {...field} checked={field.value} />}
                    label={t`Hide watermark during filler`}
                  />
                </FormControl>
              )}
            />
          </Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h5" sx={{ mb: 1 }}>
            <Trans>Channel Fallback</Trans>
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            <Trans>
              What the channel shows when no filler fits the gap. Needs FFmpeg
              transcoding.
            </Trans>
          </Typography>
          <Stack spacing={2} direction="row" sx={{ pb: 1 }}>
            {offlineMode === 'pic' && (
              <Box sx={{ flexBasis: '33%' }}>
                <Box
                  component="img"
                  width="100%"
                  src={offlinePictureSrc}
                  sx={{ mr: 1 }}
                />
              </Box>
            )}
            <Stack direction="column" sx={{ flexGrow: 1 }} gap={1}>
              <Controller
                name="offline.mode"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth sx={{ mb: 1 }}>
                    <InputLabel>{t`Fallback mode`}</InputLabel>
                    <Select fullWidth label={t`Fallback mode`} {...field}>
                      <MenuItem value={'pic'}>
                        <Trans>Image</Trans>
                      </MenuItem>
                      <MenuItem disabled value={'clip'}>
                        <Trans>Library clip (not yet available)</Trans>
                      </MenuItem>
                    </Select>
                  </FormControl>
                )}
              />
              <Controller
                name="offline.picture"
                control={control}
                render={({ field }) => (
                  <ImageUploadInput
                    // TODO: This should be something like {channel.id}_fallback_picture.ext
                    fileRenamer={typedProperty('name')}
                    label={t`Image URL`}
                    onFormValueChange={(newPath) => {
                      field.onChange(newPath);
                    }}
                    onUploadError={console.error}
                    FormControlProps={{ fullWidth: true, sx: { mb: 1 } }}
                    value={field.value ?? ''}
                  />
                )}
              />
              <Controller
                name="offline.guidePicture"
                control={control}
                render={({ field }) => (
                  <ImageUploadInput
                    fileRenamer={typedProperty('name')}
                    label={t`Guide picture for gaps`}
                    onFormValueChange={(newPath) => {
                      field.onChange(newPath);
                    }}
                    onUploadError={console.error}
                    FormControlProps={{ fullWidth: true, sx: { mb: 1 } }}
                    value={field.value ?? ''}
                  />
                )}
              />
              <FormHelperText sx={{ mt: -1, mb: 1 }}>
                <Trans>
                  The picture gaps show in the guide. Without one, they show the
                  image above, or else the channel logo.
                </Trans>
                <HelpTooltip about={t`Guide picture for gaps`}>
                  <Trans>
                    Apps such as Plex crop one picture to both tall and wide
                    tiles, so a square picture with its content in the middle
                    works best.
                  </Trans>
                </HelpTooltip>
              </FormHelperText>
              <Controller
                name="offline.musicListId"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth sx={{ mb: 1 }}>
                    <InputLabel>{t`Gap music`}</InputLabel>
                    <Select
                      fullWidth
                      label={t`Gap music`}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                    >
                      <MenuItem value="">
                        <Trans>None</Trans>
                      </MenuItem>
                      {map(fillerLists, (list) => (
                        <MenuItem key={list.id} value={list.id}>
                          {list.name}
                        </MenuItem>
                      ))}
                    </Select>
                    <FormHelperText>
                      <Trans>
                        Tracks from this filler list play under the image during
                        gaps, at an even loudness. Don't also add the list as
                        filler above.
                      </Trans>
                      <HelpTooltip about={t`Gap music`}>
                        <Trans>
                          Build the list under Filler from artists, albums or
                          tracks in your music library. A list also added as
                          filler above plays its tracks as programs.
                        </Trans>
                      </HelpTooltip>
                    </FormHelperText>
                  </FormControl>
                )}
              />
              <Controller
                name="offline.showNowPlaying"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth sx={{ mb: 1 }}>
                    <FormControlLabel
                      control={<Checkbox {...field} checked={field.value} />}
                      disabled={!isNonEmptyString(musicListId)}
                      label={t`Show the artist and title`}
                    />
                    <FormHelperText sx={{ mt: 0 }}>
                      <Trans>
                        Shows the track that's playing in a dark strip along the
                        bottom of the image, in the same place on every channel.
                      </Trans>
                    </FormHelperText>
                  </FormControl>
                )}
              />
            </Stack>
          </Stack>
        </Box>
      </>
    )
  );
}
