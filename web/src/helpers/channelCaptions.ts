import type { ChannelCaptions, FfmpegSettings } from '@tunarr/types';
import type {
  CaptionAlignment,
  CaptionAppearanceSettings,
} from '@tunarr/types/schemas';
import { isEmpty, isUndefined, omitBy } from 'lodash-es';

// The channel's caption settings as saved: only what it sets, null for none
// (the global settings). A test pattern switched off is the same as not set.
export function normalizeChannelCaptions(
  captions: ChannelCaptions | null | undefined,
): ChannelCaptions | null {
  const next: ChannelCaptions = {};
  if (captions?.testPattern === true) {
    next.testPattern = true;
  }
  if (captions?.alignment !== undefined) {
    next.alignment = captions.alignment;
  }
  const appearance = omitBy(captions?.appearance ?? {}, isUndefined);
  if (!isEmpty(appearance)) {
    next.appearance = appearance;
  }
  return isEmpty(next) ? null : next;
}

export function hasOwnCaptionLook(
  captions: ChannelCaptions | null | undefined,
): boolean {
  const normalized = normalizeChannelCaptions(captions);
  return (
    normalized?.alignment !== undefined || normalized?.appearance !== undefined
  );
}

// The look a channel's captions have: its own settings over the global ones
export function channelCaptionLook(
  global: Pick<
    FfmpegSettings,
    'hdhrCaptionAppearance' | 'hdhrCaptionAlignment'
  >,
  captions: ChannelCaptions | null | undefined,
): { appearance: CaptionAppearanceSettings; alignment: CaptionAlignment } {
  return {
    appearance: {
      ...global.hdhrCaptionAppearance,
      ...omitBy(captions?.appearance ?? {}, isUndefined),
    },
    alignment: captions?.alignment ?? global.hdhrCaptionAlignment,
  };
}
