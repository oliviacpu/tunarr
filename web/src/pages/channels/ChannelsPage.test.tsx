import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import type { Channel } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import { Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import ChannelsPage from './ChannelsPage.tsx';

const { mockDeleteChannel, mockGetChannel, mockPutChannel } = vi.hoisted(
  () => ({
    mockDeleteChannel: vi.fn<(opts: IdOpts) => Promise<unknown>>(),
    mockGetChannel: vi.fn<(opts: IdOpts) => Promise<unknown>>(),
    mockPutChannel: vi.fn<(opts: PutOpts) => Promise<unknown>>(),
  }),
);

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
    sessions: [],
    ...overrides,
  };
}

// The list's copy of a channel: no filler lists, as GET /api/channels sends it
const channels = [
  makeChannel({ id: 'ch-1', name: 'Movie Night', number: 1 }),
  makeChannel({ id: 'ch-2', name: 'Cartoons', number: 2 }),
  makeChannel({ id: 'ch-3', name: 'Test Pattern', number: 3, stealth: true }),
];

// The full channel, as GET /api/channels/:id sends it
function fullChannel(id: string): Channel {
  const listed = channels.find((c) => c.id === id);
  if (listed === undefined) {
    throw new Error(`no channel ${id}`);
  }
  return {
    ...listed,
    fillerCollections: [
      { id: `filler-of-${id}`, weight: 1, cooldownSeconds: 0 },
    ],
  };
}

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getChannels: () => Promise.resolve({ data: channels }),
  getApiTranscodeConfigs: () => Promise.resolve({ data: [] }),
  deleteApiChannelsById: (opts: IdOpts) => mockDeleteChannel(opts),
  getChannelsByNumberV2: (opts: IdOpts) => mockGetChannel(opts),
  putApiChannelsById: (opts: PutOpts) => mockPutChannel(opts),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => Promise.resolve(),
}));

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

function renderPage() {
  return renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <ChannelsPage />
      </Suspense>
    </SnackbarProvider>,
  );
}

describe('ChannelsPage bulk actions', () => {
  beforeEach(() => {
    mockDeleteChannel.mockReset();
    mockDeleteChannel.mockResolvedValue({ data: undefined });
    mockGetChannel.mockReset();
    mockGetChannel.mockImplementation(({ path }: IdOpts) =>
      Promise.resolve({ data: fullChannel(path.id) }),
    );
    mockPutChannel.mockReset();
    mockPutChannel.mockImplementation(({ body }: PutOpts) =>
      Promise.resolve({ data: body }),
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

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteChannel).toHaveBeenCalledTimes(2));
    const ids = mockDeleteChannel.mock.calls
      .map(([opts]) => opts.path.id)
      .sort();
    expect(ids).toEqual(['ch-1', 'ch-3']);
    expect(await screen.findByText('Deleted')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(rowCheckbox('Movie Night')).not.toBeChecked();
  });

  test('Hide from guide saves stealth on each full channel and clears the selection', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');

    await user.click(rowCheckbox('Movie Night'));
    await user.click(rowCheckbox('Cartoons'));

    const toolbar = selectionToolbar();
    // Both are in the guide, so there is nothing to show
    expect(
      within(toolbar).getByRole('button', { name: 'Show in guide' }),
    ).toBeDisabled();
    await user.click(
      within(toolbar).getByRole('button', { name: 'Hide from guide' }),
    );

    await waitFor(() => expect(mockPutChannel).toHaveBeenCalledTimes(2));
    const puts = mockPutChannel.mock.calls
      .map(([opts]) => opts)
      .sort((a, b) => a.path.id.localeCompare(b.path.id));
    expect(puts.map((p) => p.path.id)).toEqual(['ch-1', 'ch-2']);
    for (const put of puts) {
      expect(put.body.stealth).toBe(true);
      // Built from the full channel, so its filler lists survive the save
      expect(put.body.fillerCollections).toEqual([
        { id: `filler-of-${put.path.id}`, weight: 1, cooldownSeconds: 0 },
      ]);
      // A server rebase and the on-demand position are left alone
      expect(put.body).not.toHaveProperty('startTime');
      expect(put.body).not.toHaveProperty('onDemand');
      expect(put.body).not.toHaveProperty('sessions');
      expect(put.body).not.toHaveProperty('programCount');
    }
    expect(mockGetChannel).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Selected rows' }),
      ).not.toBeInTheDocument(),
    );
    expect(rowCheckbox('Cartoons')).not.toBeChecked();
  });

  test('Show in guide saves only the channels that are hidden', async () => {
    const { user } = renderPage();
    await screen.findByText('Movie Night');

    await user.click(rowCheckbox('Cartoons'));
    await user.click(rowCheckbox('Test Pattern'));
    await user.click(
      within(selectionToolbar()).getByRole('button', {
        name: 'Show in guide',
      }),
    );

    await waitFor(() => expect(mockPutChannel).toHaveBeenCalledOnce());
    const put = mockPutChannel.mock.calls[0]?.[0];
    expect(put?.path.id).toBe('ch-3');
    expect(put?.body.stealth).toBe(false);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  test('a partial stealth failure names the channel that was not saved', async () => {
    mockPutChannel.mockImplementation(({ path, body }: PutOpts) =>
      path.id === 'ch-2'
        ? Promise.reject(new Error('transcode config not found'))
        : Promise.resolve({ data: body }),
    );
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
        '1 of 2 saved; could not save Cartoons: transcode config not found',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
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
