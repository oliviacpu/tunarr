import { getChannelsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/utils';
import type { Channel } from '@tunarr/types';
import type {
  BulkChannelDeleteResponse,
  BulkChannelStealthResponse,
} from '@tunarr/types/api';
import { QueryClient } from '@tanstack/react-query';
import { SnackbarProvider } from 'notistack';
import { Suspense, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import ChannelsPage from './ChannelsPage.tsx';

const {
  mockDeleteChannel,
  mockGetChannel,
  mockPutChannel,
  mockBulkStealth,
  mockBulkDelete,
  mockGetChannels,
  mockNavigate,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn<() => Promise<void>>(),
  mockBulkDelete: vi.fn<(opts: BulkDeleteOpts) => Promise<{ data: unknown }>>(),
  mockBulkStealth: vi.fn<(opts: BulkOpts) => Promise<{ data: unknown }>>(),
  mockGetChannels: vi.fn<() => Promise<{ data: Channel[] }>>(),
  mockDeleteChannel: vi.fn<(opts: IdOpts) => Promise<unknown>>(),
  mockGetChannel: vi.fn<(opts: IdOpts) => Promise<unknown>>(),
  mockPutChannel: vi.fn<(opts: PutOpts) => Promise<unknown>>(),
}));

function makeChannel(
  overrides: Partial<Channel> & Pick<Channel, 'id' | 'name' | 'number'>,
): Channel {
  return {
    disableFillerOverlay: false,
    duration: 3_600_000,
    groupTitle: 'tunarr',
    guideMinimumDuration: 30_000,
    icon: { path: '', width: 0, duration: 0, position: 'bottom-right' },
    offline: { mode: 'pic' },
    startTime: 1_700_000_000_000,
    stealth: false,
    onDemand: { enabled: false },
    programCount: 10,
    streamMode: 'hls',
    transcodeConfigId: '00000000-0000-0000-0000-000000000000',
    subtitlesEnabled: false,
    subtitlePreferenceMode: 'inherit',
    sessions: [],
    ...overrides,
  };
}

// The list's copy of a channel: no filler lists, as GET /api/channels sends it
const channels = [
  makeChannel({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Movie Night',
    number: 1,
    sessions: [
      { type: 'hls', state: 'started', numConnections: 1, connections: [] },
    ],
  }),
  makeChannel({
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Cartoons',
    number: 2,
  }),
  makeChannel({
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Test Pattern',
    number: 3,
    stealth: true,
  }),
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getChannels: () => mockGetChannels(),
  bulkSetChannelStealth: (opts: BulkOpts) => mockBulkStealth(opts),
  bulkDeleteChannels: (opts: BulkDeleteOpts) => mockBulkDelete(opts),
  getApiTranscodeConfigs: () => Promise.resolve({ data: [] }),
  deleteApiChannelsById: (opts: IdOpts) => mockDeleteChannel(opts),
  getChannelsByNumberV2: (opts: IdOpts) => mockGetChannel(opts),
  putApiChannelsById: (opts: PutOpts) => mockPutChannel(opts),
}));

vi.mock('@tanstack/react-router', async () => {
  const { forwardRef } = await import('react');
  return {
    Link: forwardRef<
      HTMLAnchorElement,
      AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a {...props} ref={ref} />),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../components/base/RouterButtonLink.tsx', () => ({
  RouterButtonLink: ({ children }: { children?: ReactNode }) => (
    <a>{children}</a>
  ),
  RouterIconButtonLink: ({ children }: { children?: ReactNode }) => (
    <a>{children}</a>
  ),
}));

vi.mock('../../components/base/RouterLink.tsx', () => ({
  RouterLink: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

type IdOpts = { path: { id: string } };
type PutOpts = IdOpts & { body: Record<string, unknown> };
type BulkDeleteOpts = { body: { ids: string[] }; throwOnError: boolean };
type BulkOpts = {
  body: { ids: string[]; stealth: boolean };
  throwOnError: boolean;
};

function success(ids: string[]): { data: BulkChannelStealthResponse } {
  return {
    data: {
      results: ids.map((id) => ({ id, success: true })),
      refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
    },
  };
}

function deletionSuccess(ids: string[]): { data: BulkChannelDeleteResponse } {
  return {
    data: {
      results: ids.map((id) => ({
        id,
        success: true,
        cleanup: { status: 'succeeded' },
      })),
      refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
    },
  };
}

function rowCheckbox(name: string) {
  const row = screen.getByText(name).closest('tr');
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getByRole('checkbox', {
    name: 'Toggle select row',
  });
}

function selectionToolbar() {
  return screen.getByRole('group', { name: 'Selected rows' });
}

function renderPage(
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  }),
) {
  const rendered = renderWithProviders(
    <SnackbarProvider maxSnack={3}>
      <Suspense fallback={null}>
        <ChannelsPage />
      </Suspense>
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, queryClient };
}

describe('ChannelsPage bulk actions', () => {
  beforeEach(() => {
    mockDeleteChannel.mockReset();
    mockDeleteChannel.mockResolvedValue({ data: undefined });
    mockGetChannel.mockReset();
    mockPutChannel.mockReset();
    mockGetChannels.mockReset();
    mockGetChannels.mockResolvedValue({ data: channels });
    mockBulkDelete.mockReset();
    mockBulkDelete.mockImplementation(({ body }) =>
      Promise.resolve(deletionSuccess(body.ids)),
    );
    mockBulkStealth.mockReset();
    mockBulkStealth.mockImplementation(({ body }) =>
      Promise.resolve(success(body.ids)),
    );
  });

  test('deletes exactly the selected channels and clears the selection', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');

    await user.click(rowCheckbox('Movie Night'));
    await user.click(rowCheckbox('Test Pattern'));
    expect(selectionToolbar()).toHaveTextContent('2 selected');
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 2 channels?');
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Movie Night', 'Test Pattern']);
    expect(mockDeleteChannel).not.toHaveBeenCalled();
    expect(mockBulkDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockBulkDelete).toHaveBeenCalledExactlyOnceWith({
        body: {
          ids: [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000003',
          ],
        },
        throwOnError: true,
      }),
    );
    expect(mockDeleteChannel).not.toHaveBeenCalled();
    expect(await screen.findByText('Deleted')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(rowCheckbox('Movie Night')).not.toBeChecked();
  });

  test('cancel closes the confirmation without deleting', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockBulkDelete).not.toHaveBeenCalled();
    expect(rowCheckbox('Movie Night')).toBeChecked();
  });

  test('freezes names on open and keeps the confirmation busy until the request finishes', async () => {
    const fetched = channels.map((channel) => ({ ...channel }));
    mockGetChannels.mockResolvedValue({ data: fetched });
    let finish:
      | ((response: { data: BulkChannelDeleteResponse }) => void)
      | undefined;
    mockBulkDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user, queryClient } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog');
    act(() => {
      const channel = fetched[0];
      if (channel === undefined) throw new Error('Missing channel');
      channel.name = 'Renamed channel';
      queryClient.setQueryData(
        getChannelsQueryKey(),
        fetched.map((channel) => ({
          ...channel,
          duration: channel.duration + 1,
        })),
      );
    });
    await screen.findByText('Renamed channel');
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(
      'Movie Night',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(mockBulkDelete).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    const toolbar = screen.getByLabelText('Selected rows');
    for (const button of within(toolbar).getAllByRole('button', {
      hidden: true,
    }))
      expect(button).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    if (finish === undefined) throw new Error('Delete did not start');
    finish({
      data: {
        results: [
          {
            id: channels[0]?.id ?? '',
            success: false,
            statusCode: 500,
            message: 'Delete failed',
            cleanup: { status: 'not_needed' },
          },
        ],
        refresh: { xmltv: 'not_needed', m3u: 'not_needed' },
      },
    });
    expect(
      await screen.findByText(
        '0 of 1 deleted; could not delete Movie Night: Delete failed',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockBulkDelete).toHaveBeenCalledExactlyOnceWith({
      body: { ids: [channels[0]?.id] },
      throwOnError: true,
    });
    expect(mockDeleteChannel).not.toHaveBeenCalled();
  });

  test('reports committed deletions, failed deletions, cleanup and publication independently', async () => {
    mockBulkDelete.mockResolvedValue({
      data: {
        results: [
          {
            id: channels[0]?.id,
            success: true,
            cleanup: { status: 'failed', message: 'Redirect cleanup failed' },
          },
          {
            id: channels[1]?.id,
            success: false,
            statusCode: 500,
            message: 'Delete failed',
            cleanup: { status: 'failed', message: 'Restoration failed' },
          },
          {
            id: channels[2]?.id,
            success: false,
            statusCode: 404,
            message: 'Channel not found',
            cleanup: { status: 'not_needed' },
          },
        ],
        refresh: { xmltv: 'failed', m3u: 'failed' },
      },
    });
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(
      screen.getByRole('checkbox', { name: 'Toggle select all' }),
    );
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText(
        '1 of 3 deleted; could not delete Cartoons: Delete failed; could not delete Test Pattern: Channel not found',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Deleted Movie Night, but cleanup failed: Redirect cleanup failed; Cleanup failed for Cartoons after deletion failed: Restoration failed',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Channels were deleted, but publication failed for XMLTV guide, M3U playlist. These files may be out of date.',
      ),
    ).toBeInTheDocument();
    expect(mockBulkDelete).toHaveBeenCalledOnce();
  });

  test('a committed delete with failed cleanup is still a success', async () => {
    mockBulkDelete.mockResolvedValue({
      data: {
        results: [
          {
            id: channels[0]?.id,
            success: true,
            cleanup: { status: 'failed', message: 'Redirect cleanup failed' },
          },
        ],
        refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
      },
    });
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Deleted Movie Night, but cleanup failed: Redirect cleanup failed',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not delete/)).not.toBeInTheDocument();
    expect(mockBulkDelete).toHaveBeenCalledOnce();
  });

  test.each(['lost', 'malformed', 'missing', 'cleanup', 'reordered'])(
    'a %s deletion response is uncertain, refetches, and never retries',
    async (failure) => {
      if (failure === 'lost') {
        mockBulkDelete.mockRejectedValue(new Error('Connection lost'));
      } else {
        const data = deletionSuccess([
          channels[0]?.id ?? '',
          channels[1]?.id ?? '',
        ]).data;
        if (failure === 'missing') data.results.pop();
        if (failure === 'reordered') data.results.reverse();
        mockBulkDelete.mockResolvedValue({
          data:
            failure === 'malformed'
              ? {}
              : failure === 'cleanup'
                ? {
                    ...data,
                    results: data.results.map(({ id, success }) => ({
                      id,
                      success,
                    })),
                  }
                : data,
        });
      }
      const { user, queryClient } = renderPage();
      await screen.findByText('Movie Night');
      await user.click(rowCheckbox('Movie Night'));
      await user.click(rowCheckbox('Cartoons'));
      await user.click(
        within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
      );
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      const before = mockGetChannels.mock.calls.length;
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Delete',
        }),
      );
      expect(
        await screen.findByText(
          '0 of 2 confirmed deleted; Outcome unknown for Movie Night, Cartoons. Channels may have been deleted. Refreshing channels to check; no automatic retry.',
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(mockGetChannels).toHaveBeenCalledTimes(before + 1),
      );
      expect(mockBulkDelete).toHaveBeenCalledOnce();
      expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    },
  );

  test('Hide from guide sends one stealth-only batch and clears the selection', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { user } = renderPage(queryClient);
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(rowCheckbox('Cartoons'));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const channelFetchesBeforeSave = mockGetChannels.mock.calls.length;
    const toolbar = selectionToolbar();
    expect(
      within(toolbar).getByRole('button', { name: 'Show in guide' }),
    ).toBeDisabled();
    await user.click(
      within(toolbar).getByRole('button', { name: 'Hide from guide' }),
    );
    await waitFor(() =>
      expect(mockBulkStealth).toHaveBeenCalledExactlyOnceWith({
        body: {
          ids: [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
          ],
          stealth: true,
        },
        throwOnError: true,
      }),
    );
    expect(mockGetChannel).not.toHaveBeenCalled();
    expect(mockPutChannel).not.toHaveBeenCalled();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Selected rows' }),
      ).not.toBeInTheDocument(),
    );
    expect(rowCheckbox('Cartoons')).not.toBeChecked();
    expect(invalidate).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(mockGetChannels).toHaveBeenCalledTimes(
        channelFetchesBeforeSave + 1,
      ),
    );
  });

  test('Show in guide sends only the channels that are hidden', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Cartoons'));
    await user.click(rowCheckbox('Test Pattern'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Show in guide' }),
    );
    await waitFor(() =>
      expect(mockBulkStealth).toHaveBeenCalledExactlyOnceWith({
        body: { ids: ['00000000-0000-4000-8000-000000000003'], stealth: false },
        throwOnError: true,
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  test('a partial stealth failure names the channel that was not saved', async () => {
    mockBulkStealth.mockResolvedValue({
      data: {
        results: [
          { id: '00000000-0000-4000-8000-000000000001', success: true },
          {
            id: '00000000-0000-4000-8000-000000000002',
            success: false,
            statusCode: 404,
            message: 'Channel not found',
          },
        ],
        refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
      },
    });
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(rowCheckbox('Cartoons'));
    await user.click(
      within(selectionToolbar()).getByRole('button', {
        name: 'Hide from guide',
      }),
    );
    expect(
      await screen.findByText(
        '1 of 2 saved; could not save Cartoons: Channel not found',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  test('publication failure warns separately from the saved channel outcome', async () => {
    mockBulkStealth.mockResolvedValue({
      data: {
        results: [
          { id: '00000000-0000-4000-8000-000000000001', success: true },
        ],
        refresh: { xmltv: 'failed', m3u: 'succeeded' },
      },
    });
    const { user } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', {
        name: 'Hide from guide',
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Channel changes were saved, but publication failed for XMLTV guide. These files may be out of date.',
      ),
    ).toBeInTheDocument();
    expect(mockBulkStealth).toHaveBeenCalledOnce();
  });

  test.each(['lost', 'malformed', 'missing'])(
    'a %s response is uncertain, refetches, and never retries',
    async (failure) => {
      if (failure === 'lost') {
        mockBulkStealth.mockRejectedValue(new Error('Connection lost'));
      } else {
        mockBulkStealth.mockResolvedValue({
          data: failure === 'missing' ? success([]).data : {},
        });
      }
      const { user, queryClient } = renderPage();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await screen.findByText('Movie Night');
      await user.click(rowCheckbox('Movie Night'));
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      const channelFetchesBeforeSave = mockGetChannels.mock.calls.length;
      await user.click(
        within(selectionToolbar()).getByRole('button', {
          name: 'Hide from guide',
        }),
      );
      expect(
        await screen.findByText(
          '0 of 1 confirmed saved; Outcome unknown for Movie Night. Changes may have been saved. Refreshing channels to check; no automatic retry.',
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(mockGetChannels).toHaveBeenCalledTimes(
          channelFetchesBeforeSave + 1,
        ),
      );
      expect(invalidate).toHaveBeenCalledOnce();
      expect(mockBulkStealth).toHaveBeenCalledOnce();
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    },
  );

  test('keeps actions busy and snapshots the selected channel and name', async () => {
    let finish:
      | ((response: { data: BulkChannelStealthResponse }) => void)
      | undefined;
    mockBulkStealth.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user, queryClient } = renderPage();
    await screen.findByText('Movie Night');
    await user.click(rowCheckbox('Movie Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', {
        name: 'Hide from guide',
      }),
    );
    for (const button of within(selectionToolbar()).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    await user.click(rowCheckbox('Cartoons'));
    act(() => {
      queryClient.setQueryData(
        getChannelsQueryKey(),
        channels.map((channel) =>
          channel.number === 1
            ? { ...channel, name: 'Renamed channel' }
            : channel,
        ),
      );
    });
    await screen.findByText('Renamed channel');
    expect(mockBulkStealth).toHaveBeenCalledOnce();
    if (finish === undefined) throw new Error('request was not started');
    finish({
      data: {
        results: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            success: false,
            statusCode: 500,
            message: 'Write failed',
          },
        ],
        refresh: { xmltv: 'not_needed', m3u: 'not_needed' },
      },
    });
    expect(
      await screen.findByText(
        '0 of 1 saved; could not save Movie Night: Write failed',
      ),
    ).toBeInTheDocument();
    expect(mockBulkStealth).toHaveBeenCalledExactlyOnceWith({
      body: { ids: ['00000000-0000-4000-8000-000000000001'], stealth: true },
      throwOnError: true,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Selected rows' }),
      ).not.toBeInTheDocument(),
    );
  });

  test('the select-all checkbox is labelled and selects the page', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');

    await user.click(
      screen.getByRole('checkbox', { name: 'Toggle select all' }),
    );
    expect(selectionToolbar()).toHaveTextContent('3 selected');
    // A mix of shown and hidden channels: both stealth actions apply
    expect(
      within(selectionToolbar()).getByRole('button', {
        name: 'Hide from guide',
      }),
    ).toBeEnabled();
    expect(
      within(selectionToolbar()).getByRole('button', {
        name: 'Show in guide',
      }),
    ).toBeEnabled();
  });
});

describe('ChannelsPage mobile card actions', () => {
  beforeEach(() => {
    mockGetChannels.mockReset();
    mockGetChannels.mockResolvedValue({ data: channels });
    mockNavigate.mockReset();
    mockNavigate.mockResolvedValue();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  test('keeps card navigation and secondary controls separate', async () => {
    const { container } = renderPage();
    const title = await screen.findByText('Ch 1 · Movie Night');
    const navigation = title.closest('button');
    expect(navigation).not.toBeNull();
    expect(container.querySelector('button button')).toBeNull();
    expect(navigation).toHaveAccessibleName('Open channel Movie Night');

    const options = screen.getByRole('button', {
      name: 'Options for Movie Night',
    });
    const sessions = screen.getByRole('button', {
      name: 'View sessions for Movie Night',
    });
    expect(navigation).not.toContainElement(options);
    expect(navigation).not.toContainElement(sessions);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('1–3 of 3')).toBeInTheDocument();
  });

  test('opens the channel with pointer, Enter and Space', async () => {
    const { user } = renderPage();
    const navigation = await screen.findByRole('button', {
      name: 'Open channel Movie Night',
    });
    await user.click(navigation);
    navigation.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(mockNavigate).toHaveBeenCalledTimes(3);
    expect(mockNavigate).toHaveBeenLastCalledWith({
      to: '/channels/$channelId',
      params: { channelId: '00000000-0000-4000-8000-000000000001' },
    });
  });

  test('opens and dismisses options without navigating and restores keyboard focus', async () => {
    const { user } = renderPage();
    const navigation = await screen.findByRole('button', {
      name: 'Open channel Movie Night',
    });
    const options = screen.getByRole('button', {
      name: 'Options for Movie Night',
    });
    navigation.focus();
    await user.tab();
    expect(options).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(options).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(options).toHaveFocus();
    expect(options).toHaveAttribute('aria-expanded', 'false');

    await user.click(options);
    expect(
      await screen.findByRole('menuitem', { name: 'Watch Channel' }),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('opens session details with pointer and keyboard without navigating', async () => {
    const { user } = renderPage();
    const sessions = await screen.findByRole('button', {
      name: 'View sessions for Movie Night',
    });
    await user.click(sessions);
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('"Movie Night" Sessions');
    expect(dialog).toHaveTextContent('"numConnections": 1');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    sessions.focus();
    await user.keyboard(' ');
    dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('"Movie Night" Sessions');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
