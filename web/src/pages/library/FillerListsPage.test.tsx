import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { Suspense, type ReactNode } from 'react';
import { SnackbarProvider } from 'notistack';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import FillerListsPage from './FillerListsPage.tsx';

const { mockDeleteFiller } = vi.hoisted(() => ({
  mockDeleteFiller:
    vi.fn<(opts: { path: { id: string } }) => Promise<unknown>>(),
}));

const fillers = [
  { id: 'f-1', name: 'Ad Breaks', contentCount: 3 },
  { id: 'f-2', name: 'Station IDs', contentCount: 5 },
  { id: 'f-3', name: 'Bumpers', contentCount: 2 },
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiFillerLists: () => Promise.resolve({ data: fillers }),
  deleteApiFillerListsById: (opts: { path: { id: string } }) =>
    mockDeleteFiller(opts),
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

function rowFor(name: string) {
  const row = screen.getByText(name).closest('tr');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function rowCheckbox(name: string) {
  return within(rowFor(name)).getByRole('checkbox', {
    name: 'Toggle select row',
  });
}

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

describe('FillerListsPage bulk delete', () => {
  beforeEach(() => {
    mockDeleteFiller.mockReset();
    mockDeleteFiller.mockResolvedValue({ data: {} });
  });

  test('deletes exactly the selected filler lists and clears the selection', async () => {
    const { user } = renderPage();
    await screen.findByText('Ad Breaks');

    await user.click(rowCheckbox('Ad Breaks'));
    await user.click(rowCheckbox('Bumpers'));

    const toolbar = screen.getByRole('group', { name: 'Selected rows' });
    expect(toolbar).toHaveTextContent('2 selected');
    await user.click(within(toolbar).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 2 filler lists?');
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ad Breaks', 'Bumpers']);
    expect(mockDeleteFiller).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteFiller).toHaveBeenCalledTimes(2));
    const deletedIds = mockDeleteFiller.mock.calls.map(
      ([opts]) => opts.path.id,
    );
    expect(deletedIds.sort()).toEqual(['f-1', 'f-3']);
    expect(await screen.findByText('Deleted')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(rowCheckbox('Ad Breaks')).not.toBeChecked();
    expect(rowCheckbox('Bumpers')).not.toBeChecked();
  });

  test('cancelling the bulk delete deletes nothing and keeps the selection', async () => {
    const { user } = renderPage();
    await screen.findByText('Ad Breaks');

    await user.click(rowCheckbox('Station IDs'));
    await user.click(
      within(screen.getByRole('group', { name: 'Selected rows' })).getByRole(
        'button',
        { name: 'Delete' },
      ),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 1 filler list?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockDeleteFiller).not.toHaveBeenCalled();
    expect(rowCheckbox('Station IDs')).toBeChecked();
  });

  test('the selection checkboxes are labelled and work from the keyboard', async () => {
    const { user } = renderPage();
    await screen.findByText('Ad Breaks');

    const selectAll = screen.getByRole('checkbox', {
      name: 'Toggle select all',
    });
    expect(selectAll).not.toHaveAttribute('tabindex', '-1');
    selectAll.focus();
    expect(selectAll).toHaveFocus();
    await user.keyboard(' ');

    expect(
      screen.getByRole('group', { name: 'Selected rows' }),
    ).toHaveTextContent('3 selected');
    for (const name of ['Ad Breaks', 'Station IDs', 'Bumpers']) {
      expect(rowCheckbox(name)).toBeChecked();
    }

    const row = rowCheckbox('Bumpers');
    row.focus();
    await user.keyboard(' ');
    expect(row).not.toBeChecked();
    expect(
      screen.getByRole('group', { name: 'Selected rows' }),
    ).toHaveTextContent('2 selected');
  });
});
