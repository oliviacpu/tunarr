import { Trans } from '@lingui/react/macro';
import { Box, Stack, Typography } from '@mui/material';
import { ScannerSettingsPage } from './ScannerSettingsPage.tsx';
import { SearchSettingsForm } from './SearchSettingsForm.tsx';

export function LibrarySettingsPage() {
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h3" sx={{ mb: 2 }}>
          <Trans>Library scans</Trans>
        </Typography>
        <ScannerSettingsPage />
      </Box>
      <SearchSettingsForm />
    </Stack>
  );
}
