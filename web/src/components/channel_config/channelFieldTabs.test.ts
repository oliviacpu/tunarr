import { SaveableChannelSchema } from '@tunarr/types/schemas';
import { describe, expect, test } from 'vitest';
import { ChannelFieldTabs, tabsWithErrors } from './channelFieldTabs.ts';

describe('ChannelFieldTabs', () => {
  test('maps every saveable channel field to a tab', () => {
    const mapped = Object.keys(ChannelFieldTabs);
    const unmapped = Object.keys(SaveableChannelSchema.shape).filter(
      (field) => !mapped.includes(field),
    );
    expect(unmapped).toEqual([]);
  });

  test('maps only saveable channel fields', () => {
    const fields = Object.keys(SaveableChannelSchema.shape);
    const extra = Object.keys(ChannelFieldTabs).filter(
      (field) => !fields.includes(field),
    );
    expect(extra).toEqual([]);
  });
});

describe('tabsWithErrors', () => {
  test.each([
    ['startTime', 'properties'],
    ['onDemand', 'properties'],
    ['disableFillerOverlay', 'flex'],
    ['transcodeConfigId', 'ffmpeg'],
    ['guideMinimumDuration', 'epg'],
  ])('an error in %s marks the %s tab', (field, tab) => {
    expect([...tabsWithErrors([field])]).toEqual([tab]);
  });

  test('marks each tab with an error once', () => {
    expect(
      tabsWithErrors(['name', 'startTime', 'streamMode', 'captions']),
    ).toEqual(new Set(['properties', 'ffmpeg']));
  });

  test('ignores keys that are not channel fields', () => {
    expect(tabsWithErrors(['root', 'toString'])).toEqual(new Set());
  });
});
