import { GeneralSettingsForm } from '@/components/settings/general/GeneralSettingsForm.tsx';
import { WebSettings } from '@/components/settings/general/WebSettings.tsx';
import { Box, Divider } from '@mui/material';
import Stack from '@mui/material/Stack';
import { useSystemSettingsSuspense } from '../../hooks/useSystemSettings.ts';

// The route's loader fetches the settings, and the router's pending and error
// components cover loading and failure
export default function GeneralSettingsPage() {
  const { data: systemSettings } = useSystemSettingsSuspense();

  return (
    <Box>
      <Stack direction="column" gap={2}>
        <WebSettings />
        <Divider />
        <GeneralSettingsForm systemSettings={systemSettings} />
      </Stack>
    </Box>
  );
}
