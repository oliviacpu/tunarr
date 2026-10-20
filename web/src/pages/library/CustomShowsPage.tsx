import {
  BulkActionsToolbar,
  SelectedNames,
} from '@/components/base/BulkActionsToolbar.tsx';
import { useBulkDelete } from '@/hooks/useBulkAction.ts';
import { useToasts, withReason } from '@/strings/actions';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Delete, Edit, Sync } from '@mui/icons-material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import { IconButton, Tooltip } from '@mui/material';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TableContainer from '@mui/material/TableContainer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type CustomShow } from '@tunarr/types';
import { find } from 'lodash-es';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  type MRT_Row,
  useMaterialReactTable,
} from 'material-react-table';
import { useSnackbar } from 'notistack';
import React, { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { RouterButtonLink } from '../../components/base/RouterButtonLink.tsx';
import { DeleteConfirmationDialog } from '../../components/DeleteConfirmationDialog.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { deleteCustomShowMutation } from '../../generated/@tanstack/react-query.gen.ts';
import { deleteCustomShow } from '../../generated/sdk.gen.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import { useCustomShows } from '../../hooks/useCustomShows.ts';
import { useSelectableTableSettings } from '../../hooks/useTableSettings.ts';

const showId = (show: CustomShow) => show.id;
const showName = (show: CustomShow) => show.name;

export default function CustomShowsPage() {
  const { t } = useLingui();
  const toasts = useToasts();
  const { data: customShows } = useCustomShows();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<
    string | undefined
  >(undefined);
  const snackbar = useSnackbar();
  const deletingShow = find(customShows, { id: deleteConfirmationId });
  const { tableOptions, selectedRows, clearSelection } =
    useSelectableTableSettings('CustomShows', customShows, showId);

  const bulkDelete = useBulkDelete<CustomShow>({
    getId: showId,
    getName: showName,
    deleteOne: (show) =>
      deleteCustomShow({ path: { id: show.id }, throwOnError: true }),
    onDone: () => {
      clearSelection();
      queryClient
        .invalidateQueries({
          predicate: invalidateTaggedQueries('Custom Shows'),
        })
        .catch(console.error);
    },
  });

  const deleteShowMutation = useMutation({
    ...deleteCustomShowMutation(),
    onSuccess: async () => {
      snackbar.enqueueSnackbar({ message: toasts.deleted, variant: 'success' });
      await queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Custom Shows'),
      });
    },
    onError: (e) => {
      snackbar.enqueueSnackbar({
        message: (
          <span>
            {withReason(toasts.couldNotDelete, e.message)}
            <br />
            <Trans>Please consider opening a bug with details!</Trans>
          </span>
        ),
        variant: 'error',
      });
      console.error(e);
    },
  });

  const handleCustomShowDelete = useCallback(
    (event: React.MouseEvent, showId: string) => {
      event.stopPropagation();
      setDeleteConfirmationId(showId);
    },
    [],
  );

  const renderActionCell = useCallback(
    ({ row: { original: show } }: { row: MRT_Row<CustomShow> }) => {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'end', width: '100%' }}>
          <Tooltip title={t`Edit`} placement="top">
            <IconButton
              to={`/library/custom-shows/${show.id}/edit`}
              component={Link}
            >
              <Edit />
            </IconButton>
          </Tooltip>
          <Tooltip title={t`Delete`} placement="top">
            <IconButton onClick={(e) => handleCustomShowDelete(e, show.id)}>
              <Delete />
            </IconButton>
          </Tooltip>
        </Box>
      );
    },
    [handleCustomShowDelete, t],
  );

  const columns = useMemo<MRT_ColumnDef<CustomShow>[]>(
    () => [
      {
        header: t`Name`,
        accessorKey: 'name',
        Cell: ({ row }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {row.original.name}
            {row.original.syncMediaSourceId && (
              <Tooltip title={t`Synced with external playlist`}>
                <Sync fontSize="small" color="primary" />
              </Tooltip>
            )}
          </Box>
        ),
      },
      {
        header: t`# Programs`,
        accessorKey: 'contentCount',
        filterVariant: 'range',
      },
    ],
    [t],
  );

  const table = useMaterialReactTable({
    columns,
    data: customShows,
    enableRowActions: true,
    layoutMode: 'grid',
    renderRowActions: renderActionCell,
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        cursor: 'pointer',
      },
      onClick: () => {
        navigate({
          to: '/library/custom-shows/$showId/edit',
          params: { showId: row.original.id },
        }).catch(console.warn);
      },
    }),
    displayColumnDefOptions: {
      'mrt-row-actions': {
        size: 200,
        grow: false,
        Header: '',
        visibleInShowHideMenu: false,
      },
    },
    positionActionsColumn: 'last',
    renderTopToolbarCustomActions: () => (
      <BulkActionsToolbar
        selectedCount={selectedRows.length}
        busy={bulkDelete.busy}
        onDelete={() => bulkDelete.open(selectedRows)}
      />
    ),
    ...tableOptions,
  });

  return (
    <Box>
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={<Trans>Custom Shows</Trans>}
        description={
          <Trans>
            Custom Shows are sequences of videos that represent a episodes of a
            virtual TV show. When you add these shows to a channel, the schedule
            tools will treat the videos as if they belonged to a single TV show.
          </Trans>
        }
        actions={
          <RouterButtonLink
            to="/library/custom-shows/new"
            variant="contained"
            startIcon={<AddCircleIcon />}
          >
            <Trans>New</Trans>
          </RouterButtonLink>
        }
      />
      <TableContainer component={Paper} sx={{ width: '100%' }}>
        <MaterialReactTable table={table} />
      </TableContainer>
      <DeleteConfirmationDialog
        open={deletingShow !== undefined}
        onClose={() => setDeleteConfirmationId(undefined)}
        title={t`Delete Custom Show "${deletingShow?.name}"?`}
        body={t`Deleting a custom show removes its programming from channels that use it. This cannot be undone.`}
        onConfirm={() => {
          if (deletingShow !== undefined) {
            deleteShowMutation.mutate({ path: { id: deletingShow.id } });
          }
        }}
      />
      <DeleteConfirmationDialog
        {...bulkDelete.dialogProps}
        title={t`${plural(bulkDelete.count, {
          one: 'Delete # custom show?',
          other: 'Delete # custom shows?',
        })}`}
        body={t`${plural(bulkDelete.count, {
          one: 'Deleting a custom show removes its programming from channels that use it. This cannot be undone.',
          other:
            'Deleting these custom shows removes their programming from channels that use them. This cannot be undone.',
        })}`}
        details={<SelectedNames items={bulkDelete.named} />}
      />
    </Box>
  );
}
