import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export type PageHeaderProps = {
  /** The page name. Rendered as the page's only `h1`. */
  title: ReactNode;
  /** One sentence under the title saying what the page is for. */
  description?: ReactNode;
  /** Buttons or controls for the page, right of the title on wide screens. */
  actions?: ReactNode;
  /** Shown above the title, usually `<Breadcrumbs />`. */
  breadcrumbs?: ReactNode;
};

/**
 * The opening of every top-level page: breadcrumbs, the page title as the
 * document's `h1`, an optional one-line description, and the page's actions.
 * Section headings inside the page use `h2`, and groups inside a section `h3`.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: PageHeaderProps) {
  // ReactNode admits null as well as undefined; both leave the slot empty.
  const hasDescription = description !== undefined && description !== null;
  const hasActions = actions !== undefined && actions !== null;

  return (
    <Box sx={{ mb: 2 }}>
      {breadcrumbs}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: {
            xs: 'stretch',
            sm: hasDescription ? 'flex-start' : 'center',
          },
          gap: { xs: 1, sm: 2 },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="h1"
            component="h1"
            sx={{ overflowWrap: 'anywhere' }}
          >
            {title}
          </Typography>
          {hasDescription && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, maxWidth: '72ch' }}
            >
              {description}
            </Typography>
          )}
        </Box>
        {hasActions && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: { xs: 'flex-start', sm: 'flex-end' },
              gap: 1,
            }}
          >
            {actions}
          </Box>
        )}
      </Box>
    </Box>
  );
}
