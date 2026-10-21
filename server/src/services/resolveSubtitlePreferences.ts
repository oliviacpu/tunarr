import type { GlobalSubtitlePreference } from '@tunarr/types/schemas';
import type { ChannelSubtitlePreferences } from '../db/schema/SubtitlePreferences.ts';

export function resolveEffectiveSubtitlePreferences(
  mode: 'inherit' | 'custom',
  channelRows: ChannelSubtitlePreferences[],
  globalRows: GlobalSubtitlePreference[],
):
  | { source: 'global'; preferences: GlobalSubtitlePreference[] }
  | { source: 'channel'; preferences: ChannelSubtitlePreferences[] } {
  return mode === 'inherit'
    ? { source: 'global', preferences: globalRows }
    : { source: 'channel', preferences: channelRows };
}
