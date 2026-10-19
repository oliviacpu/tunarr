import { renderWithProviders, screen, within } from '@/test/utils';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import { NewChannelPage } from './NewChannelPage.tsx';

// The page reads its working channel from the real route's loader. With no
// channel it renders only the breadcrumbs, which is what these tests check.
vi.mock('@/routes/channels_/new', () => ({
  Route: { useLoaderData: () => undefined },
}));

vi.mock('@/components/channel_config/EditChannelForm', () => ({
  EditChannelForm: () => null,
}));

function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const newChannelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/channels/new',
    component: NewChannelPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([newChannelRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('NewChannelPage', () => {
  test('shows the Channels › New breadcrumb trail', async () => {
    renderAt('/channels/new');

    const trail = await screen.findByRole('navigation', {
      name: 'channel-breadcrumbs',
    });
    expect(
      within(trail).getByRole('link', { name: 'Channels' }),
    ).toHaveAttribute('href', '/channels');
    expect(within(trail).getByText('New')).toBeInTheDocument();
  });
});
