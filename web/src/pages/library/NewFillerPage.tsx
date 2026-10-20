import Breadcrumbs from '@/components/Breadcrumbs';
import PaddedPaper from '@/components/base/PaddedPaper';
import { EditFillerListForm } from '@/components/filler/EditFillerListForm';
import { useSuspendedStore } from '@/hooks/useSuspendedStore.ts';
import { Trans } from '@lingui/react/macro';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export function NewFillerPage() {
  // The new list as the route started it; the draft holds the changes
  const fillerList = useSuspendedStore(
    (s) => s.fillerListEditor.originalEntity,
  );

  return (
    <Box>
      <Breadcrumbs />
      <Box>
        <Box>
          <Typography variant="h4" sx={{ mb: 2 }}>
            <Trans>New Filler List</Trans>
          </Typography>
        </Box>
        <PaddedPaper sx={{ mb: 2 }}>
          <EditFillerListForm fillerList={fillerList} isNew={true} />
        </PaddedPaper>
      </Box>
    </Box>
  );
}
