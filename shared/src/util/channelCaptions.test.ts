import { defaultFfmpegSettings } from '@tunarr/types';
import {
  channelCaptionLook,
  channelHasOwnCaptionLook,
  normalizeChannelCaptions,
} from './channelCaptions.js';

const global = {
  ...defaultFfmpegSettings,
  hdhrCaptionAlignment: 'centeredLines' as const,
  hdhrCaptionAppearance: {
    ...defaultFfmpegSettings.hdhrCaptionAppearance,
    textColor: 'yellow' as const,
    maxLines: 3,
  },
};

describe('normalizeChannelCaptions', () => {
  test('keeps only what the channel sets', () => {
    expect(
      normalizeChannelCaptions({
        testPattern: false,
        alignment: 'left',
        appearance: { textColor: 'red', maxLines: undefined },
      }),
    ).toEqual({ alignment: 'left', appearance: { textColor: 'red' } });
  });

  test('nothing set is null: the channel uses the global settings', () => {
    expect(normalizeChannelCaptions({})).toBeNull();
    expect(normalizeChannelCaptions({ testPattern: false })).toBeNull();
    expect(normalizeChannelCaptions({ appearance: {} })).toBeNull();
    expect(normalizeChannelCaptions(undefined)).toBeNull();
  });
});

describe('channelCaptionLook', () => {
  test('is the global look for a channel without its own', () => {
    expect(channelCaptionLook(global, null)).toEqual({
      appearance: global.hdhrCaptionAppearance,
      alignment: 'centeredLines',
    });
    expect(channelCaptionLook(global, undefined)).toEqual(
      channelCaptionLook(global, {}),
    );
  });

  test("puts the channel's fields over the global ones and keeps the rest", () => {
    const look = channelCaptionLook(global, {
      alignment: 'left',
      appearance: { backgroundColor: 'magenta', maxLines: 2 },
    });

    expect(look).toEqual({
      appearance: {
        ...global.hdhrCaptionAppearance,
        backgroundColor: 'magenta',
        maxLines: 2,
      },
      alignment: 'left',
    });
    // From the global look
    expect(look.appearance.textColor).toBe('yellow');
  });

  test('a field the channel leaves undefined keeps the global value', () => {
    const look = channelCaptionLook(global, {
      appearance: { textColor: undefined, upperCase: true },
    });

    expect(look.appearance.textColor).toBe('yellow');
    expect(look.appearance.upperCase).toBe(true);
    expect(look.alignment).toBe('centeredLines');
  });
});

describe('channelHasOwnCaptionLook', () => {
  test.each([
    [null, false],
    [undefined, false],
    [{}, false],
    [{ testPattern: true }, false],
    [{ appearance: {} }, false],
    [{ appearance: { textColor: undefined } }, false],
    [{ alignment: 'left' as const }, true],
    [{ appearance: { backgroundColor: 'magenta' as const } }, true],
    // A setting turned off is still one the channel sets
    [{ appearance: { upperCase: false } }, true],
  ])('%j: %s', (captions, expected) => {
    expect(channelHasOwnCaptionLook(captions)).toBe(expected);
  });
});
