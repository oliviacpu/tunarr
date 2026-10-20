import { ChannelFlexConfig } from '@/components/channel_config/ChannelFlexConfig.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/$channelId/edit/flex')({
  component: ChannelFlexConfig,
});
