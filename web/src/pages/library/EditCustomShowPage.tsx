import { EditCustomShowsForm } from '@/components/custom-shows/EditCustomShowForm.tsx';
import { useCustomShowWithProgramming } from '@/hooks/useCustomShows.ts';
import { Route } from '@/routes/library/custom-shows_/$showId/edit.tsx';
import useStore from '@/store/index.ts';
import { Trans } from '@lingui/react/macro';
import { LinearProgress } from '@mui/material';
import Box from '@mui/material/Box';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import PaddedPaper from '../../components/base/PaddedPaper.tsx';
import { condenseCustomShowEditorPrograms } from '../../store/selectors.ts';

type Props = { isNew?: boolean };

export default function EditCustomShowPage({ isNew }: Props) {
  const { showId } = Route.useParams();
  const [{ data: customShow }] = useCustomShowWithProgramming(showId);
  const customShowPrograms = useStore((s) =>
    condenseCustomShowEditorPrograms(s.customShowEditor.programList),
  );

  return !customShow ? (
    <LinearProgress />
  ) : (
    <Box>
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={isNew ? <Trans>New Custom Show</Trans> : customShow.name}
      />
      <PaddedPaper sx={{ mb: 2 }}>
        <EditCustomShowsForm
          isNew={false}
          customShow={customShow}
          customShowPrograms={customShowPrograms}
        />
      </PaddedPaper>
    </Box>
  );
}
