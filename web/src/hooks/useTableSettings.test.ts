import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import useStore from '../store/index.ts';
import { useSettings } from '../store/settings/selectors.ts';
import {
  useSelectableTableSettings,
  useTableSettings,
} from './useTableSettings.ts';

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

const initialTableSettings = useStore.getState().settings.ui.tableSettings;

beforeEach(() => {
  useStore.setState(({ settings }) => {
    settings.ui.tableSettings = {};
  });
});

afterEach(() => {
  cleanup();
  useStore.setState(({ settings }) => {
    settings.ui.tableSettings = initialTableSettings;
  });
  vi.restoreAllMocks();
});

function SettingsSubscriber() {
  useSettings();
  return null;
}

function StrictSettings({ children }: PropsWithChildren) {
  return createElement(
    StrictMode,
    null,
    createElement(SettingsSubscriber),
    children,
  );
}

describe('useTableSettings', () => {
  test('composes batched updates without notifying subscribers during render', () => {
    const errors = vi.spyOn(console, 'error');
    const { result } = renderHook(() => useTableSettings('PreferencesTest'), {
      wrapper: StrictSettings,
    });
    expect(
      useStore.getState().settings.ui.tableSettings.PreferencesTest,
    ).toBeUndefined();

    act(() => {
      result.current.paginationState.setter((prev) => ({
        ...prev,
        pageIndex: prev.pageIndex + 1,
      }));
      result.current.paginationState.setter((prev) => ({
        ...prev,
        pageIndex: prev.pageIndex + 1,
      }));
      result.current.colVisibilityState.setter((prev) => ({
        ...prev,
        name: false,
      }));
      result.current.colVisibilityState.setter((prev) => ({
        ...prev,
        number: false,
      }));
      result.current.sortState.setter((prev) => [
        ...prev,
        { id: 'name', desc: false },
      ]);
      result.current.sortState.setter((prev) => [
        ...prev,
        { id: 'number', desc: true },
      ]);
    });

    const expected = {
      pagination: { pageIndex: 2, pageSize: 10 },
      columnModel: { name: false, number: false },
      sortState: [
        { id: 'name', desc: false },
        { id: 'number', desc: true },
      ],
    };
    expect(result.current.paginationState.current).toEqual(expected.pagination);
    expect(result.current.colVisibilityState.current).toEqual(
      expected.columnModel,
    );
    expect(result.current.sortState.current).toEqual(expected.sortState);
    expect(
      useStore.getState().settings.ui.tableSettings.PreferencesTest,
    ).toEqual(expected);
    expect(errors.mock.calls).toEqual([]);
  });

  test('functional updates compose with direct values and persist for a new mount', () => {
    const { result, unmount } = renderHook(() =>
      useTableSettings('PreferencesTest'),
    );
    act(() => {
      result.current.paginationState.setter({ pageIndex: 3, pageSize: 25 });
      result.current.paginationState.setter((prev) => ({
        ...prev,
        pageIndex: prev.pageIndex + 1,
      }));
      result.current.colVisibilityState.setter({ name: false });
      result.current.colVisibilityState.setter((prev) => ({
        ...prev,
        number: false,
      }));
      result.current.sortState.setter([{ id: 'name', desc: false }]);
      result.current.sortState.setter((prev) => [
        ...prev,
        { id: 'number', desc: true },
      ]);
    });
    const expected =
      useStore.getState().settings.ui.tableSettings.PreferencesTest;
    expect(expected).toEqual({
      pagination: { pageIndex: 4, pageSize: 25 },
      columnModel: { name: false, number: false },
      sortState: [
        { id: 'name', desc: false },
        { id: 'number', desc: true },
      ],
    });
    unmount();
    const remounted = renderHook(() => useTableSettings('PreferencesTest'));
    expect(remounted.result.current.paginationState.current).toEqual(
      expected?.pagination,
    );
    expect(remounted.result.current.colVisibilityState.current).toEqual(
      expected?.columnModel,
    );
    expect(remounted.result.current.sortState.current).toEqual(
      expected?.sortState,
    );
  });
});

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
