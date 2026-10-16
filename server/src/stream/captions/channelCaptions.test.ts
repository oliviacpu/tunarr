import { defaultFfmpegSettings } from '@tunarr/types';
import {
  channelCaptionAppearance,
  channelCaptionTestPattern,
  channelHasOwnCaptionLook,
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

describe('channelCaptionAppearance', () => {
  test('is the global look for a channel without its own', () => {
    expect(channelCaptionAppearance(global, null)).toEqual({
      ...global.hdhrCaptionAppearance,
      alignment: 'centeredLines',
    });
    expect(channelCaptionAppearance(global, undefined)).toEqual(
      channelCaptionAppearance(global, {}),
    );
  });

  test("puts the channel's fields over the global ones and keeps the rest", () => {
    const look = channelCaptionAppearance(global, {
      alignment: 'left',
      appearance: { backgroundColor: 'magenta', maxLines: 2 },
    });

    expect(look).toEqual({
      ...global.hdhrCaptionAppearance,
      backgroundColor: 'magenta',
      maxLines: 2,
      alignment: 'left',
    });
    // From the global look
    expect(look.textColor).toBe('yellow');
  });

  test('a field the channel leaves undefined keeps the global value', () => {
    const look = channelCaptionAppearance(global, {
      appearance: { textColor: undefined, upperCase: true },
    });
    expect(look.textColor).toBe('yellow');
    expect(look.upperCase).toBe(true);
    expect(look.alignment).toBe('centeredLines');
  });
});

describe('channelHasOwnCaptionLook', () => {
  test.each([
    [null, false],
    [{}, false],
    [{ testPattern: true }, false],
    [{ appearance: {} }, false],
    [{ appearance: { textColor: undefined } }, false],
    [{ alignment: 'left' as const }, true],
    [{ appearance: { backgroundColor: 'magenta' as const } }, true],
  ])('%j: %s', (captions, expected) => {
    expect(channelHasOwnCaptionLook(captions)).toBe(expected);
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
