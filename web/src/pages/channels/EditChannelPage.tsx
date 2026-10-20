import type { EditChannelTabs } from '@/components/channel_config/EditChannelTabPanel.tsx';
import { ChannelOptionsButton } from '@/components/channels/ChannelOptionsButton.tsx';
import { useChannelSuspense } from '@/hooks/useChannels.ts';
import { Route } from '@/routes/channels_/$channelId/edit/index.tsx';
import { Box } from '@mui/material';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { EditChannelForm } from '../../components/channel_config/EditChannelForm.tsx';

type Props = {
  initialTab?: EditChannelTabs;
};

export default function EditChannelPage({ initialTab }: Props) {
  const { channelId } = Route.useParams();
  const { data: channel } = useChannelSuspense(channelId);

  return (
    <>
      <Breadcrumbs />
      <Box>
        <PageHeader
          title={channel.name}
          actions={
            <ChannelOptionsButton
              channel={channel}
              hideItems={['edit', 'duplicate', 'delete']}
            />
          }
        />
        <EditChannelForm
          channel={channel}
          isNew={false}
          initialTab={initialTab}
        />
      </Box>
    </>
  );
}
