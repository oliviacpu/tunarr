import { ForkBugReportUrl } from '@/helpers/forkLinks.ts';
import { describeError } from '@/helpers/apiError';
import { useBrowserInfo } from '@/hooks/useBrowserInfo';
import { Trans } from '@lingui/react/macro';
import GitHub from '@mui/icons-material/GitHub';
import Refresh from '@mui/icons-material/Refresh';
import Replay from '@mui/icons-material/Replay';
import { Alert, Box, Button, Collapse, Stack, Typography } from '@mui/material';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useRouter } from '@tanstack/react-router';
import { isError } from 'lodash-es';
import { useCallback, useEffect, useMemo } from 'react';
import errorImage from '../assets/error_this_is_fine.png';
import { LoadingIcon } from '../components/base/LoadingIcon';
import { useVersion } from '../hooks/useVersion.tsx';

type Props = {
  error: unknown;
  resetRoute: () => void;
};

export function ErrorPage({ error, resetRoute }: Props) {
  const browser = useBrowserInfo();
  const { data: version, isLoading: versionLoading } = useVersion();
  const stack = (isError(error) ? error.stack : '') ?? '';
  const message = describeError(error);

  const bugReportLink = useMemo(() => {
    const url = new URL(ForkBugReportUrl);
    let browserString = browser.getBrowserName();
    if (browser.getBrowserVersion()) {
      browserString += ` (${browser.getBrowserVersion()})`;
    }
    let osString = browser.getOSName();
    if (browser.getOSVersion()) {
      osString += ` (${browser.getOSVersion()})`;
    }
    url.searchParams.append('template', 'bug_report.yaml');
    url.searchParams.append('browser', browserString);
    url.searchParams.append('os', osString);
    url.searchParams.append('version', version?.tunarr ?? '');
    url.searchParams.append('logs', stack);
    return url;
  }, [browser, stack, version?.tunarr]);

  const handleRefresh = () => {
    location.reload();
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{ margin: 'auto', display: 'block', pl: 3 }}
        component="img"
        src={errorImage}
      />
      <div style={{ textAlign: 'center' }}>
        <Typography variant="h2" sx={{ pb: 1 }}>
          <Trans>Oops!</Trans>
        </Typography>
        <Typography>
          <Trans>Looks like something went wrong.</Trans>
        </Typography>
      </div>
      {message !== undefined && (
        <Alert
          severity="error"
          sx={{ my: 2, mx: 'auto', maxWidth: '72ch', wordBreak: 'break-word' }}
        >
          {message}
        </Alert>
      )}
      <Stack
        direction="row"
        sx={{ justifyContent: 'center', flexWrap: 'wrap', mt: 2 }}
        gap={2}
      >
        <Button onClick={resetRoute} variant="contained" startIcon={<Replay />}>
          <Trans>Try again</Trans>
        </Button>
        <Button onClick={handleRefresh} startIcon={<Refresh />}>
          <Trans>Refresh Page</Trans>
        </Button>
        <Button
          component="a"
          href={bugReportLink.toString()}
          target="_blank"
          startIcon={versionLoading ? <LoadingIcon /> : <GitHub />}
          disabled={versionLoading}
        >
          {versionLoading ? (
            <Trans>Generating Bug Report Link...</Trans>
          ) : (
            <Trans>File a Bug Report</Trans>
          )}
        </Button>
      </Stack>
      {stack && (
        <Collapse in={true}>
          <Box
            component="pre"
            sx={{ width: '100%', overflowX: 'scroll', p: 1 }}
          >
            {stack}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

// The router's error component. "Try again" clears the failed queries' error
// state and reruns the route's loaders, instead of reloading the browser.
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  // A suspense query that failed stays failed until the boundary is reset,
  // so the retry below would rethrow the old error without fetching again
  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  const tryAgain = useCallback(() => {
    queryErrorResetBoundary.reset();
    reset();
    router.invalidate().catch(console.warn);
  }, [queryErrorResetBoundary, reset, router]);

  return <ErrorPage error={error} resetRoute={tryAgain} />;
}
