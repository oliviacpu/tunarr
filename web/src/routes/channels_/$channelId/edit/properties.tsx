import { ChannelPropertiesEditor } from '@/components/channel_config/ChannelPropertiesEditor.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels_/$channelId/edit/properties')({
  component: ChannelPropertiesEditor,
});
