import Breadcrumbs from '@/components/Breadcrumbs';
import PaddedPaper from '@/components/base/PaddedPaper';
import { EditFillerListForm } from '@/components/filler/EditFillerListForm';
import { useSuspendedStore } from '@/hooks/useSuspendedStore.ts';
import { Trans } from '@lingui/react/macro';
import Box from '@mui/material/Box';
import { PageHeader } from '@/components/base/PageHeader.tsx';

export function NewFillerPage() {
  // The new list as the route started it; the draft holds the changes
  const fillerList = useSuspendedStore(
    (s) => s.fillerListEditor.originalEntity,
  );

  return (
    <Box>
      <Box>
        <PageHeader
          breadcrumbs={<Breadcrumbs />}
          title={<Trans>New Filler List</Trans>}
        />
        <PaddedPaper sx={{ mb: 2 }}>
          <EditFillerListForm fillerList={fillerList} isNew={true} />
        </PaddedPaper>
      </Box>
    </Box>
  );
}
