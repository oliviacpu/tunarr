import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { CustomShow } from '@tunarr/types';
import { useCustomShows } from './useCustomShows.ts';

const queryFn = vi.hoisted(() => vi.fn());
vi.mock('../generated/@tanstack/react-query.gen.ts', () => ({
  getApiCustomShowsOptions: () => ({ queryKey: ['shows'], queryFn }),
}));

function ShowList() {
  const { data } = useCustomShows();
  return <span>{data[0]?.contentCount}</span>;
}

describe('custom-show list polling', () => {
  test('refreshes queued sync results and stops polling once syncing ends', async () => {
    const show: CustomShow = {
      id: 'show',
      name: 'Show',
      contentCount: 0,
      schedulableContentCount: 0,
      totalDuration: 0,
      isSyncing: true,
    };
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    client.setQueryData(['shows'], [show]);
    queryFn.mockResolvedValue([{ ...show, contentCount: 3, isSyncing: false }]);
    const view = render(
      <QueryClientProvider client={client}>
        <ShowList />
      </QueryClientProvider>,
    );
    expect(screen.getByText('0')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument(), {
      timeout: 2_000,
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(queryFn).toHaveBeenCalledTimes(1);
    view.unmount();
    client.clear();
  });
});
