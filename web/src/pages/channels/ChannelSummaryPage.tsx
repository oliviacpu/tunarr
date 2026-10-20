import { ChannelOptionsButton } from '@/components/channels/ChannelOptionsButton.tsx';
import { Trans } from '@lingui/react/macro';
import { Box, LinearProgress, Stack, useTheme } from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Suspense } from 'react';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { ChannelNowPlayingCard } from '../../components/channels/ChannelNowPlayingCard.tsx';
import { ChannelPrograms } from '../../components/channels/ChannelPrograms.tsx';
import { ChannelSummaryQuickStats } from '../../components/channels/ChannelSummaryQuickStats.tsx';
import { ChannelIconDisplay } from '../../components/channels/ChannelIconDisplay.tsx';
import { useChannelAndProgramming } from '../../hooks/useChannelLineup.ts';
import { Route } from '../../routes/channels_/$channelId/index.tsx';

export const ChannelSummaryPage = () => {
  const { channelId } = Route.useParams();
  const {
    data: { channel },
  } = useChannelAndProgramming(channelId);

  const theme = useTheme();
  const smallViewport = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box>
      <Breadcrumbs />
      <Box sx={{ mb: 0.5 }}>
        <ChannelIconDisplay
          icon={channel.icon}
          imgStyle={{ width: smallViewport ? '48px' : '132px' }}
          style={{ width: smallViewport ? '48px' : '132px' }}
        />
      </Box>
      <PageHeader
        title={channel.name}
        description={<Trans>Channel #{channel.number}</Trans>}
        actions={
          <ChannelOptionsButton
            channel={channel}
            hideItems={['duplicate', 'delete']}
          />
        }
      />
      <Stack spacing={2}>
        <Box sx={{ width: '100%' }}>
          <Suspense fallback={<LinearProgress />}>
            <ChannelNowPlayingCard channelId={channelId} />
          </Suspense>
        </Box>
        <ChannelSummaryQuickStats channelId={channelId} />
        <ChannelPrograms channelId={channelId} />
      </Stack>
    </Box>
  );
};
