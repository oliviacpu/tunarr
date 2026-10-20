import { EditFillerListForm } from '@/components/filler/EditFillerListForm.tsx';
import { useFillerListWithProgramming } from '@/hooks/useFillerLists.ts';
import { Route } from '@/routes/library/fillers_/$fillerId/edit.tsx';
import { Trans } from '@lingui/react/macro';
import Box from '@mui/material/Box';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import PaddedPaper from '../../components/base/PaddedPaper.tsx';

export default function EditFillerPage() {
  const { fillerId } = Route.useParams();
  const [{ data: fillerList }] = useFillerListWithProgramming(fillerId);

  return (
    <Box>
      <Box>
        <PageHeader
          breadcrumbs={<Breadcrumbs />}
          title={<Trans>Edit Filler List</Trans>}
        />
        <PaddedPaper sx={{ mb: 2 }}>
          <EditFillerListForm fillerList={fillerList} isNew={false} />
        </PaddedPaper>
      </Box>
    </Box>
  );
}
