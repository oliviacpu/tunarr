import ChannelEpgConfig from '@/components/channel_config/ChannelEpgConfig.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/$channelId/edit/guide')({
  component: ChannelEpgConfig,
});
