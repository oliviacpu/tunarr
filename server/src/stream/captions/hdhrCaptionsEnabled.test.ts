import type { ChannelStreamMode } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import type { HdhrCaptionsInput } from './hdhrCaptionsEnabled.ts';
import {
  hdhrCaptionsEnabled,
  hdhrCaptionsWanted,
} from './hdhrCaptionsEnabled.ts';

// Everything that captions need
const on: HdhrCaptionsInput = {
  hdhrClosedCaptions: true,
  streamMode: 'hls',
  subtitlesEnabled: true,
  videoFormat: 'h264',
};

describe('hdhrCaptionsEnabled', () => {
  test('captions an H.264 HLS channel with subtitles on and the switch on', () => {
    expect(hdhrCaptionsEnabled(on)).toBe(true);
    expect(hdhrCaptionsWanted(on)).toBe(true);
  });

  test('the switch off turns captions off', () => {
    const input = { ...on, hdhrClosedCaptions: false };
    expect(hdhrCaptionsEnabled(input)).toBe(false);
    expect(hdhrCaptionsWanted(input)).toBe(false);
  });

  test.each([false, null])(
    'a channel with subtitles %s gets no captions',
    (subtitlesEnabled) => {
      const input = { ...on, subtitlesEnabled };
      expect(hdhrCaptionsEnabled(input)).toBe(false);
      expect(hdhrCaptionsWanted(input)).toBe(false);
    },
  );

  test.each<ChannelStreamMode | undefined>([
    'hls_slower',
    'hls_direct',
    'hls_direct_v2',
    'mpegts',
    undefined,
  ])('only the HLS stream mode is captioned, not %s', (streamMode) => {
    const input = { ...on, streamMode };
    expect(hdhrCaptionsEnabled(input)).toBe(false);
    expect(hdhrCaptionsWanted(input)).toBe(false);
  });

  // Captions can only be written into H.264 video
  test.each(['hevc', 'mpeg2video'] as const)(
    '%s output is wanted but not captioned',
    (videoFormat) => {
      const input = { ...on, videoFormat };
      expect(hdhrCaptionsEnabled(input)).toBe(false);
      expect(hdhrCaptionsWanted(input)).toBe(true);
    },
  );
});
