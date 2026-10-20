import {
  channelTabFromPath,
  useChannelTabLabels,
} from '@/components/channel_config/channelFieldTabs.ts';
import { useLingui } from '@lingui/react/macro';
import { Outlet, useLocation } from '@tanstack/react-router';
import { ChannelOptionsButton } from '@/components/channels/ChannelOptionsButton.tsx';
import { useChannelSuspense } from '@/hooks/useChannels.ts';
import { Route } from '@/routes/channels_/$channelId/edit/route.tsx';
import { Box } from '@mui/material';
import { PageHeader } from '../../components/base/PageHeader.tsx';
import Breadcrumbs from '../../components/Breadcrumbs.tsx';
import { EditChannelForm } from '../../components/channel_config/EditChannelForm.tsx';

export default function EditChannelPage() {
  const { t } = useLingui();
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = channelTabFromPath(pathname);
  const tabLabels = useChannelTabLabels();
  const { channelId } = Route.useParams();
  const { data: channel } = useChannelSuspense(channelId);

  return (
    <>
      <Breadcrumbs
        trail={[
          { label: t`Channels`, to: '/channels' },
          { label: channel.name, to: `/channels/${channelId}` },
          { label: t`Edit`, to: `/channels/${channelId}/edit/properties` },
          { label: tabLabels[activeTab] },
        ]}
      />
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
          key={channel.id}
          channel={channel}
          isNew={false}
          activeTab={activeTab}
        >
          <Outlet />
        </EditChannelForm>
      </Box>
    </>
  );
}
