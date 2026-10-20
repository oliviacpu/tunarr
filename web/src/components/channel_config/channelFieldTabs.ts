import { useLingui } from '@lingui/react/macro';
import type { SaveableChannel } from '@tunarr/types';
import type { EditChannelTabs } from './EditChannelTabPanel.tsx';

/** The channel editor's tabs, in display order. */
export const ChannelEditorTabs: readonly EditChannelTabs[] = [
  'properties',
  'flex',
  'epg',
  'ffmpeg',
];

/**
 * The label each channel editor tab shows. The values are older names kept in
 * `?tab=` links: "epg" is the Guide tab and "ffmpeg" the Streaming tab.
 */
export function useChannelTabLabels(): Record<EditChannelTabs, string> {
  const { t } = useLingui();
  return {
    properties: t`Properties`,
    flex: t`Flex`,
    epg: t`Guide`,
    ffmpeg: t`Streaming`,
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
    stealth: 'epg',
    guideFlexTitle: 'epg',
    guideMinimumDuration: 'epg',
    streamMode: 'ffmpeg',
    transcodeConfigId: 'ffmpeg',
    watermark: 'ffmpeg',
    subtitlesEnabled: 'ffmpeg',
    subtitlePreferences: 'ffmpeg',
    audioTracks: 'ffmpeg',
    captions: 'ffmpeg',
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
