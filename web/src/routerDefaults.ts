import { PagePending } from './components/base/PagePending.tsx';
import { RouteErrorPage } from './pages/ErrorPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';

// Loading, error and not-found UI for every route, so a page doesn't carry its
// own. A route can still set its own pendingComponent (the list pages use a
// table skeleton) or errorComponent.
export const routerDefaults = {
  // Shown in place of the page while its loader runs or its data suspends.
  // It waits 300ms before appearing, so a fast load shows nothing, and once
  // shown it stays at least 300ms, so it doesn't flash.
  defaultPendingComponent: PagePending,
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
  defaultErrorComponent: RouteErrorPage,
  defaultNotFoundComponent: NotFoundPage,
};
