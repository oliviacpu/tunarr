import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { useSettings } from '@/store/settings/selectors.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Stack,
  TextField,
} from '@mui/material';
import { minimumXmlTvGuideHours } from '@tunarr/shared/util';
import type { XmlTvSettings } from '@tunarr/types';
import { defaultXmlTvSettings } from '@tunarr/types';
import { isEmpty, isEqual, range } from 'lodash-es';
import { useEffect, useMemo } from 'react';
import type { SubmitHandler } from 'react-hook-form';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { HelpTooltip } from '../../components/base/HelpTooltip.tsx';
import {
  CheckboxFormController,
  NumericFormControllerText,
  SelectFormController,
} from '../../components/util/TypedController.tsx';
import { putApiXmltvSettingsMutation } from '../../generated/@tanstack/react-query.gen.ts';
import { useXmlTvSettings } from '../../hooks/settingsHooks.ts';

const refreshStartHourOptions = range(0, 24).map((hour) => ({
  value: hour,
  label: `${hour.toString().padStart(2, '0')}:00`,
}));

export default function XmlTvSettingsPage() {
  const { t } = useLingui();
  const { backendUri } = useSettings();
  const { data } = useXmlTvSettings();

  const form = useForm<XmlTvSettings>({
    defaultValues: defaultXmlTvSettings,
    mode: 'onBlur',
  });
  const {
    reset,
    control,
    formState: { defaultValues },
    trigger,
  } = form;

  // Load the saved settings into the form. The reload after a save brings back
  // what the form already compares against, so it is skipped: resetting again
  // would drop edits made while the save was in flight. Only a new load runs
  // this; the form's own resets change its defaults too
  useEffect(() => {
    if (!isEqual(data, defaultValues)) {
      reset(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, reset]);

  // Settings saved before the refresh timer had to fit in the guide can't be
  // saved as they are: say why when they load, not only once the field is
  // touched. Keyed on the reset's new defaults, since a reset unregisters the
  // fields until the next render, so validating in the same effect finds none
  useEffect(() => {
    void trigger('refreshHours');
  }, [defaultValues, trigger]);

  // The defaults, except the output path, which only settings.json can move
  const tunarrDefaults = useMemo(
    () => ({ ...defaultXmlTvSettings, outputPath: data.outputPath }),
    [data.outputPath],
  );
  const values = useWatch({ control });

  const saveMutation = useSettingsMutation({
    form,
    mutation: putApiXmltvSettingsMutation(),
    toFormValues: (saved) => saved,
    invalidate: { predicate: invalidateTaggedQueries('Settings') },
  });

  const save: SubmitHandler<XmlTvSettings> = (settings) => {
    saveMutation.mutate({ body: settings });
  };

  const guideUrl = new URL(
    '/api/xmltv.xml',
    isEmpty(backendUri) ? document.location.href : backendUri,
  ).href;

  return (
    <SettingsForm
      form={form}
      onSubmit={save}
      isSubmitting={saveMutation.isPending}
      onRestoreDefaults={
        isEqual(values, tunarrDefaults)
          ? undefined
          : () => reset(tunarrDefaults, { keepDefaultValues: true })
      }
    >
      <FormControl fullWidth>
        <Controller
          control={control}
          name="outputPath"
          render={({ field }) => (
            <TextField
              id="output-path"
              label={t`XMLTV output path`}
              InputProps={{
                readOnly: true,
                disabled: true,
              }}
              helperText={
                <>
                  <Trans>
                    Add the guide to clients such as Plex from {guideUrl}, not
                    from this file.
                  </Trans>
                  <HelpTooltip about={t`XMLTV output path`}>
                    <Trans>
                      To move this file, edit settings.json in the Tunarr data
                      directory.
                    </Trans>
                  </HelpTooltip>
                </>
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
          prettyFieldName={t`Guide length (hours)`}
          // The guide has to last the refresh interval
          rules={{ deps: ['refreshHours'] }}
          TextFieldProps={{
            id: 'epg-hours',
            label: t`Guide length (hours)`,
            helperText: t`How many hours of programs each rebuild of the guide covers.`,
            sx: { mb: 2 },
          }}
        />
        <NumericFormControllerText
          control={control}
          name="refreshHours"
          prettyFieldName={t`Refresh interval (hours)`}
          rules={{
            validate: {
              // The server refuses it too: each rebuild writes the guide
              // length's worth of guide, which has to last until the next one,
              // up to two hours late on the night the clocks go back. A value
              // that isn't a number is left to the numeric checks
              guideLastsTheTimer: (refreshHours, { programmingHours }) => {
                if (
                  !Number.isFinite(refreshHours) ||
                  !Number.isFinite(programmingHours)
                ) {
                  return undefined;
                }
                const minimum = minimumXmlTvGuideHours(refreshHours);
                return programmingHours < minimum
                  ? t`The guide would run out before the next rebuild. Set Guide length to ${minimum} hours or more, two hours longer than the interval.`
                  : undefined;
              },
            },
          }}
          TextFieldProps={{
            id: 'refresh-hours',
            label: t`Refresh interval (hours)`,
            helperText: t`How often the guide is rebuilt. Guide length must be at least two hours longer.`,
          }}
        />
        <SelectFormController
          control={control}
          name="refreshStartHour"
          label={t`Refreshes start at`}
          helperText={t`An hour in server time. The guide rebuilds then and every interval after it, around the clock; with 24 hours, only then.`}
          options={refreshStartHourOptions}
          TextFieldProps={{ id: 'refresh-start-hour', sx: { minWidth: 200 } }}
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
              label={t`Public address for guide pictures`}
              placeholder="https://tunarr.example.com"
              error={!!fieldState.error}
              helperText={
                fieldState.error?.message ?? (
                  <>
                    <Trans>
                      The address guide pictures link to. Leave empty to use the
                      address the guide was requested on.
                    </Trans>
                    <HelpTooltip about={t`Public address for guide pictures`}>
                      <Trans>
                        Set it when a client such as Plex reads the guide from a
                        local address (like 127.0.0.1) but its apps load the
                        pictures themselves: they can only reach a public
                        address.
                      </Trans>
                    </HelpTooltip>
                  </>
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
          label={t`Use show poster`}
        />
        <FormHelperText>
          <Trans>Episodes use their show's poster instead of their own.</Trans>
        </FormHelperText>
      </FormControl>
    </SettingsForm>
  );
}
