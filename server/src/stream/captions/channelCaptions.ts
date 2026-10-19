import { channelCaptionLook } from '@tunarr/shared/util';
import type { ChannelCaptions, FfmpegSettings } from '@tunarr/types';
import type { CaptionAppearance } from './Cea608Encoder.ts';

type CaptionSettings = Pick<
  FfmpegSettings,
  'hdhrCaptionAppearance' | 'hdhrCaptionAlignment' | 'hdhrCaptionTestPattern'
>;

/**
 * The caption look for a program on a channel: the global closed-caption
 * settings, with the channel's own settings over them (a test channel's look,
 * plans/test-channel-99.md), as the encoder takes it. The merge is
 * `channelCaptionLook` in `@tunarr/shared`, which the channel page uses too.
 * Resolved when the program starts, so a change to either applies from the
 * next program.
 */
export function channelCaptionAppearance(
  settings: CaptionSettings,
  captions: ChannelCaptions | null | undefined,
): Partial<CaptionAppearance> {
  const { appearance, alignment } = channelCaptionLook(settings, captions);
  return { ...appearance, alignment };
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
