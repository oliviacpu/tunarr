import { orNotFound } from '@/helpers/routeLoaders.ts';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import { Trans } from '@lingui/react/macro';
import { Box, Stack } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramViewToggleButton } from '../../../components/base/ProgramViewToggleButton.tsx';
import { LibraryProgramGrid } from '../../../components/library/LibraryProgramGrid.tsx';
import { SearchInput } from '../../../components/search/SearchInput.tsx';
import {
  MediaSourceLibraryQueryOpts,
  useMediaSourceLibrary,
} from '../../../hooks/media-sources/mediaSourceLibraryHooks.ts';
import { setSearchRequest } from '../../../store/programmingSelector/actions.ts';

export const Route = createFileRoute(
  '/media_sources_/$mediaSourceId/libraries_/$libraryId',
)({
  component: MediaSourceBrowserPage,
  loader: async ({ context, params: { libraryId } }) => {
    await orNotFound(
      context.queryClient.ensureQueryData(
        MediaSourceLibraryQueryOpts(libraryId),
      ),
    );
    setSearchRequest(null);
  },
});

// eslint-disable-next-line react-refresh/only-export-components
function MediaSourceBrowserPage() {
  const { libraryId } = Route.useParams();
  const { data: library } = useMediaSourceLibrary(libraryId);

  return (
    <Box>
      <PageHeader
        title={<Trans>Library: {library.name}</Trans>}
        description={
          <Trans>
            Search is scoped to {library.mediaSource.name} / {library.name}.
          </Trans>
        }
        actions={<ProgramViewToggleButton />}
      />
      <Stack gap={2}>
        <SearchInput libraryId={libraryId} />
        <LibraryProgramGrid
          mediaSource={library.mediaSource}
          library={library}
          disableProgramSelection
        />
      </Stack>
    </Box>
  );
}
