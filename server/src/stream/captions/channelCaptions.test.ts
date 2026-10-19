import { defaultFfmpegSettings } from '@tunarr/types';
import {
  channelCaptionAppearance,
  channelCaptionTestPattern,
} from './channelCaptions.ts';

const global = {
  ...defaultFfmpegSettings,
  hdhrCaptionAlignment: 'centeredLines' as const,
  hdhrCaptionAppearance: {
    ...defaultFfmpegSettings.hdhrCaptionAppearance,
    textColor: 'yellow' as const,
    maxLines: 3,
  },
};

// The merge itself is tested with channelCaptionLook in @tunarr/shared; this
// is the shape the encoder takes, with the alignment beside the appearance
describe('channelCaptionAppearance', () => {
  test('is the global look for a channel without its own', () => {
    expect(channelCaptionAppearance(global, null)).toEqual({
      ...global.hdhrCaptionAppearance,
      alignment: 'centeredLines',
    });
  });

  test("puts the channel's fields over the global ones and keeps the rest", () => {
    expect(
      channelCaptionAppearance(global, {
        alignment: 'left',
        appearance: { backgroundColor: 'magenta', maxLines: 2 },
      }),
    ).toEqual({
      ...global.hdhrCaptionAppearance,
      backgroundColor: 'magenta',
      maxLines: 2,
      alignment: 'left',
    });
  });
});

describe('channelCaptionTestPattern', () => {
  const off = { ...global, hdhrCaptionTestPattern: false };
  const on = { ...global, hdhrCaptionTestPattern: true };

  test('is on for a channel that turns it on for itself', () => {
    expect(channelCaptionTestPattern(off, { testPattern: true })).toBe(true);
  });

  test('is off for a channel that leaves it alone', () => {
    expect(channelCaptionTestPattern(off, null)).toBe(false);
    expect(channelCaptionTestPattern(off, { testPattern: false })).toBe(false);
  });

  test('follows the global switch, which a channel cannot turn off', () => {
    expect(channelCaptionTestPattern(on, null)).toBe(true);
    expect(channelCaptionTestPattern(on, { testPattern: false })).toBe(true);
  });
});
