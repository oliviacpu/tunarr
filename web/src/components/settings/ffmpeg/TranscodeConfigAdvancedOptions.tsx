import { useLingui } from '@lingui/react/macro';
import { Stack } from '@mui/material';
import { TranscodeConfigCheckbox } from './TranscodeConfigCheckbox.tsx';

export const TranscodeConfigAdvancedOptions = () => {
  const { t } = useLingui();

  return (
    <Stack gap={2}>
      <TranscodeConfigCheckbox
        name="disableHardwareDecoder"
        label={t`Disable hardware decoding`}
        helperText={t`Decodes video on the CPU even with hardware acceleration on.`}
      />
      <TranscodeConfigCheckbox
        name="disableHardwareEncoding"
        label={t`Disable hardware encoding`}
        helperText={t`Encodes video on the CPU even with hardware acceleration on.`}
      />
      <TranscodeConfigCheckbox
        name="disableHardwareFilters"
        label={t`Disable hardware filters`}
        helperText={t`Runs filters such as scaling and padding on the CPU even with hardware acceleration on.`}
      />
    </Stack>
  );
};
