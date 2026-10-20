import { createFileRoute } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod/v4';
import { SearchPage } from '../pages/search/SearchPage.tsx';
import { Route as RootRoute } from './__root.tsx';

export const Route = createFileRoute('/search')({
  validateSearch: zodValidator(
    z.object({
      createCollection: z.boolean().optional().catch(undefined),
    }),
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const rootLoaderData = RootRoute.useLoaderData();
  const { createCollection } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SearchPage
      creatingCollection={createCollection}
      onCollectionSaved={() => {
        navigate({
          to: '/library/smart_collections',
          search: { query: undefined },
        }).catch(console.error);
      }}
      initialSearchFilter={rootLoaderData?.searchRequest.filter ?? undefined}
    />
  );
}
