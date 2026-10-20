import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSelectableTableSettings } from './useTableSettings.ts';

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];
const rowId = (row: Row) => row.id;

function renderSelection(data: Row[] = rows) {
  return renderHook(
    ({ data }) => useSelectableTableSettings('SelectionTest', data, rowId),
    { initialProps: { data } },
  );
}

describe('useSelectableTableSettings', () => {
  test('turns on page-scoped selection without the MRT banner', () => {
    const { result } = renderSelection();
    const options = result.current.tableOptions;

    expect(options.enableRowSelection).toBe(true);
    expect(options.enableSelectAll).toBe(true);
    expect(options.selectAllMode).toBe('page');
    expect(options.positionToolbarAlertBanner).toBe('none');
    expect(options.getRowId(rows[1] as Row)).toBe('b');
    expect(options.state.rowSelection).toEqual({});
  });

  test('selected rows follow the data, keyed by id', () => {
    const { result, rerender } = renderSelection();

    act(() =>
      result.current.tableOptions.onRowSelectionChange({ a: true, c: true }),
    );
    expect(result.current.selectedRows.map(rowId)).toEqual(['a', 'c']);

    // A selected row that leaves the data is no longer selected
    rerender({ data: rows.filter((row) => row.id !== 'c') });
    expect(result.current.selectedRows.map(rowId)).toEqual(['a']);
  });

  test('changing the page or the page size clears the selection', () => {
    const { result } = renderSelection();

    act(() => result.current.tableOptions.onRowSelectionChange({ a: true }));
    act(() =>
      result.current.tableOptions.onPaginationChange((prev) => ({
        ...prev,
        pageIndex: prev.pageIndex + 1,
      })),
    );
    expect(result.current.selectedRows).toEqual([]);

    act(() => result.current.tableOptions.onRowSelectionChange({ b: true }));
    act(() =>
      result.current.tableOptions.onPaginationChange({
        pageIndex: result.current.tableOptions.state.pagination.pageIndex,
        pageSize: 25,
      }),
    );
    expect(result.current.selectedRows).toEqual([]);
  });

  test('a pagination update that changes nothing keeps the selection', () => {
    const { result } = renderSelection();

    act(() => result.current.tableOptions.onRowSelectionChange({ a: true }));
    act(() => result.current.tableOptions.onPaginationChange((prev) => prev));
    expect(result.current.selectedRows.map(rowId)).toEqual(['a']);
  });

  test('clearSelection empties the selection', () => {
    const { result } = renderSelection();

    act(() => result.current.tableOptions.onRowSelectionChange({ a: true }));
    act(() => result.current.clearSelection());
    expect(result.current.tableOptions.state.rowSelection).toEqual({});
  });
});
