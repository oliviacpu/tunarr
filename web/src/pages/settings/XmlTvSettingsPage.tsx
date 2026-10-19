import { useSettings } from '@/store/settings/selectors.ts';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { minimumXmlTvGuideHours } from '@tunarr/shared/util';
import {
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { XmlTvSettings } from '@tunarr/types';
import { defaultXmlTvSettings } from '@tunarr/types';
import { isEmpty, isEqual, range } from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useEffect, useState } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import UnsavedNavigationAlert from '../../components/settings/UnsavedNavigationAlert.tsx';
import {
  CheckboxFormController,
  NumericFormControllerText,
} from '../../components/util/TypedController.tsx';
import { putApiXmltvSettingsMutation } from '../../generated/@tanstack/react-query.gen.ts';
import { useXmlTvSettings } from '../../hooks/settingsHooks.ts';

export default function XmlTvSettingsPage() {
  const { t } = useLingui();
  const [restoreTunarrDefaults, setRestoreTunarrDefaults] = useState(false);
  const { backendUri } = useSettings();
  const { data, error } = useXmlTvSettings();
  const snackbar = useSnackbar();

  const {
    reset,
    control,
    formState: { isDirty, isValid, isSubmitting, defaultValues },
    handleSubmit,
    trigger,
  } = useForm<XmlTvSettings>({
    defaultValues: defaultXmlTvSettings,
    mode: 'onBlur',
  });

  useEffect(() => {
    if (data) {
      reset(data);
    }
  }, [data, reset]);

  // Settings saved before the refresh timer had to fit in the guide can't be
  // saved as they are: say why when they load, not only once the field is
  // touched. Keyed on the reset's new defaults, since a reset unregisters the
  // fields until the next render, so validating in the same effect finds none
  useEffect(() => {
    void trigger('refreshHours');
  }, [defaultValues, trigger]);

  const queryClient = useQueryClient();

  const updateXmlTvSettingsMutation = useMutation({
    ...putApiXmltvSettingsMutation(),
    onSuccess: (data) => {
      snackbar.enqueueSnackbar(t`Settings Saved!`, {
        variant: 'success',
      });
      setRestoreTunarrDefaults(false);
      reset(data, { keepValues: true });
      return queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Settings'),
      });
    },
    onError: (error) => {
      const message = getApiErrorMessage(error) ?? error.message;
      snackbar.enqueueSnackbar(t`Error saving XMLTV settings. ${message}`, {
        variant: 'error',
      });
    },
  });

  const updateXmlTvSettings: SubmitHandler<XmlTvSettings> = (data) => {
    updateXmlTvSettingsMutation.mutate({
      body: {
        ...data,
      },
    });
  };

  // TODO: Handle this better - show the bug page.
  if (error) {
    return <h1>XML: {error.message}</h1>;
  }

  return (
    <Box component="form" onSubmit={handleSubmit(updateXmlTvSettings)}>
      <FormControl fullWidth>
        <Controller
          control={control}
          name="outputPath"
          render={({ field }) => (
            <TextField
              id="output-path"
              label={t`Output Path`}
              InputProps={{
                readOnly: true,
                disabled: true,
              }}
              helperText={
                <Trans>
                  <span>
                    You can edit this location in your settings.json within your
                    Tunarr data directory
                    <br />
                    <strong>NOTE:</strong> When manually adding the XMLTV
                    location to a client like Plex, do not use this file
                    directly. Instead, use the generated XMLTV from the Tunarr
                    API endpoint:{' '}
                    {
                      new URL(
                        '/api/xmltv.xml',
                        isEmpty(backendUri)
                          ? document.location.href
                          : backendUri,
                      ).href
                    }
                  </span>
                </Trans>
              }
              {...field}
            />
          )}
        />
      </FormControl>
      <Stack spacing={2} direction={{ sm: 'column', md: 'row' }} sx={{ my: 2 }}>
        <NumericFormControllerText
          control={control}
          name="programmingHours"
          prettyFieldName={t`EPG (Hours)`}
          // The guide has to last the refresh timer
          rules={{ deps: ['refreshHours'] }}
          TextFieldProps={{
            id: 'epg-hours',
            label: t`EPG (Hours)`,
            helperText: t`Number of hours to include in the XMLTV file`,
            sx: { mb: 2 },
          }}
        />
        <NumericFormControllerText
          control={control}
          name="refreshHours"
          prettyFieldName={t`Refresh Timer (Hours)`}
          rules={{
            validate: {
              // The server refuses it too: each rebuild writes EPG (Hours) of
              // guide, which has to last until the next one, up to two hours late on
              // the night the clocks go back. A value that isn't a number is
              // left to the numeric checks
              guideLastsTheTimer: (refreshHours, { programmingHours }) => {
                if (
                  !Number.isFinite(refreshHours) ||
                  !Number.isFinite(programmingHours)
                ) {
                  return undefined;
                }
                const minimum = minimumXmlTvGuideHours(refreshHours);
                return programmingHours < minimum
                  ? t`EPG (Hours) is too short for this timer: the guide would run out before the next rebuild. Set it to ${minimum} or more, two hours longer than the time between rebuilds.`
                  : undefined;
              },
            },
          }}
          TextFieldProps={{
            id: 'refresh-hours',
            label: t`Refresh Timer (Hours)`,
            helperText: t`How often the XMLTV file is regenerated. EPG (Hours) has to be at least two hours longer.`,
          }}
        />
        <Controller
          control={control}
          name="refreshStartHour"
          render={({ field }) => (
            <TextField
              select
              id="refresh-start-hour"
              label={t`Refresh Timer Starts At`}
              helperText={t`An hour (server time) the guide is rebuilt at. The refresh timer counts on from it around the clock. With a 24 hour timer, the only refresh each day.`}
              sx={{ minWidth: 200 }}
              {...field}
              onChange={(e) => field.onChange(Number(e.target.value))}
            >
              {range(0, 24).map((hour) => (
                <MenuItem key={hour} value={hour}>
                  {`${hour.toString().padStart(2, '0')}:00`}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
      </Stack>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <Controller
          control={control}
          name="publicUrl"
          rules={{
            validate: (value) =>
              isEmpty(value) ||
              URL.canParse(value) ||
              t`Enter a full address, such as https://tunarr.example.com`,
          }}
          render={({ field, fieldState }) => (
            <TextField
              id="public-url"
              label={t`Public Address for Guide Pictures`}
              placeholder="https://tunarr.example.com"
              error={!!fieldState.error}
              helperText={
                fieldState.error?.message ?? (
                  <Trans>
                    The address programme and channel pictures in the guide link
                    to. Set it when a client such as Plex reads the guide from a
                    local address (like 127.0.0.1) but its apps load the
                    pictures themselves: they can only reach a public address.
                    Leave empty to use the address the guide was requested on.
                  </Trans>
                )
              }
              {...field}
            />
          )}
        />
      </FormControl>
      {/* <FormControl>
        <FormControlLabel
          control={
            <CheckboxFormController control={control} name="enableImageCache" />
          }
          label="Image Cache"
        />
        <FormHelperText>
          If enabled the pictures used for Movie and TV Show posters will be
          cached in Tunarr's .tunarr folder and will be delivered by Tunarr's
          server instead of requiring calls to Plex. Note that using fixed xmltv
          location in Plex (as opposed to url) will not work correctly in this
          case.
        </FormHelperText>
      </FormControl> */}
      <Divider sx={{ my: 2 }} />
      <FormControl>
        <FormControlLabel
          control={
            <CheckboxFormController control={control} name="useShowPoster" />
          }
          label={t`Use Show Poster`}
        />
        <FormHelperText>
          <Trans>
            If enabled, TV show episodes will use the poster of their show,
            instead of the individual episode poster.
          </Trans>
        </FormHelperText>
      </FormControl>
      <UnsavedNavigationAlert isDirty={isDirty} />
      <Stack spacing={2} direction="row" sx={{ mt: 2 }}>
        <Stack
          spacing={2}
          direction="row"
          justifyContent="left"
          sx={{ mt: 2, flexGrow: 1 }}
        >
          {!isEqual(defaultValues, {
            ...defaultXmlTvSettings,
            outputPath: data.outputPath,
          }) && (
            <Button
              variant="outlined"
              onClick={() => {
                reset({ ...defaultXmlTvSettings, outputPath: data.outputPath });
                setRestoreTunarrDefaults(true);
              }}
            >
              <Trans>Restore Default Settings</Trans>
            </Button>
          )}
        </Stack>
        <Stack
          spacing={2}
          direction="row"
          justifyContent="right"
          sx={{ mt: 2 }}
        >
          {isDirty && (
            <Button
              variant="outlined"
              onClick={() => {
                reset(data);
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
      </Stack>
    </Box>
  );
}
