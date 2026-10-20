import { FormControl, FormControlLabel, FormHelperText } from '@mui/material';
import type { ReactNode } from 'react';
import type { FieldPathByValue } from 'react-hook-form';
import { CheckboxFormController } from '../../util/TypedController.tsx';
import type { TranscodeConfigFormValues } from './useTranscodeConfigForm.ts';
import { useTranscodeConfigFormContext } from './useTranscodeConfigForm.ts';

type Props = {
  name: FieldPathByValue<TranscodeConfigFormValues, boolean | undefined>;
  label: string;
  helperText?: ReactNode;
};

/** A checkbox for one of the transcode config's on/off options. */
export function TranscodeConfigCheckbox({ name, label, helperText }: Props) {
  const { control } = useTranscodeConfigFormContext();
  return (
    <FormControl fullWidth>
      <FormControlLabel
        control={<CheckboxFormController control={control} name={name} />}
        label={label}
      />
      {helperText !== undefined && (
        <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
}
