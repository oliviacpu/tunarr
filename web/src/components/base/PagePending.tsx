import { t } from '@lingui/core/macro';
import { Box, LinearProgress } from '@mui/material';

// The router's defaultPendingComponent. It renders where the route's page
// would, so it sits inside the app's page container.
export function PagePending() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <LinearProgress
        aria-label={t`Loading`}
        sx={{ width: '100%', maxWidth: 360 }}
      />
    </Box>
  );
}
