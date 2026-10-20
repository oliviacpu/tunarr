import { renderWithProviders, screen } from '@/test/utils';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, test } from 'vitest';
import { SettingsLayout } from './SettingsLayout.tsx';

function renderLayout() {
  const rootRoute = createRootRoute({
    component: () => <SettingsLayout currentTab="/general" />,
  });
  const generalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/general',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([generalRoute]),
    history: createMemoryHistory({ initialEntries: ['/settings/general'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('SettingsLayout', () => {
  test('groups the tabs by task and describes the current tab', async () => {
    renderLayout();

    await screen.findByRole('tab', { name: 'General' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'General',
      'Playback',
      'Captions & audio',
      'Guide',
      'Tuner',
      'Library',
      'Experimental',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/settings/general',
      '/settings/playback',
      '/settings/captions-audio',
      '/settings/guide',
      '/settings/tuner',
      '/settings/library',
      '/settings/experimental',
    ]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'General' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Manage web preferences, server access, logging, and backups.',
      ),
    ).toBeInTheDocument();
  });
});
