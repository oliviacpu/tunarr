import { useToasts, withReason } from '@/strings/actions';
import AddCircleIcon from '@mui/icons-material/AddCircle';

import {
  BulkActionsToolbar,
  SelectedNames,
} from '@/components/base/BulkActionsToolbar.tsx';
import { DeleteConfirmationDialog } from '@/components/DeleteConfirmationDialog.tsx';
import { useBulkDelete } from '@/hooks/useBulkAction.ts';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Delete, Edit } from '@mui/icons-material';
import { IconButton, Link, Tooltip } from '@mui/material';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TableContainer from '@mui/material/TableContainer';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from '@tanstack/react-router';
import { type FillerList } from '@tunarr/types';
import { find } from 'lodash-es';
import {
  type MRT_ColumnDef,
  type MRT_Row,
  MaterialReactTable,
  useMaterialReactTable,
} from 'material-react-table';
import { useSnackbar } from 'notistack';
import { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import {
  deleteApiFillerListsByIdMutation,
  getApiFillerListsQueryKey,
} from '../../generated/@tanstack/react-query.gen.ts';
import { deleteApiFillerListsById } from '../../generated/sdk.gen.ts';
import { useFillerLists } from '../../hooks/useFillerLists.ts';
import { useSelectableTableSettings } from '../../hooks/useTableSettings.ts';

const TableName = 'FillerLists';

const fillerId = (filler: FillerList) => filler.id;
const fillerName = (filler: FillerList) => filler.name;

export default function FillerListsPage() {
  const { t } = useLingui();
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<
    string | undefined
  >(undefined);
  const snackbar = useSnackbar();

  const deleteFillerList = useMutation({
    ...deleteApiFillerListsByIdMutation(),
    onSuccess: async () => {
      snackbar.enqueueSnackbar({ message: toasts.deleted, variant: 'success' });
      await queryClient.invalidateQueries({
        queryKey: getApiFillerListsQueryKey(),
        exact: false,
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

  const { data: fillerLists } = useFillerLists();
  const deletingFiller = find(fillerLists, { id: deleteConfirmationId });
  const { tableOptions, selectedRows, clearSelection } =
    useSelectableTableSettings(TableName, fillerLists, fillerId);

  const bulkDelete = useBulkDelete<FillerList>({
    getId: fillerId,
    getName: fillerName,
    deleteOne: (filler) =>
      deleteApiFillerListsById({
        path: { id: filler.id },
        throwOnError: true,
      }),
    onDone: () => {
      clearSelection();
      queryClient
        .invalidateQueries({
          queryKey: getApiFillerListsQueryKey(),
          exact: false,
        })
        .catch(console.error);
    },
  });
  const navigate = useNavigate();

  const handleFillterNavigation = (
    _: React.MouseEvent<HTMLTableRowElement, MouseEvent>,
    id: string,
  ) => {
    navigate({
      to: `/library/fillers/$fillerId/edit`,
      params: { fillerId: id },
    }).catch(console.error);
  };

  const renderActionCell = useCallback(
    ({ row: { original: filler } }: { row: MRT_Row<FillerList> }) => {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'end', width: '100%' }}>
          <Tooltip title={t`Edit`} placement="top">
            <IconButton
              to={`/library/fillers/${filler.id}/edit`}
              component={RouterLink}
            >
              <Edit />
            </IconButton>
          </Tooltip>
          <Tooltip title={t`Delete`} placement="top">
            <IconButton
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setDeleteConfirmationId(filler.id);
              }}
            >
              <Delete />
            </IconButton>
          </Tooltip>
        </Box>
      );
    },
    [t],
  );

  const columns = useMemo<MRT_ColumnDef<FillerList>[]>(
    () => [
      {
        header: t`Name`,
        accessorKey: 'name',
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
    columns: columns,
    data: fillerLists,
    enableRowActions: true,
    layoutMode: 'grid',
    renderRowActions: renderActionCell,
    renderEmptyRowsFallback() {
      return (
        <Typography
          sx={{ py: '2rem', textAlign: 'center', fontStyle: 'italic' }}
        >
          <Trans>
            You have no Filler Lists. Create your first Filler List{' '}
            <Link component={RouterLink} to="/library/fillers/new">
              here.
            </Link>
          </Trans>
        </Typography>
      );
    },
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        cursor: 'pointer',
      },
      onClick: (event) => handleFillterNavigation(event, row.original.id),
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
      <DeleteConfirmationDialog
        open={deletingFiller !== undefined}
        onClose={() => setDeleteConfirmationId(undefined)}
        title={t`Delete Filler List "${deletingFiller?.name}"?`}
        body={t`Deleting a filler list removes it from every channel that uses it. This cannot be undone.`}
        onConfirm={() => {
          if (deletingFiller !== undefined) {
            deleteFillerList.mutate({ path: { id: deletingFiller.id } });
          }
        }}
      />
      <DeleteConfirmationDialog
        {...bulkDelete.dialogProps}
        title={t`${plural(bulkDelete.count, {
          one: 'Delete # filler list?',
          other: 'Delete # filler lists?',
        })}`}
        body={t`${plural(bulkDelete.count, {
          one: 'Deleting a filler list removes it from every channel that uses it. This cannot be undone.',
          other:
            'Deleting these filler lists removes them from every channel that uses them. This cannot be undone.',
        })}`}
        details={<SelectedNames items={bulkDelete.named} />}
      />
      <PageHeader
        breadcrumbs={<Breadcrumbs />}
        title={<Trans>Filler Lists</Trans>}
        description={
          <Trans>
            Filler lists are collections of videos that you may want to play
            during 'flex' time segments. Flex is time within a channel that does
            not have a program scheduled (usually used for padding).
          </Trans>
        }
        actions={
          <Button
            component={RouterLink}
            to="/library/fillers/new"
            variant="contained"
            startIcon={<AddCircleIcon />}
          >
            <Trans>New</Trans>
          </Button>
        }
      />

      <TableContainer component={Paper} sx={{ width: '100%' }}>
        <MaterialReactTable table={table} />
      </TableContainer>
    </Box>
  );
}
