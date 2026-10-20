import { createFileRoute } from '@tanstack/react-router';
import { SearchPage } from '../pages/search/SearchPage.tsx';
import { Route as RootRoute } from './__root.tsx';

export const Route = createFileRoute('/search')({
  component: RouteComponent,
});

function RouteComponent() {
  const rootLoaderData = RootRoute.useLoaderData();
  return (
    <SearchPage
      initialSearchFilter={rootLoaderData?.searchRequest.filter ?? undefined}
    />
  );
}
