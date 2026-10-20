import type { LibraryUsedBy } from '@tunarr/types/api';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Box, Chip, List, ListItem, Tooltip, Typography } from '@mui/material';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  useLibraryUsage,
  type LibraryUsageKind,
} from '../hooks/useLibraryUsage.ts';

type UsageState = Pick<
  UseQueryResult<LibraryUsedBy>,
  'data' | 'isPending' | 'isError'
>;

export function UsedByChip({ id, usage }: { id: string; usage: UsageState }) {
  const { t } = useLingui();
  const channels = usage.data?.[id] ?? [];
  const label = usage.isPending
    ? t`Loading usage…`
    : usage.isError
      ? t`Usage unavailable`
      : t`${plural(channels.length, { one: 'Used by # channel', other: 'Used by # channels' })}`;
  return (
    <Tooltip
      title={
        <Box sx={{ whiteSpace: 'pre-line' }}>
          {channels
            .map(
              (channel) =>
                `${channel.number} · ${channel.name}${channel.slots.length ? ` (${t`slots ${channel.slots.join(', ')}`})` : ''}`,
            )
            .join('\n')}
        </Box>
      }
    >
      <Chip
        size="small"
        label={label}
        onClick={(event) => event.stopPropagation()}
      />
    </Tooltip>
  );
}

export function LibraryUsageDetails({
  kind,
  items,
  open,
}: {
  kind: LibraryUsageKind;
  items: readonly { id: string; name: string }[];
  open: boolean;
}) {
  const { t } = useLingui();
  const usage = useLibraryUsage(kind, open);
  if (!open) return null;
  if (usage.isPending || usage.isFetching)
    return (
      <Typography sx={{ mt: 2 }}>
        <Trans>Loading channel references…</Trans>
      </Typography>
    );
  if (usage.isError)
    return (
      <Typography sx={{ mt: 2 }} color="warning.main">
        <Trans>Channel references could not be loaded.</Trans>
      </Typography>
    );
  const referenced = items.filter(
    (item) => (usage.data?.[item.id]?.length ?? 0) > 0,
  );
  if (referenced.length === 0)
    return (
      <Typography sx={{ mt: 2 }}>
        <Trans>No channels reference these items.</Trans>
      </Typography>
    );
  return (
    <Box sx={{ mt: 2 }}>
      <Typography>
        <Trans>
          These channels reference the selected items. Their programming or
          slots may be affected:
        </Trans>
      </Typography>
      {referenced.map((item) => (
        <Box key={item.id}>
          {items.length > 1 && (
            <Typography sx={{ mt: 1, fontWeight: 600 }}>{item.name}</Typography>
          )}
          <List dense>
            {usage.data?.[item.id]?.map((channel) => (
              <ListItem key={channel.id} sx={{ overflowWrap: 'anywhere' }}>
                {channel.number} · {channel.name}
                {channel.slots.length > 0 &&
                  ` (${t`slots ${channel.slots.join(', ')}`})`}
              </ListItem>
            ))}
          </List>
        </Box>
      ))}
    </Box>
  );
}
