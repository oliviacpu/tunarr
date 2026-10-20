import { describe, expect, test } from 'vitest';
import { navItemForPath } from '../../hooks/navMatch.ts';
import { buildNavItems } from '../../hooks/useNavItems.tsx';
import {
  ChannelEditTabPaths,
  ChannelEditorTabs,
  channelTabFromPath,
  legacyChannelTab,
} from './channelFieldTabs.ts';

describe('channel edit tab routes', () => {
  test.each(ChannelEditorTabs)(
    '%s is addressable and highlights Channels',
    (tab) => {
      const path = ChannelEditTabPaths[tab].replace('$channelId', 'abc');
      expect(channelTabFromPath(path)).toBe(tab);
      expect(channelTabFromPath(`/web${path}/`)).toBe(tab);
      expect(navItemForPath(buildNavItems(true, null, 0), path)?.path).toBe(
        '/channels',
      );
    },
  );

  test.each([
    [undefined, 'properties'],
    ['properties', 'properties'],
    ['flex', 'flex'],
    ['epg', 'guide'],
    ['ffmpeg', 'streaming'],
    ['guide', 'guide'],
    ['streaming', 'streaming'],
    ['watermark', 'watermark'],
    ['unknown', 'properties'],
  ])('legacy tab %s opens %s', (tab, expected) => {
    expect(legacyChannelTab(tab)).toBe(expected);
  });
});
