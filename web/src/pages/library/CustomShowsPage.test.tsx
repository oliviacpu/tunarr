import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { Suspense, type ReactNode } from 'react';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import CustomShowsPage from './CustomShowsPage.tsx';

const { mockDeleteCustomShow } = vi.hoisted(() => ({
  mockDeleteCustomShow: vi.fn(),
}));

const shows = [
  { id: 'show-1', name: 'Saturday Cartoons', contentCount: 3 },
  { id: 'show-2', name: 'Late Night', contentCount: 5 },
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiCustomShows: () => Promise.resolve({ data: shows }),
  deleteCustomShow: (opts: unknown) => mockDeleteCustomShow(opts),
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
        <CustomShowsPage />
      </Suspense>
    </SnackbarProvider>,
  );
}

describe('CustomShowsPage delete', () => {
  beforeEach(() => {
    mockDeleteCustomShow.mockReset();
    mockDeleteCustomShow.mockResolvedValue({ data: {} });
  });

  test('deletes only after the confirmation is accepted', async () => {
    const { user } = renderPage();

    const row = (await screen.findByText('Saturday Cartoons')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByTestId('DeleteIcon'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Custom Show "Saturday Cartoons"?');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    expect(mockDeleteCustomShow).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteCustomShow).toHaveBeenCalledOnce());
    expect(mockDeleteCustomShow.mock.calls[0]?.[0]).toMatchObject({
      path: { id: 'show-1' },
    });
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
  });

  test('cancelling does not delete', async () => {
    const { user } = renderPage();

    const row = (await screen.findByText('Late Night')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByTestId('DeleteIcon'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockDeleteCustomShow).not.toHaveBeenCalled();
  });
});
