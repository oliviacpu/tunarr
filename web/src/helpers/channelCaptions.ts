import type { CaptionAppearanceSettings } from '@tunarr/types/schemas';
import { isEqual, pickBy } from 'lodash-es';

// A channel's own caption look over the global one, which fields it sets, and
// how it is saved come from @tunarr/shared (channelCaptionLook,
// channelHasOwnCaptionLook, normalizeChannelCaptions), as the server uses them.

// The appearance fields an edit changed, to save as the channel's own; the
// others keep following the global settings
export function changedCaptionAppearance(
  current: CaptionAppearanceSettings,
  next: CaptionAppearanceSettings,
): Partial<CaptionAppearanceSettings> {
  return pickBy(
    next,
    (value, key) =>
      !isEqual(value, current[key as keyof CaptionAppearanceSettings]),
  );
}
