import type {
  Channel,
  SaveableChannel,
  UpdateChannelRequest,
} from '@tunarr/types';
import { omit } from 'lodash-es';

/**
 * Sends startTime only when the user changed it. The server may rebase
 * startTime while the form is open, and resending the loaded value would
 * revert that rebase.
 */
export function toChannelUpdateRequest(
  channel: SaveableChannel,
  loadedStartTime: number | undefined,
): UpdateChannelRequest {
  if (channel.startTime !== loadedStartTime) {
    return channel;
  }

  const { startTime: _, ...rest } = channel;
  return rest;
}

/**
 * The update that only shows or hides a channel in the guide. Build it from
 * the channel as `GET /api/channels/:id` returns it, not from the channel list:
 * the list leaves out filler lists and subtitle preferences, and the server
 * replaces both with whatever the update carries.
 *
 * Leaves out startTime (a server rebase must survive) and onDemand (sending it
 * resets an on-demand channel's position).
 */
export function toStealthUpdateRequest(
  channel: Channel,
  stealth: boolean,
): UpdateChannelRequest {
  return {
    ...omit(channel, [
      'fallback',
      'programCount',
      'transcoding',
      'sessions',
      'startTime',
      'onDemand',
    ]),
    stealth,
  };
}
