import type { ChannelCaptions, FfmpegSettings } from '@tunarr/types';
import type {
  CaptionAlignment,
  CaptionAppearanceSettings,
} from '@tunarr/types/schemas';

// A channel's own closed-caption settings (Channel.captions) over the global
// ones. The server lays out each program's captions with this, and the
// channel page shows and saves it.

export type GlobalCaptionLook = Pick<
  FfmpegSettings,
  'hdhrCaptionAppearance' | 'hdhrCaptionAlignment'
>;

export type ChannelCaptionLook = {
  appearance: CaptionAppearanceSettings;
  alignment: CaptionAlignment;
};

// The fields an object sets: those whose value isn't undefined
function setFields<T extends object>(fields: T | undefined): Partial<T> {
  const set: Partial<T> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value !== undefined) {
      Object.assign(set, { [key]: value });
    }
  }
  return set;
}

/**
 * A channel's caption settings as saved: only what it sets, null for none (the
 * global settings). A test pattern switched off is the same as not set.
 */
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
  const appearance = setFields(captions?.appearance);
  if (Object.keys(appearance).length > 0) {
    next.appearance = appearance;
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Whether a channel sets any of its own caption look (alignment or appearance).
 * Without one its programs' captions use the global settings.
 */
export function channelHasOwnCaptionLook(
  captions: ChannelCaptions | null | undefined,
): boolean {
  return (
    captions?.alignment !== undefined ||
    Object.keys(setFields(captions?.appearance)).length > 0
  );
}

/**
 * The look a channel's captions have: the global caption settings, with the
 * fields the channel sets over them. The fields it leaves out come from the
 * global settings, so a later global change still reaches them.
 */
export function channelCaptionLook(
  global: GlobalCaptionLook,
  captions: ChannelCaptions | null | undefined,
): ChannelCaptionLook {
  return {
    appearance: {
      ...global.hdhrCaptionAppearance,
      ...setFields(captions?.appearance),
    },
    alignment: captions?.alignment ?? global.hdhrCaptionAlignment,
  };
}
