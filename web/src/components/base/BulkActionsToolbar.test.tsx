import { renderWithProviders, screen, within } from '@/test/utils';
import { Button } from '@mui/material';
import { describe, expect, test, vi } from 'vitest';
import { BulkActionsToolbar, SelectedNames } from './BulkActionsToolbar';

describe('BulkActionsToolbar', () => {
  test('renders nothing while no rows are selected', () => {
    renderWithProviders(
      <BulkActionsToolbar selectedCount={0} onDelete={vi.fn()} />,
    );

    expect(
      screen.queryByRole('group', { name: 'Selected rows' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument();
  });

  test('shows the count and an outlined, error-coloured Delete', async () => {
    const onDelete = vi.fn();
    const { user } = renderWithProviders(
      <BulkActionsToolbar selectedCount={3} onDelete={onDelete} />,
    );

    const toolbar = screen.getByRole('group', { name: 'Selected rows' });
    expect(toolbar).toHaveTextContent('3 selected');

    const deleteButton = within(toolbar).getByRole('button', {
      name: 'Delete',
    });
    expect(deleteButton).toHaveClass('MuiButton-outlined');
    expect(deleteButton).toHaveClass('MuiButton-colorError');

    await user.click(deleteButton);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  test('uses the singular for one row', () => {
    renderWithProviders(
      <BulkActionsToolbar selectedCount={1} onDelete={vi.fn()} />,
    );

    expect(
      screen.getByRole('group', { name: 'Selected rows' }),
    ).toHaveTextContent('1 selected');
  });

  test('renders extra actions after Delete', () => {
    renderWithProviders(
      <BulkActionsToolbar selectedCount={2} onDelete={vi.fn()}>
        <Button>Hide from guide</Button>
      </BulkActionsToolbar>,
    );

    const buttons = within(
      screen.getByRole('group', { name: 'Selected rows' }),
    ).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Delete',
      'Hide from guide',
    ]);
  });

  test('disables Delete while busy', () => {
    renderWithProviders(
      <BulkActionsToolbar selectedCount={2} onDelete={vi.fn()} busy />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('SelectedNames', () => {
  const items = Array.from({ length: 13 }, (_, i) => ({
    id: `id-${i}`,
    name: `Item ${i + 1}`,
  }));

  test('lists every name up to the limit', () => {
    renderWithProviders(<SelectedNames items={items.slice(0, 3)} />);

    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toEqual(['Item 1', 'Item 2', 'Item 3']);
  });

  test('lists the first ten, then how many more', () => {
    renderWithProviders(<SelectedNames items={items} />);

    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toHaveLength(11);
    expect(names.slice(0, 10)).toEqual(
      items.slice(0, 10).map((item) => item.name),
    );
    expect(names[10]).toBe('and 3 more');
  });
});
