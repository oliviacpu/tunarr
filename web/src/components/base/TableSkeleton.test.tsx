import { renderWithProviders, screen, within } from '@/test/utils';
import { describe, expect, test } from 'vitest';
import { TableSkeleton } from './TableSkeleton.tsx';

describe('TableSkeleton', () => {
  test('draws a header and five rows with one cell per column', () => {
    renderWithProviders(<TableSkeleton columns={4} />);

    const table = screen.getByTestId('table-skeleton');
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);

    // One header row plus the body rows
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);
    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(4);
    }
  });

  test('takes a row count', () => {
    renderWithProviders(<TableSkeleton columns={2} rows={3} />);

    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});
