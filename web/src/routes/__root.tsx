import { Root } from '@/App';
import { TanStackRouterDevtools } from '@/dev/TanStackRouterDevtools';
import { RouteErrorPage } from '@/pages/ErrorPage';
import type { RouterContext } from '@/types/RouterContext';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { isNonEmptyString, search as tunarrSearch } from '@tunarr/shared/util';
import type { SearchRequest } from '@tunarr/types/schemas';
import { z } from 'zod/v4';
import { programSearchQueryOpts } from '../hooks/useProgramSearchQuery.ts';
import { parseSearchQuery } from '../hooks/useSearchQueryParser.ts';
import useStore from '../store/index.ts';

const searchQuerySchema = z.object({
  query: z.string().optional().catch(undefined),
});

export type RootSearchQueryParams = z.infer<typeof searchQuerySchema>;

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: zodValidator(searchQuerySchema),
  loader: async ({
    context: { queryClient },
    location: { search, pathname },
  }) => {
    const parsed = search as RootSearchQueryParams;
    if (!isNonEmptyString(parsed.query)) {
      useStore.setState((s) => {
        s.currentSearchRequest = null;
      });
      return;
    }

    const parseResult = parseSearchQuery(parsed.query);

    const searchRequest: SearchRequest = {
      query: '',
      filter: null,
      sort: null,
    };

    if (parseResult?.type === 'success') {
      searchRequest.filter = tunarrSearch.parsedSearchToRequest(
        parseResult.query,
      );
      searchRequest.query = null;
    } else {
      searchRequest.query = parsed.query;
    }

    console.log(pathname);
    await queryClient.prefetchInfiniteQuery(
      programSearchQueryOpts(undefined, undefined, searchRequest),
    );
    useStore.setState((s) => {
      s.currentSearchRequest = searchRequest;
    });

    return {
      searchRequest,
    };
  },
  component: RootPage,
  // Unmatched addresses use the router's defaultNotFoundComponent, inside the
  // shell. Errors below the root use defaultErrorComponent in place of the
  // failed page; this one covers the root itself, so it draws the shell too.
  errorComponent: (props) => {
    return (
      <Root>
        <RouteErrorPage {...props} />
        <TanStackRouterDevtools />
      </Root>
    );
  },
});

function RootPage() {
  return (
    <>
      <Root />
      <TanStackRouterDevtools />
    </>
  );
}
