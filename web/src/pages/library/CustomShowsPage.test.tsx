import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { Suspense, type ReactNode } from 'react';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import CustomShowsPage from './CustomShowsPage.tsx';

const { mockDeleteCustomShow } = vi.hoisted(() => ({
  mockDeleteCustomShow:
    vi.fn<(opts: { path: { id: string } }) => Promise<unknown>>(),
}));

const shows = [
  { id: 'show-1', name: 'Saturday Cartoons', contentCount: 3 },
  { id: 'show-2', name: 'Late Night', contentCount: 5 },
  { id: 'show-3', name: 'Morning News', contentCount: 4 },
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiCustomShows: () => Promise.resolve({ data: shows }),
  deleteCustomShow: (opts: { path: { id: string } }) =>
    mockDeleteCustomShow(opts),
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

function deletedIds() {
  return mockDeleteCustomShow.mock.calls.map(([opts]) => opts.path.id).sort();
}

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

describe('CustomShowsPage bulk delete', () => {
  beforeEach(() => {
    mockDeleteCustomShow.mockReset();
    mockDeleteCustomShow.mockResolvedValue({ data: {} });
  });

  test('deletes exactly the selected shows and clears the selection', async () => {
    const { user } = renderPage();
    await screen.findByText('Saturday Cartoons');

    await user.click(rowCheckbox('Late Night'));
    await user.click(rowCheckbox('Morning News'));
    expect(selectionToolbar()).toHaveTextContent('2 selected');
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 2 custom shows?');
    expect(dialog).toHaveTextContent('Late Night');
    expect(dialog).toHaveTextContent('Morning News');
    expect(dialog).not.toHaveTextContent('Saturday Cartoons');

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteCustomShow).toHaveBeenCalledTimes(2));
    expect(deletedIds()).toEqual(['show-2', 'show-3']);
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(rowCheckbox('Late Night')).not.toBeChecked();
    expect(rowCheckbox('Morning News')).not.toBeChecked();
  });

  test('stays open and busy until every delete settles', async () => {
    let finish: (value: unknown) => void = () => {};
    mockDeleteCustomShow.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = renderPage();
    await screen.findByText('Saturday Cartoons');

    await user.click(rowCheckbox('Late Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteCustomShow).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Delete' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();

    finish({ data: {} });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
  });

  test('a partial failure names the show that was not deleted and why', async () => {
    mockDeleteCustomShow.mockImplementation(
      ({ path }: { path: { id: string } }) =>
        path.id === 'show-2'
          ? Promise.reject(new Error('in use by a slot'))
          : Promise.resolve({ data: {} }),
    );
    const { user } = renderPage();
    await screen.findByText('Saturday Cartoons');

    await user.click(rowCheckbox('Saturday Cartoons'));
    await user.click(rowCheckbox('Late Night'));
    await user.click(
      within(selectionToolbar()).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText(
        '1 of 2 deleted; could not delete Late Night: in use by a slot',
      ),
    ).toBeInTheDocument();
    expect(deletedIds()).toEqual(['show-1', 'show-2']);
    expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});
