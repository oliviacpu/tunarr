import { Trans, useLingui } from '@lingui/react/macro';
import { Box, LinearProgress, Paper, Tabs, Typography } from '@mui/material';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { last, trimEnd } from 'lodash-es';
import { Suspense } from 'react';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { RouterTabLink } from '../../components/base/RouterTabLink.tsx';

type Props = {
  currentTab?: string;
};

function useSettingsTabs() {
  const { t } = useLingui();
  return [
    { label: t`General`, value: '/general', to: '/settings/general' },
    { label: t`XMLTV`, value: '/xmltv', to: '/settings/xmltv' },
    { label: t`FFMPEG`, value: '/ffmpeg', to: '/settings/ffmpeg' },
    { label: t`Scanner`, value: '/scanner', to: '/settings/scanner' },
    { label: t`HDHR`, value: '/hdhr', to: '/settings/hdhr' },
    { label: t`Features`, value: '/features', to: '/settings/features' },
  ] as const;
}

export function SettingsLayout({ currentTab = '/general' }: Props) {
  const { t } = useLingui();
  const tabs = useSettingsTabs();
  const fullPath = useRouterState({
    select: ({ matches }) => trimEnd(last(matches)?.fullPath ?? '', '/'),
  });
  // Pages below a tab (the FFmpeg config editor) draw their own trail.
  const tab = tabs.find((tab) => tab.to === fullPath);
  return (
    <Box>
      <Typography variant="h3" mb={2}>
        <Trans>Settings</Trans>
      </Typography>
      {tab && (
        <Breadcrumbs
          trail={[
            { label: t`Settings`, to: '/settings' },
            { label: tab.label },
          ]}
        />
      )}
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
            {tabs.map((tab) => (
              <RouterTabLink
                key={tab.value}
                label={tab.label}
                value={tab.value}
                to={tab.to}
              />
            ))}
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
