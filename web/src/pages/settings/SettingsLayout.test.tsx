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
  test('names the tabs in the words people use, on the same routes', async () => {
    renderLayout();

    await screen.findByRole('tab', { name: 'General' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'General',
      'Guide',
      'Transcoding',
      'Scanner',
      'Tuner',
      'Features',
    ]);
    // Only the labels changed: bookmarks to the old paths still work
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/settings/general',
      '/settings/xmltv',
      '/settings/ffmpeg',
      '/settings/scanner',
      '/settings/hdhr',
      '/settings/features',
    ]);
  });
});
