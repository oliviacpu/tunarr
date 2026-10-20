import ChannelWatermarkConfig from '@/components/channel_config/ChannelWatermarkConfig.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/$channelId/edit/watermark')({
  component: ChannelWatermarkConfig,
});
