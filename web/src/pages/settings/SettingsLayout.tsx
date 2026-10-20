import { Trans, useLingui } from '@lingui/react/macro';
import { Box, LinearProgress, Paper, Tabs } from '@mui/material';
import { Outlet } from '@tanstack/react-router';
import { Suspense } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { RouterTabLink } from '../../components/base/RouterTabLink.tsx';

type Props = {
  currentTab?: string;
};

export function SettingsLayout({ currentTab = '/general' }: Props) {
  const { t } = useLingui();
  return (
    <Box>
      <PageHeader title={<Trans>Settings</Trans>} />
      <Paper sx={{ p: [1, 2] }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={currentTab}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{
              '& .MuiTabs-scrollButtons.Mui-disabled': {
                opacity: 0.2,
              },
            }}
          >
            <RouterTabLink
              label={t`General`}
              value="/general"
              to="/settings/general"
            />
            <RouterTabLink
              label={t`XMLTV`}
              value="/xmltv"
              to="/settings/xmltv"
            />
            <RouterTabLink
              label={t`FFMPEG`}
              value="/ffmpeg"
              to="/settings/ffmpeg"
            />
            <RouterTabLink
              label={t`Scanner`}
              value="/scanner"
              to="/settings/scanner"
            />
            <RouterTabLink label={t`HDHR`} value="/hdhr" to="/settings/hdhr" />
            <RouterTabLink
              label={t`Features`}
              value="/features"
              to="/settings/features"
            />
          </Tabs>
        </Box>

        <Box sx={{ py: [1, 2] }}>
          <Suspense fallback={<LinearProgress />}>
            <Outlet />
          </Suspense>
        </Box>
      </Paper>
    </Box>
  );
}
