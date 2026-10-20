import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { SnackbarProvider } from 'notistack';
import { Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { SmartCollectionsTable } from './SmartCollectionsTable.tsx';

const { mockDeleteCollection } = vi.hoisted(() => ({
  mockDeleteCollection:
    vi.fn<(opts: { path: { id: string } }) => Promise<unknown>>(),
}));

const collections = [
  { uuid: 'c-1', name: 'Eighties Movies', keywords: '' },
  { uuid: 'c-2', name: 'Short Cartoons', keywords: '' },
  { uuid: 'c-3', name: 'Christmas Specials', keywords: '' },
];

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiSmartCollections: () => Promise.resolve({ data: collections }),
  getApiSmartCollectionsUsedBy: () => Promise.resolve({ data: {} }),
  deleteApiSmartCollectionsById: (opts: { path: { id: string } }) =>
    mockDeleteCollection(opts),
}));

vi.mock('../../routes/__root.tsx', () => ({
  Route: { useNavigate: () => () => Promise.resolve() },
}));

vi.mock('../base/RouterButtonLink.tsx', () => ({
  RouterButtonLink: ({ children }: { children?: ReactNode }) => (
    <a>{children}</a>
  ),
}));

vi.mock('../base/RouterLink.tsx', () => ({
  RouterLink: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

vi.mock('./EditSmartCollectionDialog.tsx', () => ({
  EditSmartCollectionDialog: () => null,
}));

function rowCheckbox(name: string) {
  const row = screen.getByText(name).closest('tr');
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getByRole('checkbox', {
    name: 'Toggle select row',
  });
}

function renderTable() {
  return renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <SmartCollectionsTable />
      </Suspense>
    </SnackbarProvider>,
  );
}

describe('SmartCollectionsTable bulk delete', () => {
  beforeEach(() => {
    mockDeleteCollection.mockReset();
    mockDeleteCollection.mockResolvedValue({ data: undefined });
  });

  test('deletes exactly the selected collections and clears the selection', async () => {
    const { user } = renderTable();
    await screen.findByText('Eighties Movies');

    await user.click(rowCheckbox('Eighties Movies'));
    await user.click(rowCheckbox('Christmas Specials'));

    const toolbar = screen.getByRole('group', { name: 'Selected rows' });
    expect(toolbar).toHaveTextContent('2 selected');
    // Create stays next to the selection actions
    expect(screen.getByText('Create')).toBeInTheDocument();
    await user.click(within(toolbar).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 2 smart collections?');
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Eighties Movies', 'Christmas Specials']);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteCollection).toHaveBeenCalledTimes(2));
    const ids = mockDeleteCollection.mock.calls
      .map(([opts]) => opts.path.id)
      .sort();
    expect(ids).toEqual(['c-1', 'c-3']);
    expect(await screen.findByText('Deleted')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(rowCheckbox('Eighties Movies')).not.toBeChecked();
  });

  test('select-all selects the page and is labelled', async () => {
    const { user } = renderTable();
    await screen.findByText('Eighties Movies');

    await user.click(
      screen.getByRole('checkbox', { name: 'Toggle select all' }),
    );

    expect(
      screen.getByRole('group', { name: 'Selected rows' }),
    ).toHaveTextContent('3 selected');
  });
});
