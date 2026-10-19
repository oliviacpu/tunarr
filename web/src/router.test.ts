import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { routeTree } from './routeTree.gen.ts';

// The app's route tree with in-memory history, so a test can start anywhere
function createTestRouter(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
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
});
