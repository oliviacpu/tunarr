import { Trans, useLingui } from '@lingui/react/macro';
import { Box, LinearProgress, Paper, Tabs } from '@mui/material';
import { Outlet } from '@tanstack/react-router';
import { Suspense } from 'react';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import { RouterTabLink } from '../../components/base/RouterTabLink.tsx';

type Props = {
  currentTab?: string;
};

function useSystemTabs() {
  const { t } = useLingui();
  return [
    { label: t`Status`, value: '/', to: '/system' },
    { label: t`Debug`, value: '/debug', to: '/system/debug' },
    { label: t`Logs`, value: '/logs', to: '/system/logs' },
    { label: t`Tasks`, value: '/tasks', to: '/system/tasks' },
    {
      label: t`Troubleshoot`,
      value: '/troubleshoot',
      to: '/system/troubleshoot',
    },
  ] as const;
}

export const SystemLayout = ({ currentTab }: Props) => {
  const { t } = useLingui();
  const tabs = useSystemTabs();
  currentTab ??= '/';
  const tab = tabs.find((tab) => tab.value === currentTab);
  return (
    <Box>
      <PageHeader
        title={<Trans>System</Trans>}
        breadcrumbs={
          tab && (
            <Breadcrumbs
              trail={[
                { label: t`System`, to: '/system' },
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
        <Box sx={{ py: [1, 3] }}>
          <Suspense fallback={<LinearProgress />}>
            <Outlet />
          </Suspense>
        </Box>
      </Paper>
    </Box>
  );
};
