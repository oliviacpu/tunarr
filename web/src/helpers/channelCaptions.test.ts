import type { FfmpegSettings } from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import {
  channelCaptionLook,
  hasOwnCaptionLook,
  normalizeChannelCaptions,
} from './channelCaptions.ts';

const globalSettings: FfmpegSettings = {
  ...defaultFfmpegSettings,
  hdhrCaptionAlignment: 'centeredLines',
  hdhrCaptionAppearance: {
    ...defaultFfmpegSettings.hdhrCaptionAppearance,
    textColor: 'yellow',
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
  test("the channel's settings over the global ones", () => {
    const look = channelCaptionLook(globalSettings, {
      appearance: { textColor: 'magenta', maxLines: undefined },
    });

    expect(look.appearance).toEqual({
      ...globalSettings.hdhrCaptionAppearance,
      textColor: 'magenta',
    });
    expect(look.alignment).toBe('centeredLines');
  });
});

describe('hasOwnCaptionLook', () => {
  test('an alignment or any appearance setting is a look of its own', () => {
    expect(hasOwnCaptionLook({ alignment: 'left' })).toBe(true);
    expect(hasOwnCaptionLook({ appearance: { upperCase: false } })).toBe(true);
  });

  test('a test pattern alone, or nothing, is not', () => {
    expect(hasOwnCaptionLook({ testPattern: true })).toBe(false);
    expect(hasOwnCaptionLook({ appearance: { textColor: undefined } })).toBe(
      false,
    );
    expect(hasOwnCaptionLook(null)).toBe(false);
  });
});
