import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { Suspense, type ReactNode } from 'react';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import FillerListsPage from './FillerListsPage.tsx';

const { mockDeleteFiller } = vi.hoisted(() => ({
  mockDeleteFiller: vi.fn(),
}));

const fillers = [
  { id: 'f-1', name: 'Ad Breaks', contentCount: 3 },
  { id: 'f-2', name: 'Station IDs', contentCount: 5 },
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiFillerLists: () => Promise.resolve({ data: fillers }),
  deleteApiFillerListsById: (opts: unknown) => mockDeleteFiller(opts),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => Promise.resolve(),
}));

vi.mock('../../components/base/RouterButtonLink.tsx', () => ({
  RouterButtonLink: ({ children }: { children?: ReactNode }) => (
    <a>{children}</a>
  ),
}));

vi.mock('../../components/Breadcrumbs.tsx', () => ({ default: () => null }));

function renderPage() {
  return renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <FillerListsPage />
      </Suspense>
    </SnackbarProvider>,
  );
}

describe('FillerListsPage delete', () => {
  beforeEach(() => {
    mockDeleteFiller.mockReset();
    mockDeleteFiller.mockResolvedValue({ data: {} });
  });

  test('deletes only after the confirmation is accepted', async () => {
    const { user } = renderPage();

    const row = (await screen.findByText('Ad Breaks')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByTestId('DeleteIcon'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Filler List "Ad Breaks"?');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    expect(mockDeleteFiller).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteFiller).toHaveBeenCalledOnce());
    expect(mockDeleteFiller.mock.calls[0]?.[0]).toMatchObject({
      path: { id: 'f-1' },
    });
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
  });

  test('cancelling does not delete', async () => {
    const { user } = renderPage();

    const row = (await screen.findByText('Station IDs')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByTestId('DeleteIcon'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockDeleteFiller).not.toHaveBeenCalled();
  });
});
