import type { ChannelCaptions, FfmpegSettings } from '@tunarr/types';
import type { CaptionAppearance } from './Cea608Encoder.ts';

type CaptionSettings = Pick<
  FfmpegSettings,
  'hdhrCaptionAppearance' | 'hdhrCaptionAlignment' | 'hdhrCaptionTestPattern'
>;

/**
 * The caption look for a program on a channel: the global closed-caption
 * settings, with the channel's own settings over them (a test channel's look,
 * plans/test-channel-99.md). Fields the channel leaves out come from the
 * global settings. Resolved when the program starts, so a change to either
 * applies from the next program.
 */
export function channelCaptionAppearance(
  settings: CaptionSettings,
  captions: ChannelCaptions | null | undefined,
): Partial<CaptionAppearance> {
  const appearance: Partial<CaptionAppearance> = {
    ...settings.hdhrCaptionAppearance,
  };
  for (const [key, value] of Object.entries(captions?.appearance ?? {})) {
    if (value !== undefined) {
      Object.assign(appearance, { [key]: value });
    }
  }
  appearance.alignment = captions?.alignment ?? settings.hdhrCaptionAlignment;
  return appearance;
}

/**
 * Whether a channel sets any of its own caption look (alignment or appearance).
 * Without one its programs' captions use the global settings as before.
 */
export function channelHasOwnCaptionLook(
  captions: ChannelCaptions | null | undefined,
): boolean {
  return (
    captions?.alignment !== undefined ||
    Object.values(captions?.appearance ?? {}).some(
      (value) => value !== undefined,
    )
  );
}

/**
 * Whether a channel's programs show the caption test pattern: when it is on
 * for every channel, or on for this one. A channel can't turn the global test
 * pattern off for itself.
 */
export function channelCaptionTestPattern(
  settings: CaptionSettings,
  captions: ChannelCaptions | null | undefined,
): boolean {
  return settings.hdhrCaptionTestPattern || captions?.testPattern === true;
}
