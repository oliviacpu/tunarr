import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { RouterContext } from '@/types/RouterContext';
import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { routerDefaults } from './routerDefaults.ts';
import { routeTree } from './routeTree.gen.ts';

// The app shell polls the server and opens an event stream, so the real root
// route renders its outlet without it. The router devtools are dev-only.
vi.mock('@/App', async () => {
  const { Outlet } = await import('@tanstack/react-router');
  return {
    Root: ({ children }: { children?: ReactNode }) => children ?? <Outlet />,
  };
});
vi.mock('@/dev/TanStackRouterDevtools', () => ({
  TanStackRouterDevtools: () => null,
}));
vi.mock('@/hooks/useVersion.tsx', () => ({
  useVersion: () => ({ data: undefined, isLoading: false }),
}));

// The app's route tree and router defaults with in-memory history, so a test
// can start anywhere
function createTestRouter(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...routerDefaults,
  });
}

// A one-page tree whose loader the test controls
function createLoaderRouter(loader: () => void) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
  });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/page',
    loader,
    component: () => <p>Page loaded</p>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ['/page'] }),
    ...routerDefaults,
  });
}

describe('router', () => {
  test.each(['/settings', '/settings/'])(
    '%s redirects to the General settings tab',
    async (path) => {
      const router = createTestRouter(path);

      await router.load();

      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/settings/general'),
      );
    },
  );

  test('/settings/sources redirects to the media sources page', async () => {
    const router = createTestRouter('/settings/sources');

    await router.load();

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/media_sources'),
    );
  });

  test('an address no route matches renders the not-found page', async () => {
    const router = createTestRouter('/does-not-exist');

    renderWithProviders(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'Not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to Channels' }),
    ).toHaveAttribute('href', '/channels');
  });

  test('a loader that throws renders the error page with its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const loader = vi.fn(() => {
      calls++;
      if (calls === 1) {
        throw new Error('The server did not answer');
      }
    });
    const router = createLoaderRouter(loader);

    const { user } = renderWithProviders(<RouterProvider router={router} />);

    expect(
      await screen.findByText('The server did not answer'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Page loaded')).not.toBeInTheDocument();

    // Try again runs the loader again instead of reloading the browser
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Page loaded')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  test('a loader that throws notFound() renders the not-found page', async () => {
    const router = createLoaderRouter(() => {
      throw notFound();
    });

    renderWithProviders(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'Not found' }),
    ).toBeInTheDocument();
  });
});
