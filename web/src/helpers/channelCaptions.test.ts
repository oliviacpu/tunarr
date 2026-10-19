import type { FfmpegSettings } from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import { changedCaptionAppearance } from './channelCaptions.ts';

const globalSettings: FfmpegSettings = {
  ...defaultFfmpegSettings,
  hdhrCaptionAlignment: 'centeredLines',
  hdhrCaptionAppearance: {
    ...defaultFfmpegSettings.hdhrCaptionAppearance,
    textColor: 'yellow',
  },
};

describe('changedCaptionAppearance', () => {
  test('only the fields an edit changed', () => {
    const current = globalSettings.hdhrCaptionAppearance;

    expect(
      changedCaptionAppearance(current, { ...current, maxLines: 4 }),
    ).toEqual({ maxLines: 4 });
    expect(changedCaptionAppearance(current, current)).toEqual({});
  });
});
