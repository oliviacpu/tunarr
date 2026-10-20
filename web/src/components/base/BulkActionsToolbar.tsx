import { useActions } from '@/strings/actions';
import { Plural, useLingui } from '@lingui/react/macro';
import { Delete } from '@mui/icons-material';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

type Props = {
  /** How many rows are selected. Nothing renders when it is 0. */
  selectedCount: number;
  /** Opens the delete confirmation for the selected rows. */
  onDelete: () => void;
  /** True while a bulk action runs: every button is disabled. */
  busy?: boolean;
  /** More actions for the selection, shown after Delete. */
  children?: ReactNode;
};

/**
 * What a list table shows above its rows while rows are selected: the count
 * and the actions that apply to all of them. Render it in MRT's
 * `renderTopToolbarCustomActions`.
 */
export function BulkActionsToolbar({
  selectedCount,
  onDelete,
  busy = false,
  children,
}: Props) {
  const { t } = useLingui();
  const actions = useActions();

  if (selectedCount <= 0) {
    return null;
  }

  return (
    <Stack
      role="group"
      aria-label={t`Selected rows`}
      direction="row"
      alignItems="center"
      flexWrap="wrap"
      gap={1}
      useFlexGap
    >
      <Typography
        variant="body2"
        aria-live="polite"
        sx={{ fontVariantNumeric: 'tabular-nums', mr: 1 }}
      >
        <Plural value={selectedCount} one="# selected" other="# selected" />
      </Typography>
      <Button
        variant="outlined"
        color="error"
        startIcon={<Delete />}
        disabled={busy}
        onClick={() => onDelete()}
      >
        {actions.delete}
      </Button>
      {children}
    </Stack>
  );
}

type SelectedNamesProps = {
  items: readonly { id: string; name: string }[];
  /** How many names to list before "and N more". */
  limit?: number;
};

/** The names of the selected rows, for a bulk confirmation's `details`. */
export function SelectedNames({ items, limit = 10 }: SelectedNamesProps) {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;

  return (
    <Box component="ul" sx={{ mt: 1.5, mb: 0, pl: 3 }}>
      {shown.map((item) => (
        <Typography component="li" variant="body2" key={item.id}>
          {item.name}
        </Typography>
      ))}
      {rest > 0 && (
        <Typography component="li" variant="body2" color="text.secondary">
          <Plural value={rest} one="and # more" other="and # more" />
        </Typography>
      )}
    </Box>
  );
}
