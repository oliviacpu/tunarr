import { useLingui } from '@lingui/react/macro';
import type { SaveableChannel } from '@tunarr/types';
import type { EditChannelTabs } from './EditChannelTabPanel.tsx';

/** The channel editor's tabs, in display order. */
export const ChannelEditorTabs: readonly EditChannelTabs[] = [
  'properties',
  'flex',
  'guide',
  'streaming',
  'watermark',
];

export function useChannelTabLabels(): Record<EditChannelTabs, string> {
  const { t } = useLingui();
  return {
    properties: t`Properties`,
    flex: t`Flex`,
    guide: t`Guide`,
    streaming: t`Streaming`,
    watermark: t`Watermark`,
  };
}

/**
 * The channel editor tab that shows each form field, so a validation error
 * marks the tab to open to fix it. Covers every SaveableChannel key: a new
 * schema field without a tab here fails to compile.
 */
export const ChannelFieldTabs: Record<keyof SaveableChannel, EditChannelTabs> =
  {
    number: 'properties',
    name: 'properties',
    groupTitle: 'properties',
    startTime: 'properties',
    icon: 'properties',
    onDemand: 'properties',
    // Not inputs on any tab: the form carries them over from the loaded channel
    id: 'properties',
    duration: 'properties',
    offline: 'flex',
    fillerCollections: 'flex',
    fillerRepeatCooldown: 'flex',
    disableFillerOverlay: 'flex',
    stealth: 'guide',
    guideFlexTitle: 'guide',
    guideMinimumDuration: 'guide',
    streamMode: 'streaming',
    transcodeConfigId: 'streaming',
    watermark: 'watermark',
    subtitlesEnabled: 'streaming',
    subtitlePreferences: 'streaming',
    audioTracks: 'streaming',
    captions: 'streaming',
  };

/**
 * The tabs holding a field with an error, given the top-level keys of the
 * form's errors. Keys that are not channel fields (such as react-hook-form's
 * "root") mark no tab.
 */
export function tabsWithErrors(
  errorKeys: readonly string[],
): Set<EditChannelTabs> {
  const tabs = new Set<EditChannelTabs>();
  for (const [field, tab] of Object.entries(ChannelFieldTabs)) {
    if (errorKeys.includes(field)) {
      tabs.add(tab);
    }
  }
  return tabs;
}

export const ChannelEditTabPaths = {
  properties: '/channels/$channelId/edit/properties',
  flex: '/channels/$channelId/edit/flex',
  guide: '/channels/$channelId/edit/guide',
  streaming: '/channels/$channelId/edit/streaming',
  watermark: '/channels/$channelId/edit/watermark',
} as const satisfies Record<EditChannelTabs, string>;

export function channelTabFromPath(pathname: string): EditChannelTabs {
  const lastSegment = pathname.replace(/\/+$/, '').split('/').pop();
  return ChannelEditorTabs.find((tab) => tab === lastSegment) ?? 'properties';
}

export function legacyChannelTab(tab: string | undefined): EditChannelTabs {
  if (tab === 'epg') return 'guide';
  if (tab === 'ffmpeg') return 'streaming';
  return ChannelEditorTabs.find((value) => value === tab) ?? 'properties';
}
