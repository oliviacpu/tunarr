import ChannelTranscodingConfig from '@/components/channel_config/ChannelTranscodingConfig.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/$channelId/edit/streaming')({
  component: ChannelTranscodingConfig,
});
