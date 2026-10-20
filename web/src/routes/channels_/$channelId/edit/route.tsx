import { channelQuery } from '@/hooks/useChannels';
import EditChannelPage from '@/pages/channels/EditChannelPage';
import { safeSetCurrentChannel } from '@/store/channelEditor/actions';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { isUndefined } from 'lodash-es';

export const Route = createFileRoute('/channels_/$channelId/edit')({
  loader: async ({ params, context }) => {
    const channel = await context.queryClient.ensureQueryData(
      channelQuery(params.channelId),
    );

    if (isUndefined(channel)) {
      throw notFound();
    }

    safeSetCurrentChannel(channel);

    return channel;
  },
  component: EditChannelPage,
});
