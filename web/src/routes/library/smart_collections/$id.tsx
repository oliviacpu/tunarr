import { orNotFound } from '@/helpers/routeLoaders.ts';
import { PageHeader } from '@/components/base/PageHeader.tsx';
import { Trans } from '@lingui/react/macro';
import { Stack } from '@mui/material';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { isNonEmptyString } from '@tunarr/shared/util';
import type { SearchRequest } from '@tunarr/types/schemas';
import { LibraryProgramGrid } from '../../../components/library/LibraryProgramGrid.tsx';
import { SearchInput } from '../../../components/search/SearchInput.tsx';
import { getApiSmartCollectionsByIdOptions } from '../../../generated/@tanstack/react-query.gen.ts';
import { programSearchQueryOpts } from '../../../hooks/useProgramSearchQuery.ts';
import useStore from '../../../store/index.ts';

export const Route = createFileRoute('/library/smart_collections/$id')({
  gcTime: 0,
  loader: async ({ context: { queryClient }, params }) => {
    const smartCollection = await orNotFound(
      queryClient.fetchQuery(
        getApiSmartCollectionsByIdOptions({
          path: {
            id: params.id,
          },
        }),
      ),
    );

    const searchRequest: SearchRequest = {
      filter: smartCollection.filter,
      query: isNonEmptyString(smartCollection.keywords)
        ? smartCollection.keywords
        : undefined,
    };
    await queryClient.prefetchInfiniteQuery(
      programSearchQueryOpts(undefined, undefined, searchRequest),
    );

    useStore.setState((s) => {
      s.currentSearchRequest = searchRequest;
    });

    return searchRequest satisfies SearchRequest;
  },
  component: RouteComponent,
});

// eslint-disable-next-line react-refresh/only-export-components
function RouteComponent() {
  const { id } = Route.useParams();
  const { filter, query } = Route.useLoaderData();
  const { data: smartCollection } = useSuspenseQuery({
    ...getApiSmartCollectionsByIdOptions({ path: { id } }),
    refetchOnMount: false,
  });
  return (
    <Stack gap={2}>
      <PageHeader
        title={<Trans>Smart Collection: {smartCollection.name}</Trans>}
      />
      <SearchInput
        initialSearchFilter={filter ?? undefined}
        initialKeywords={query ?? undefined}
      />
      <LibraryProgramGrid />
    </Stack>
  );
}
