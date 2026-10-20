import { Trans, useLingui } from '@lingui/react/macro';
import { Box, Paper, Tabs, Typography } from '@mui/material';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { last, trimEnd } from 'lodash-es';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { RouterTabLink } from '../../components/base/RouterTabLink.tsx';

type Props = {
  currentTab?: string;
};

function useSettingsTabs() {
  const { t } = useLingui();
  return [
    {
      label: t`General`,
      value: '/general',
      to: '/settings/general',
      description: t`Manage web preferences, server access, logging, and backups.`,
    },
    {
      label: t`Playback`,
      value: '/playback',
      to: '/settings/playback',
      description: t`Configure FFmpeg, streaming, and transcoding.`,
    },
    {
      label: t`Captions & audio`,
      value: '/captions-audio',
      to: '/settings/captions-audio',
      description: t`Choose subtitle handling, caption appearance, and preferred audio languages.`,
    },
    {
      label: t`Guide`,
      value: '/guide',
      to: '/settings/guide',
      description: t`Configure XMLTV guide output and refreshes.`,
    },
    {
      label: t`Tuner`,
      value: '/tuner',
      to: '/settings/tuner',
      description: t`Manage HDHomeRun discovery and tuner capacity.`,
    },
    {
      label: t`Library`,
      value: '/library',
      to: '/settings/library',
      description: t`Configure library scans and search indexing.`,
    },
    {
      label: t`Experimental`,
      value: '/experimental',
      to: '/settings/experimental',
      description: t`Try optional features and work around server issues.`,
    },
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
      <PageHeader
        title={<Trans>Settings</Trans>}
        breadcrumbs={
          tab && (
            <Breadcrumbs
              trail={[
                { label: t`Settings`, to: '/settings' },
                { label: tab.label },
              ]}
            />
          )
        }
      />
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
          {tab && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h2" gutterBottom>
                {tab.label}
              </Typography>
              <Typography color="text.secondary">{tab.description}</Typography>
            </Box>
          )}
          {/* The router's pending and error components show in here */}
          <Outlet />
        </Box>
      </Paper>
    </Box>
  );
}
