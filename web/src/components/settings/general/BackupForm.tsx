import { Trans, useLingui } from '@lingui/react/macro';
import type { SelectChangeEvent } from '@mui/material';
import {
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  CheckboxFormController,
  NumericFormControllerText,
} from '../../util/TypedController.tsx';
import type { GeneralSettingsFormData } from './GeneralSettingsForm.tsx';
import { ScheduleFields } from './ScheduleFields.tsx';

export const BackupForm = ({
  configurationIndex = 0,
}: {
  configurationIndex?: number;
}) => {
  const { t } = useLingui();
  const { control, setValue } = useFormContext<GeneralSettingsFormData>();

  const gzip = useWatch({
    control,
    name: `backup.configurations.${configurationIndex}.outputs.0.gzip`,
  });

  const outputs = useWatch({
    control,
    name: `backup.configurations.${configurationIndex}.outputs`,
  });

  function handleArchiveFormatUpdate(ev: SelectChangeEvent) {
    if (ev.target.value === 'zip' || ev.target.value === 'tar') {
      setValue(
        `backup.configurations.${configurationIndex}.outputs.0.archiveFormat`,
        ev.target.value,
        { shouldDirty: true },
      );
      setValue(
        `backup.configurations.${configurationIndex}.outputs.0.gzip`,
        false,
        {
          shouldDirty: true,
        },
      );
    } else if (ev.target.value === 'targz') {
      setValue(
        `backup.configurations.${configurationIndex}.outputs.0.archiveFormat`,
        'tar',
        {
          shouldDirty: true,
        },
      );
      setValue(
        `backup.configurations.${configurationIndex}.outputs.0.gzip`,
        true,
        {
          shouldDirty: true,
        },
      );
    }
  }

  return (
    <>
      <Grid size={12}>
        <FormControlLabel
          label={t`Enable this backup schedule`}
          control={
            <CheckboxFormController
              control={control}
              name={`backup.configurations.${configurationIndex}.enabled`}
            />
          }
        />
      </Grid>
      {outputs.length > 0 && (
        <>
          <Grid size={12}>
            <Controller
              control={control}
              name={`backup.configurations.${configurationIndex}.outputs.0.tempDir`}
              render={({ field }) => (
                <TextField
                  {...field}
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(event.target.value || undefined)
                  }
                  fullWidth
                  label={t`Temporary backup folder`}
                  helperText={t`Leave empty to use the server's temporary directory.`}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              control={control}
              name={`backup.configurations.${configurationIndex}.outputs.0.outputPath`}
              render={({ field }) => (
                <TextField
                  fullWidth
                  label={t`Backup folder`}
                  {...field}
                  helperText={t`Leave empty to save backups in the backups folder of Tunarr's data directory (/config/tunarr/backups in Docker).`}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <NumericFormControllerText
              control={control}
              name={`backup.configurations.${configurationIndex}.outputs.0.maxBackups`}
              prettyFieldName={t`Backups to keep`}
              rules={{ min: 0 }}
              TextFieldProps={{
                label: t`Backups to keep`,
                helperText: t`Older backups past this count are deleted. 0 keeps them all.`,
              }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth>
              <InputLabel
                id={`backup-${configurationIndex}-archive-format-label`}
              >
                <Trans>Archive format</Trans>
              </InputLabel>
              <Controller
                control={control}
                name={`backup.configurations.${configurationIndex}.outputs.0.archiveFormat`}
                render={({ field }) => (
                  <Select
                    {...field}
                    labelId={`backup-${configurationIndex}-archive-format-label`}
                    id={`backup-${configurationIndex}-archive-format`}
                    value={
                      field.value === 'tar' && gzip ? 'targz' : field.value
                    }
                    label={t`Archive format`}
                    onChange={(ev) => handleArchiveFormatUpdate(ev)}
                  >
                    <MenuItem value="zip">.zip</MenuItem>
                    <MenuItem value="tar">.tar</MenuItem>
                    <MenuItem value="targz">.tar.gz</MenuItem>
                  </Select>
                )}
              />
            </FormControl>
          </Grid>
        </>
      )}
      <Grid size={{ xs: 12 }}>
        <ScheduleFields
          name={`backup.configurations.${configurationIndex}.schedule`}
          intervalLabel={t`Backup interval`}
          id={`backup-${configurationIndex}-schedule`}
          editableCron
        />
      </Grid>
    </>
  );
};
