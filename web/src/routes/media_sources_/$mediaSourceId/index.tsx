import { orNotFound } from '@/helpers/routeLoaders.ts';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import { Trans } from '@lingui/react/macro';
import { Box, Stack } from '@mui/material';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramViewToggleButton } from '../../../components/base/ProgramViewToggleButton.tsx';
import Breadcrumbs from '../../../components/Breadcrumbs.tsx';
import { LibraryProgramGrid } from '../../../components/library/LibraryProgramGrid.tsx';
import { SearchInput } from '../../../components/search/SearchInput.tsx';
import { getApiMediaSourcesByMediaSourceIdOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import { setSearchRequest } from '../../../store/programmingSelector/actions.ts';

export const Route = createFileRoute('/media_sources_/$mediaSourceId/')({
  gcTime: 0,
  component: MediaSourceBrowserPage,
  loader: async ({ context, params: { mediaSourceId } }) => {
    await orNotFound(
      context.queryClient.fetchQuery(
        getApiMediaSourcesByMediaSourceIdOptions({
          path: {
            mediaSourceId,
          },
        }),
      ),
    );
    setSearchRequest(null);
  },
});

// eslint-disable-next-line react-refresh/only-export-components
function MediaSourceBrowserPage() {
  const { mediaSourceId } = Route.useParams();
  const { data: mediaSource } = useSuspenseQuery({
    ...getApiMediaSourcesByMediaSourceIdOptions({ path: { mediaSourceId } }),
    refetchOnMount: false,
  });

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
