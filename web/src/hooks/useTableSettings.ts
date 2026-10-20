import type {
  OnChangeFn,
  PaginationState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table';
import { isFunction } from 'lodash-es';
import type {
  MRT_RowData,
  MRT_RowSelectionState,
  MRT_TableOptions,
} from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import {
  setTableColumnModel,
  setTablePaginationState,
  setTableSortState,
} from '../store/settings/actions.ts';
import { useSettings } from '../store/settings/selectors.ts';

export const useTableSettings = (
  tableName: string,
  defaultPaginationState: PaginationState = { pageIndex: 0, pageSize: 10 },
  defaultVisibilityState: VisibilityState = {},
  defaultSortState: SortingState = [],
) => {
  const settings = useSettings();
  const tableSettings = settings.ui.tableSettings[tableName];
  const initialColumnModel =
    tableSettings?.columnModel ?? defaultVisibilityState;
  const colVisibilityState = useState<VisibilityState>(initialColumnModel);
  const paginationState = useState<PaginationState>(
    tableSettings?.pagination ?? defaultPaginationState,
  );
  const sortState = useState<SortingState>(
    tableSettings?.sortState ?? defaultSortState,
  );

  const visibilityUpdater: OnChangeFn<VisibilityState> = useCallback(
    (updater) => {
      if (isFunction(updater)) {
        colVisibilityState[1]((prev) => {
          const next = updater(prev);
          setTableColumnModel(tableName, next);
          return next;
        });
      } else {
        setTableColumnModel(tableName, updater);
        colVisibilityState[1](updater);
      }
    },
    [colVisibilityState, tableName],
  );

  const paginationUpdater: OnChangeFn<PaginationState> = useCallback(
    (updater) => {
      if (isFunction(updater)) {
        paginationState[1]((prev) => {
          const next = updater(prev);
          setTablePaginationState(tableName, next);
          return next;
        });
      } else {
        setTablePaginationState(tableName, updater);
        paginationState[1](updater);
      }
    },
    [paginationState, tableName],
  );

  const sortUpdater: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      if (isFunction(updater)) {
        sortState[1]((prev) => {
          const next = updater(prev);
          console.log(next);
          setTableSortState(tableName, next);
          return next;
        });
      } else {
        setTableSortState(tableName, updater);
        sortState[1](updater);
      }
    },
    [sortState, tableName],
  );

  return {
    colVisibilityState: {
      current: colVisibilityState[0],
      setter: visibilityUpdater,
    },
    paginationState: {
      current: paginationState[0],
      setter: paginationUpdater,
    },
    sortState: {
      current: sortState[0],
      setter: sortUpdater,
    },
  };
};

export const useStoreBackedTableSettings = <Data extends MRT_RowData>(
  tableName: string,
  defaultPaginationState: PaginationState = { pageIndex: 0, pageSize: 10 },
  defaultVisibilityState: VisibilityState = {},
) => {
  const tableState = useTableSettings(
    tableName,
    defaultPaginationState,
    defaultVisibilityState,
  );

  return {
    state: {
      columnVisibility: tableState.colVisibilityState.current,
      pagination: tableState.paginationState.current,
      sorting: tableState.sortState.current,
    },
    initialState: {
      pagination: tableState.paginationState.current,
      columnVisibility: tableState.colVisibilityState.current,
      sorting: tableState.sortState.current,
    },
    onColumnVisibilityChange: (updater) => {
      tableState.colVisibilityState.setter(updater);
    },
    onPaginationChange: (updater) => tableState.paginationState.setter(updater),
    onSortingChange: (updater) => tableState.sortState.setter(updater),
  } satisfies Partial<MRT_TableOptions<Data>>;
};

/**
 * The store-backed settings plus row selection, for a table with bulk actions.
 *
 * Selection lives in component state and is never persisted. Rows are keyed by
 * `getRowId`, so a refetch can't move a selection onto a different row, and a
 * selected row that leaves `data` drops out of `selectedRows`. Changing the page
 * or the page size clears the selection, and select-all selects the visible
 * page only. MRT's own selection banner is off: the table shows a
 * `BulkActionsToolbar` instead.
 */
export const useSelectableTableSettings = <Data extends MRT_RowData>(
  tableName: string,
  data: readonly Data[],
  getRowId: (row: Data) => string,
) => {
  const base = useStoreBackedTableSettings<Data>(tableName);
  const [rowSelection, setRowSelection] = useState<MRT_RowSelectionState>({});
  const clearSelection = useCallback(() => setRowSelection({}), []);
  const pagination = base.state.pagination;
  const baseOnPaginationChange = base.onPaginationChange;

  const onPaginationChange: OnChangeFn<PaginationState> = useCallback(
    (updater) => {
      const next = isFunction(updater) ? updater(pagination) : updater;
      if (
        next.pageIndex !== pagination.pageIndex ||
        next.pageSize !== pagination.pageSize
      ) {
        clearSelection();
      }
      baseOnPaginationChange(updater);
    },
    [baseOnPaginationChange, clearSelection, pagination],
  );

  const selectedRows = useMemo(
    () => data.filter((row) => rowSelection[getRowId(row)] === true),
    [data, getRowId, rowSelection],
  );

  return {
    tableOptions: {
      ...base,
      state: { ...base.state, rowSelection },
      onPaginationChange,
      onRowSelectionChange: setRowSelection,
      getRowId,
      enableRowSelection: true,
      enableSelectAll: true,
      selectAllMode: 'page',
      positionToolbarAlertBanner: 'none',
      muiSelectAllCheckboxProps: {
        // MRT 3.2.1's header-cell shortcut handles Space on this checkbox by
        // reading `checked` before the toggle, then cancels the toggle, so
        // Space did nothing. Keeping Space here lets the checkbox's own change
        // handler run, which reads the new value. Other keys (arrows) still
        // reach MRT's cell navigation.
        onKeyDown: (event) => {
          if (event.key === ' ') {
            event.stopPropagation();
          }
        },
      },
    } satisfies Partial<MRT_TableOptions<Data>>,
    selectedRows,
    clearSelection,
  };
};
