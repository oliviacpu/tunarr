import { useLingui } from '@lingui/react/macro';
import { Stack } from '@mui/material';
import { useTypedAppFormContext } from '../../../hooks/form.ts';
import type { BaseTranscodeConfigProps } from './BaseTranscodeConfigProps.ts';
import { useBaseTranscodeConfigFormOptions } from './useTranscodeConfigFormOptions.ts';

export const TranscodeConfigAdvancedOptions = ({
  initialConfig,
}: BaseTranscodeConfigProps) => {
  const { t } = useLingui();
  const formOpts = useBaseTranscodeConfigFormOptions(initialConfig);
  const form = useTypedAppFormContext({ ...formOpts });

  return (
    <Stack gap={2}>
      <form.AppField
        name="disableHardwareDecoder"
        children={(field) => (
          <field.BasicCheckboxInput
            label={t`Disable hardware decoding`}
            formControlProps={{ fullWidth: true }}
            helperText={t`Decodes video on the CPU even with hardware acceleration on.`}
          />
        )}
      />

      <form.AppField
        name="disableHardwareEncoding"
        children={(field) => (
          <field.BasicCheckboxInput
            label={t`Disable hardware encoding`}
            formControlProps={{ fullWidth: true }}
            helperText={t`Encodes video on the CPU even with hardware acceleration on.`}
          />
        )}
      />

      <form.AppField
        name="disableHardwareFilters"
        children={(field) => (
          <field.BasicCheckboxInput
            label={t`Disable hardware filters`}
            formControlProps={{ fullWidth: true }}
            helperText={t`Runs filters such as scaling and padding on the CPU even with hardware acceleration on.`}
          />
        )}
      />
    </Stack>
  );
};
