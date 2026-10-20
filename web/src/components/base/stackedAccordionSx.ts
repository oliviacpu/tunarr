import type { SxProps, Theme } from '@mui/material';
import { accordionClasses } from '@mui/material';

// For accordions stacked as one bordered group (pass `disableGutters` too, so
// an open one doesn't pull away from its neighbours). The theme gives each
// accordion a full 1px border, so two neighbours would draw a 2px line; each
// accordion after the first drops its top border instead. MUI's own divider
// line above each accordion would add another line, so it goes too.
export const stackedAccordionSx: SxProps<Theme> = {
  '&::before': { display: 'none' },
  [`& + .${accordionClasses.root}`]: { borderTop: 0 },
};
