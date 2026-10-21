import type { GlobalSubtitlePreference } from '@tunarr/types/schemas';
import { describe, expect, it } from 'vitest';
import type { ChannelSubtitlePreferences } from '../db/schema/SubtitlePreferences.ts';
import { resolveEffectiveSubtitlePreferences } from './resolveSubtitlePreferences.ts';

const channelRows: ChannelSubtitlePreferences[] = [
  {
    uuid: 'pref',
    channelId: 'channel',
    languageCode: 'eng',
    priority: 3,
    filterType: 'none',
    allowExternal: false,
    allowImageBased: false,
  },
];
const globalRows: GlobalSubtitlePreference[] = [
  {
    languageCode: 'jpn',
    filter: 'forced',
    allowExternal: true,
    allowImageBased: false,
  },
  {
    languageCode: 'eng',
    filter: 'any',
    allowExternal: false,
    allowImageBased: true,
  },
];

describe('resolveEffectiveSubtitlePreferences', () => {
  it('inherits globals in saved order and ignores retained custom rows', () => {
    const result = resolveEffectiveSubtitlePreferences(
      'inherit',
      channelRows,
      globalRows,
    );
    expect(result).toEqual({ source: 'global', preferences: globalRows });
    expect(result.preferences).toBe(globalRows);
  });

  it('retains an empty inherited list even with saved custom rows', () => {
    expect(
      resolveEffectiveSubtitlePreferences('inherit', channelRows, []),
    ).toEqual({
      source: 'global',
      preferences: [],
    });
  });

  it('keeps custom rows and none filters unchanged', () => {
    const result = resolveEffectiveSubtitlePreferences(
      'custom',
      channelRows,
      globalRows,
    );
    expect(result).toEqual({ source: 'channel', preferences: channelRows });
    expect(result.preferences).toBe(channelRows);
  });

  it('keeps custom empty lists independent of globals', () => {
    expect(
      resolveEffectiveSubtitlePreferences('custom', [], globalRows),
    ).toEqual({
      source: 'channel',
      preferences: [],
    });
  });
});
