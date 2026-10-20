import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import type { Channel } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { ChannelOptionsMenu } from './ChannelOptionsMenu.tsx';

const { mockDeleteChannel } = vi.hoisted(() => ({
  mockDeleteChannel: vi.fn(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  deleteApiChannelsById: (opts: unknown) => mockDeleteChannel(opts),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

// Only the channel's id, name and sessions are read by the delete path
const channel = {
  id: 'chan-1',
  name: 'Movie Night',
  number: 4,
  sessions: [],
} as unknown as Channel;

function renderMenu(onClose = vi.fn()) {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  return renderWithProviders(
    <SnackbarProvider>
      <ChannelOptionsMenu
        row={channel}
        anchorEl={anchor}
        open={true}
        onClose={onClose}
      />
    </SnackbarProvider>,
  );
}

describe('ChannelOptionsMenu delete', () => {
  beforeEach(() => {
    mockDeleteChannel.mockReset();
    mockDeleteChannel.mockResolvedValue({ data: {} });
  });

  test('deletes the channel only after the confirmation is accepted', async () => {
    const { user } = renderMenu();

    await user.click(await screen.findByText('Delete Channel'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Channel "Movie Night"?');
    expect(mockDeleteChannel).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteChannel).toHaveBeenCalledOnce());
    expect(mockDeleteChannel.mock.calls[0]?.[0]).toMatchObject({
      path: { id: 'chan-1' },
    });
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
  });

  test('cancelling does not delete the channel', async () => {
    const { user } = renderMenu();

    await user.click(await screen.findByText('Delete Channel'));
    const dialog = await screen.findByRole('dialog', {
      name: /Delete Channel/,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText('Delete Channel "Movie Night"?')).toBeNull(),
    );
    expect(mockDeleteChannel).not.toHaveBeenCalled();
  });
});
