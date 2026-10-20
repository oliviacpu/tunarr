import UnsavedNavigationAlert from '@/components/settings/UnsavedNavigationAlert.tsx';
import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { Box, Stack, Typography } from '@mui/material';
import { ScannerSettingsPage } from './ScannerSettingsPage.tsx';
import { SearchSettingsForm } from './SearchSettingsForm.tsx';

export function LibrarySettingsPage() {
  const [scannerDirty, setScannerDirty] = useState(false);
  const [searchDirty, setSearchDirty] = useState(false);
  return (
    <Stack spacing={4}>
      <UnsavedNavigationAlert isDirty={scannerDirty || searchDirty} />
      <Box>
        <Typography variant="h3" sx={{ mb: 2 }}>
          <Trans>Library scans</Trans>
        </Typography>
        <ScannerSettingsPage onDirtyChange={setScannerDirty} />
      </Box>
      <SearchSettingsForm onDirtyChange={setSearchDirty} />
    </Stack>
  );
}
