import {
  BulkActionsToolbar,
  SelectedNames,
} from '@/components/base/BulkActionsToolbar.tsx';
import { DeleteConfirmationDialog } from '@/components/DeleteConfirmationDialog.tsx';
import { toStealthUpdateRequest } from '@/helpers/channelUpdateRequest.ts';
import { betterHumanize } from '@/helpers/dayjs.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { useBulkAction, useBulkDelete } from '@/hooks/useBulkAction.ts';
import { useTranscodeConfigs } from '@/hooks/settingsHooks.ts';
import type { Maybe } from '@/types/util.ts';
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Check,
  Close,
  Edit,
  MoreVert,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import type { BoxProps } from '@mui/material';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Paper,
  Stack,
  TableContainer,
  TablePagination,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { green, red, yellow } from '@mui/material/colors';
import { styled, useTheme } from '@mui/material/styles';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ChannelSession } from '@tunarr/types';
import {
  type Channel,
  type ChannelIcon,
  type TranscodeConfig,
} from '@tunarr/types';
import dayjs from 'dayjs';
import { find, isEmpty, map, sum } from 'lodash-es';
import type { MRT_Row } from 'material-react-table';
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef, //if using TypeScript (optional, but recommended)
} from 'material-react-table';
import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import {
  RouterButtonLink,
  RouterIconButtonLink,
} from '../../components/base/RouterButtonLink.tsx';
import { RouterLink } from '../../components/base/RouterLink.tsx';
import NoChannelsCreated from '../../components/channel_config/NoChannelsCreated.tsx';
import { ChannelIconDisplay } from '../../components/channels/ChannelIconDisplay.tsx';
import { ChannelOptionsMenu } from '../../components/channels/ChannelOptionsMenu.tsx';
import { ChannelSessionsDialog } from '../../components/channels/ChannelSessionsDialog.tsx';
import {
  deleteApiChannelsById,
  getChannelsByNumberV2,
  putApiChannelsById,
} from '../../generated/sdk.gen.ts';
import { useChannelsSuspense } from '../../hooks/useChannels.ts';
import { useServerEvents } from '../../hooks/useServerEvents.ts';
import { useSelectableTableSettings } from '../../hooks/useTableSettings.ts';

type ChannelRow = Channel;

const channelId = (channel: Channel) => channel.id;
const channelName = (channel: Channel) => channel.name;

/**
 * Shows or hides one channel in the guide. Reads the whole channel first: the
 * list's copy has no filler lists or subtitle preferences, and the update
 * replaces both.
 */
async function setChannelStealth(id: string, stealth: boolean) {
  const { data: channel } = await getChannelsByNumberV2({
    path: { id },
    throwOnError: true,
  });
  await putApiChannelsById({
    path: { id },
    body: toStealthUpdateRequest(channel, stealth),
    throwOnError: true,
  });
}

interface GlowingCircleProps extends BoxProps {
  color?: string;
  glowColor?: string;
}

const GlowingCircle = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'color' && prop !== 'glowColor',
})<GlowingCircleProps>(({ color = '#87CEEB', glowColor = '#ADD8E6' }) => ({
  width: '50px',
  height: '50px',
  borderRadius: '50%',
  backgroundColor: color,
  boxShadow: `0 0 10px ${color}`,
  animation: 'glow 2s infinite alternate',
  '@keyframes glow': {
    '0%': {
      boxShadow: `0 0 10px ${color}` /* Start with a moderate glow */,
      backgroundColor: color,
    },
    '100%': {
      boxShadow: `0 0 20px ${glowColor}, 0 0 30px ${glowColor}` /* Increase glow and intensity, lighter blue */,
      backgroundColor: glowColor,
    },
  },
}));

export default function ChannelsPage() {
  const { t } = useLingui();
  const { data: channels } = useChannelsSuspense({
    refetchOnWindowFocus: true,
  });
  const { data: transcodeConfigs } = useTranscodeConfigs();
  const theme = useTheme();
  const smallViewport = useMediaQuery(theme.breakpoints.down('sm'));
  const mediumViewport = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionDetailDialog, setSessionDetailDialog] =
    useState<Channel | null>(null);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [channelMenuOpen, setChannelMenuOpen] = React.useState<string | null>(
    null,
  );
  const {
    tableOptions: tableSettings,
    selectedRows,
    clearSelection,
  } = useSelectableTableSettings('Channels', channels, channelId);
  const { addListener, removeListener } = useServerEvents();

  const refreshChannels = () => {
    queryClient
      .invalidateQueries({ predicate: invalidateTaggedQueries('Channels') })
      .catch(console.error);
  };

  const bulkDelete = useBulkDelete<Channel>({
    getId: channelId,
    getName: channelName,
    deleteOne: (channel) =>
      deleteApiChannelsById({ path: { id: channel.id }, throwOnError: true }),
    onDone: () => {
      clearSelection();
      refreshChannels();
    },
  });

  const bulkStealth = useBulkAction<Channel>('save', channelName);
  const bulkBusy = bulkDelete.busy || bulkStealth.busy;

  // Only the channels not already in the wanted state are saved
  const setStealthForSelection = (stealth: boolean) => {
    const changing = selectedRows.filter(
      (channel) => channel.stealth !== stealth,
    );
    bulkStealth
      .run(changing, (channel) => setChannelStealth(channel.id, stealth))
      .then(() => {
        clearSelection();
        refreshChannels();
      })
      .catch(console.error);
  };

  useEffect(() => {
    const key = addListener((ev) => {
      if (ev.type === 'stream') {
        queryClient
          .invalidateQueries({
            predicate: invalidateTaggedQueries('Channels'),
          })
          .catch(console.error);
      }
    });
    return () => {
      removeListener(key);
    };
  }, [addListener, queryClient, removeListener]);

  const handleOpenMenu = (
    event: React.MouseEvent<HTMLElement>,
    channelId: string,
  ) => {
    event.stopPropagation();
    setChannelMenuOpen(channelId);
    setAnchorEl(event.currentTarget);
  };

  const handleChannelMenuClose = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setChannelMenuOpen(null);
    setAnchorEl(null);
  };

  // To do: figure out better solution.  This is a temp workaround
  // Without this if user naviages away from tab then back, react query refetches and destroys exisitng ref
  // this moves menu to the top left of the screen.
  // useEffect(() => {
  //   setAnchorEl(null);
  //   setChannelMenu(null);
  // }, [channelsFetching]);

  const handleChannelNavigation = (
    _: React.MouseEvent<HTMLTableRowElement, MouseEvent>,
    id: string,
  ) => {
    navigate({
      to: `/channels/$channelId`,
      params: { channelId: id },
    }).catch(console.error);
  };

  const renderChannelMenu = (row: ChannelRow) => {
    return (
      <ChannelOptionsMenu
        anchorEl={anchorEl}
        onClose={() => handleChannelMenuClose()}
        open={channelMenuOpen === row.id}
        row={row}
        hideItems={['edit']}
      />
    );
  };

  const renderActionCell = ({
    row: { original: channel },
  }: {
    row: MRT_Row<ChannelRow>;
  }) => {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {renderChannelMenu(channel)}
        {!mediumViewport && (
          <Tooltip title={t`Edit Channel Settings`} placement="top">
            <RouterIconButtonLink
              to={'/channels/$channelId/edit'}
              params={{ channelId: channel.id }}
              onClick={(e) => e.stopPropagation()}
            >
              <Edit />
            </RouterIconButtonLink>
          </Tooltip>
        )}
        <IconButton
          id="channel-options-button"
          aria-controls={channelMenuOpen ? 'channel-options-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={channelMenuOpen ? 'true' : undefined}
          onClick={(e) => handleOpenMenu(e, channel.id)}
        >
          <MoreVert />
        </IconButton>
      </Box>
    );
  };

  const columnsNew = useMemo<MRT_ColumnDef<ChannelRow>[]>(
    () => [
      {
        header: '',
        accessorKey: 'sessions',
        enableSorting: false,
        enableColumnActions: false,
        size: 50,
        Header: () => null,
        Cell: ({ cell, row: { original: channel } }) => {
          const sessions = cell.getValue<ChannelSession[] | undefined>();
          if (!sessions || isEmpty(sessions)) {
            return (
              <Tooltip placement="top" title={t`No active sessions`}>
                <Box
                  sx={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: red[200],
                  }}
                />
              </Tooltip>
            );
          }

          const totalConnections = sum(map(sessions, (s) => s.numConnections));
          const lameDuck = totalConnections === 0 && sessions.length > 0;

          return (
            <Tooltip
              placement="top"
              title={
                <Box component="span" sx={{ textAlign: 'center' }}>
                  <Plural
                    value={sessions.length}
                    one="# session"
                    other="# sessions"
                  />
                  <br />
                  {totalConnections > 1 && (
                    <Trans>{totalConnections} total</Trans>
                  )}{' '}
                  <Plural
                    value={totalConnections}
                    one="# connection"
                    other="# connections"
                  />
                </Box>
              }
            >
              <GlowingCircle
                sx={{ width: '10px', height: '10px' }}
                color={lameDuck ? yellow[400] : green[400]}
                glowColor={lameDuck ? yellow[200] : green[200]}
                onClick={(e) => {
                  e.stopPropagation();
                  setSessionDetailDialog(channel);
                }}
              />
            </Tooltip>
          );
        },
      },
      {
        header: t`Icon`,
        accessorKey: 'icon',
        size: 100,
        Cell: ({ cell }) => {
          const value = cell.getValue<ChannelIcon>();
          return (
            <ChannelIconDisplay
              icon={value}
              imgStyle={{ maxHeight: '40px' }}
              style={{ width: '40px', height: '32px' }}
            />
          );
        },
        enableColumnFilter: false,
        enableSorting: false,
      },
      {
        header: t`Number`,
        accessorKey: 'number',
        minSize: 120,
        size: 120,
      },
      {
        header: t`Name`,
        accessorKey: 'name',
        size: 250,
      },
      {
        header: t`# Programs`,
        accessorKey: 'programCount',
      },
      {
        header: t`Duration`,
        accessorKey: 'duration',
        Cell: ({ cell }) =>
          betterHumanize(dayjs.duration(cell.getValue<number>()), {
            style: 'short',
          }),
      },
      {
        header: t`Stealth?`,
        accessorKey: 'stealth',
        Cell: ({ cell }) => (cell.getValue<boolean>() ? <Check /> : <Close />),
        muiTableBodyCellProps: {
          align: 'justify',
        },
        filterVariant: 'checkbox',
        enableSorting: false,
        size: 150,
      },
      {
        header: t`On-Demand?`,
        accessorKey: 'onDemand.enabled',
        Cell: ({ cell }) => (cell.getValue<boolean>() ? <Check /> : <Close />),
        filterVariant: 'checkbox',
        enableSorting: false,
        id: 'onDemand',
      },
      {
        header: t`Transcode Config`,
        accessorFn: (row) =>
          find(transcodeConfigs, { id: row.transcodeConfigId }),
        id: 'transcodeConfigId',
        Cell: ({ cell }) => {
          const conf = cell.getValue<Maybe<TranscodeConfig>>();
          if (!conf) {
            return '-';
          }

          return (
            <RouterLink
              to="/settings/playback/$configId"
              params={{ configId: conf.id }}
              onClick={(e) => e.stopPropagation()}
            >
              {conf.name}
            </RouterLink>
          );
        },
        enableSorting: false,
      },
    ],
    [transcodeConfigs, t],
  );

  const renderSessionStatus = (channel: ChannelRow) => {
    const sessions = channel.sessions;
    if (!sessions || isEmpty(sessions)) {
      return (
        <Tooltip placement="top" title={t`No active sessions`}>
          <Box
            sx={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: red[200],
              flexShrink: 0,
            }}
          />
        </Tooltip>
      );
    }
    const totalConnections = sum(map(sessions, (s) => s.numConnections));
    const lameDuck = totalConnections === 0 && sessions.length > 0;
    return (
      <Tooltip
        placement="top"
        title={
          <Box component="span" sx={{ textAlign: 'center' }}>
            <Plural
              value={sessions.length}
              one="# session"
              other="# sessions"
            />
            <br />
            {totalConnections > 1 && (
              <Trans>{totalConnections} total</Trans>
            )}{' '}
            <Plural
              value={totalConnections}
              one="# connection"
              other="# connections"
            />
          </Box>
        }
      >
        <GlowingCircle
          sx={{ width: '10px', height: '10px', flexShrink: 0 }}
          color={lameDuck ? yellow[400] : green[400]}
          glowColor={lameDuck ? yellow[200] : green[200]}
          onClick={(e) => {
            e.stopPropagation();
            setSessionDetailDialog(channel);
          }}
        />
      </Tooltip>
    );
  };

  const renderMobileCards = () => {
    const { pageIndex, pageSize } = tableSettings.state.pagination;
    const pagedChannels = channels.slice(
      pageIndex * pageSize,
      (pageIndex + 1) * pageSize,
    );
    return (
      <>
        <Stack spacing={1}>
          {pagedChannels.map((channel) => (
            <Card key={channel.id}>
              <CardActionArea
                onClick={() =>
                  navigate({
                    to: '/channels/$channelId',
                    params: { channelId: channel.id },
                  }).catch(console.error)
                }
              >
                <CardContent
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 1.5,
                    '&:last-child': { pb: 1.5 },
                  }}
                >
                  {renderSessionStatus(channel)}
                  <Box
                    sx={{
                      flexShrink: 0,
                      width: 40,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <ChannelIconDisplay
                      icon={channel.icon}
                      imgStyle={{ maxHeight: '32px', maxWidth: '40px' }}
                      style={{ width: '40px', height: '32px' }}
                    />
                  </Box>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap>
                      Ch {channel.number} · {channel.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      <Plural
                        value={channel.programCount}
                        one="# program"
                        other="# programs"
                      />{' '}
                      ·{' '}
                      {betterHumanize(dayjs.duration(channel.duration), {
                        style: 'short',
                      })}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    sx={{ flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenMenu(e, channel.id);
                    }}
                  >
                    <MoreVert />
                  </IconButton>
                  {renderChannelMenu(channel)}
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
        <Paper variant="outlined" sx={{ mt: 1 }}>
          <TablePagination
            component="div"
            count={channels.length}
            page={pageIndex}
            rowsPerPage={pageSize}
            onPageChange={(_, newPage) =>
              tableSettings.onPaginationChange({ pageIndex: newPage, pageSize })
            }
            onRowsPerPageChange={(e) =>
              tableSettings.onPaginationChange({
                pageIndex: 0,
                pageSize: parseInt(e.target.value, 10),
              })
            }
          />
        </Paper>
      </>
    );
  };

  const table = useMaterialReactTable({
    columns: columnsNew,
    data: channels,
    enableRowActions: true,
    layoutMode: 'grid',
    ...tableSettings,
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        cursor: 'pointer',
      },
      onClick: (event) => {
        handleChannelNavigation(event, row.original.id);
      },
    }),
    displayColumnDefOptions: {
      'mrt-row-actions': {
        size: mediumViewport ? 60 : 100,
        grow: false,
        Header: '',
        visibleInShowHideMenu: false,
      },
    },
    renderRowActions: renderActionCell,
    positionActionsColumn: 'last',
    renderTopToolbarCustomActions: () => (
      <BulkActionsToolbar
        selectedCount={selectedRows.length}
        busy={bulkBusy}
        onDelete={() => bulkDelete.open(selectedRows)}
      >
        <Button
          variant="outlined"
          startIcon={<VisibilityOff />}
          disabled={bulkBusy || selectedRows.every((c) => c.stealth)}
          onClick={() => setStealthForSelection(true)}
        >
          <Trans>Hide from guide</Trans>
        </Button>
        <Button
          variant="outlined"
          startIcon={<Visibility />}
          disabled={bulkBusy || selectedRows.every((c) => !c.stealth)}
          onClick={() => setStealthForSelection(false)}
        >
          <Trans>Show in guide</Trans>
        </Button>
      </BulkActionsToolbar>
    ),
    autoResetPageIndex: false,
  });

  return (
    <div>
      <PageHeader
        title={<Trans>Channels</Trans>}
        actions={
          <RouterButtonLink
            to="/channels/new"
            variant="contained"
            startIcon={<AddCircleIcon />}
          >
            <Trans>New</Trans>
          </RouterButtonLink>
        }
      />

      {smallViewport ? (
        renderMobileCards()
      ) : (
        <TableContainer component={Paper} sx={{ width: '100%' }}>
          <MaterialReactTable table={table} />
        </TableContainer>
      )}

      <DeleteConfirmationDialog
        {...bulkDelete.dialogProps}
        title={t`${plural(bulkDelete.count, {
          one: 'Delete # channel?',
          other: 'Delete # channels?',
        })}`}
        body={t`${plural(bulkDelete.count, {
          one: 'Deleting a channel removes all of its programming. This cannot be undone.',
          other:
            'Deleting these channels removes all of their programming. This cannot be undone.',
        })}`}
        details={<SelectedNames items={bulkDelete.named} />}
      />
      <NoChannelsCreated />
      <ChannelSessionsDialog
        open={!!sessionDetailDialog}
        onClose={() => setSessionDetailDialog(null)}
        channel={sessionDetailDialog}
      />
    </div>
  );
}
