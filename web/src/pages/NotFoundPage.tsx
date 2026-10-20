import { Trans } from '@lingui/react/macro';
import { Stack, Typography } from '@mui/material';
import { RouterButtonLink } from '../components/base/RouterButtonLink.tsx';

// The router's defaultNotFoundComponent: shown for an address no route
// matches, and when a loader throws notFound() because what it loads is gone.
export function NotFoundPage() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start', py: 4 }}>
      <Typography variant="h1">
        <Trans>Not found</Trans>
      </Typography>
      <Typography color="text.secondary">
        <Trans>
          Nothing is at this address. It may have been deleted, or the link may
          be out of date.
        </Trans>
      </Typography>
      <RouterButtonLink to="/channels" variant="contained">
        <Trans>Go to Channels</Trans>
      </RouterButtonLink>
    </Stack>
  );
}
