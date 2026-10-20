import {
  ChannelEditTabPaths,
  legacyChannelTab,
} from '@/components/channel_config/channelFieldTabs.ts';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod/v4';

export const Route = createFileRoute('/channels_/$channelId/edit/')({
  validateSearch: z.object({ tab: z.string().optional().catch(undefined) }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: ChannelEditTabPaths[legacyChannelTab(search.tab)],
      params,
      search: { query: search.query },
      replace: true,
    });
  },
});
