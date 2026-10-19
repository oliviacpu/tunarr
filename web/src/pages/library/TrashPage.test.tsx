import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import type { EmptyTrashStatus } from '@tunarr/types/api';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { TrashPage } from './TrashPage.tsx';

const idle: EmptyTrashStatus = {
  state: 'idle',
  total: 0,
  deleted: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const running: EmptyTrashStatus = {
  ...idle,
  state: 'running',
  total: 3,
  deleted: 1,
  startedAt: 1,
};

// What the server reports; emptying the trash starts the drain
const { server, mockDeleteApiTrash } = vi.hoisted(() => ({
  server: { status: null as EmptyTrashStatus | null },
  mockDeleteApiTrash: vi.fn(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiTrashStatus: () => Promise.resolve({ data: server.status }),
  deleteApiTrash: () => mockDeleteApiTrash(),
}));

// The grid runs its own search and isn't under test here
vi.mock('../../components/library/LibraryProgramGrid.tsx', () => ({
  LibraryProgramGrid: () => null,
}));

// It reads the current route, which these tests don't have
vi.mock('@/components/Breadcrumbs.tsx', () => ({
  default: () => null,
}));

function renderPage() {
  return renderWithProviders(
    <SnackbarProvider>
      <TrashPage />
    </SnackbarProvider>,
  );
}

describe('TrashPage', () => {
  beforeEach(() => {
    server.status = idle;
    mockDeleteApiTrash.mockReset();
    mockDeleteApiTrash.mockImplementation(() => {
      server.status = running;
      return Promise.resolve({ data: running });
    });
  });

  test('Empty Trash asks for confirmation before purging anything', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Empty Trash' }));
    expect(mockDeleteApiTrash).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('all trashed items');
    expect(dialog).toHaveTextContent(
      'Channel lineup slots that reference them will be replaced with flex.',
    );
    expect(mockDeleteApiTrash).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole('button', { name: 'Empty trash' });
    expect(confirm).toHaveClass('MuiButton-colorError');
    await user.click(confirm);

    await waitFor(() => expect(mockDeleteApiTrash).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // The drain's progress shows once it starts, as before
    expect(
      await screen.findByText('Emptying trash: 1 / 3'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  test('cancelling the confirmation leaves the trash alone', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Empty Trash' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockDeleteApiTrash).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Empty Trash' }),
    ).toBeInTheDocument();
  });
});
