import { EditCustomShowsForm } from '@/components/custom-shows/EditCustomShowForm.tsx';
import { useSuspendedStore } from '@/hooks/useSuspendedStore.ts';
import useStore from '@/store/index.ts';
import { Trans } from '@lingui/react/macro';
import Box from '@mui/material/Box';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import PaddedPaper from '../../components/base/PaddedPaper.tsx';
import { condenseCustomShowEditorPrograms } from '../../store/selectors.ts';

export function NewCustomShowPage() {
  // The new show as the route started it; the draft holds the changes
  const customShow = useSuspendedStore(
    (s) => s.customShowEditor.originalEntity,
  );
  const customShowPrograms = useStore((s) =>
    condenseCustomShowEditorPrograms(s.customShowEditor.programList),
  );

  return (
    <Box>
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={<Trans>New Custom Show</Trans>}
      />
      <PaddedPaper sx={{ mb: 2 }}>
        <EditCustomShowsForm
          isNew={true}
          customShow={customShow}
          customShowPrograms={customShowPrograms}
        />
      </PaddedPaper>
    </Box>
  );
}
