import { Trans } from '@lingui/react/macro';
import { Box, Stack } from '@mui/material';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { MediaSourceLibraryTable } from '../../components/MediaSourceLibraryTable.tsx';

export default function LibraryIndexPage() {
  return (
    <Box>
      <PageHeader title={<Trans>Library</Trans>} />
      <Stack gap={2}>
        <MediaSourceLibraryTable />
      </Stack>
    </Box>
  );
}
