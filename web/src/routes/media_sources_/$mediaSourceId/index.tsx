import { PageHeader } from '@/components/base/PageHeader.tsx';
import { Trans } from '@lingui/react/macro';
import { Box, Stack } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramViewToggleButton } from '../../../components/base/ProgramViewToggleButton.tsx';
import Breadcrumbs from '../../../components/Breadcrumbs.tsx';
import { LibraryProgramGrid } from '../../../components/library/LibraryProgramGrid.tsx';
import { SearchInput } from '../../../components/search/SearchInput.tsx';
import { getApiMediaSourcesByMediaSourceIdOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import { useMediaSource } from '../../../hooks/media-sources/mediaSourceHooks.ts';
import { setSearchRequest } from '../../../store/programmingSelector/actions.ts';

export const Route = createFileRoute('/media_sources_/$mediaSourceId/')({
  component: MediaSourceBrowserPage,
  loader: async ({ context, params: { mediaSourceId } }) => {
    await context.queryClient.ensureQueryData(
      getApiMediaSourcesByMediaSourceIdOptions({
        path: {
          mediaSourceId,
        },
      }),
    );
    setSearchRequest(null);
  },
});

// eslint-disable-next-line react-refresh/only-export-components
function MediaSourceBrowserPage() {
  const { mediaSourceId } = Route.useParams();
  const { data: mediaSource } = useMediaSource(mediaSourceId);

  return (
    <Box>
      <PageHeader
        breadcrumbs={<Breadcrumbs thisRouteName={mediaSource.name} />}
        title={<Trans>Media Source: "{mediaSource.name}"</Trans>}
        description={
          <Trans>Search is currently scoped to this Media Source.</Trans>
        }
        actions={<ProgramViewToggleButton />}
      />
      <Stack gap={2}>
        <SearchInput />
        <LibraryProgramGrid mediaSource={mediaSource} disableProgramSelection />
      </Stack>
    </Box>
  );
}
