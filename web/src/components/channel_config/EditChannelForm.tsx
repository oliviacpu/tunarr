import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { toChannelUpdateRequest } from '@/helpers/channelUpdateRequest.ts';
import { DefaultChannel } from '@/helpers/constants.ts';
import { useSettingsMutation } from '@/hooks/useSettingsMutation.ts';
import { useToasts } from '@/strings/actions';
import { Badge } from '@mui/material';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useNavigate } from '@tanstack/react-router';
import type {
  Channel,
  SaveableChannel,
  SubtitlePreference,
} from '@tunarr/types';
import { isEmpty, isEqual, isNil, keys, map, omit, reject } from 'lodash-es';
import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import type { DeepRequired, NonEmptyArray } from 'ts-essentials';
import {
  createChannelV2Mutation,
  putApiChannelsByIdMutation,
} from '../../generated/@tanstack/react-query.gen.ts';
import { invalidateTaggedQueries } from '../../helpers/queryUtil.ts';
import { isNonEmptyString } from '../../helpers/util.ts';
import ChannelEpgConfig from './ChannelEpgConfig.tsx';
import { ChannelFlexConfig } from './ChannelFlexConfig.tsx';
import { ChannelPropertiesEditor } from './ChannelPropertiesEditor.tsx';
import ChannelTranscodingConfig from './ChannelTranscodingConfig.tsx';
import { tabsWithErrors } from './channelFieldTabs.ts';
import { ChannelEditorTabs, useChannelTabLabels } from './channelFieldTabs.ts';
import {
  EditChannelTabPanel,
  type EditChannelTabs,
} from './EditChannelTabPanel.tsx';

// captions stays sparse: a channel saves only the caption settings it sets
function getDefaultFormValues(
  channel: Channel,
): DeepRequired<Omit<SaveableChannel, 'captions'>> &
  Pick<SaveableChannel, 'captions'> {
  return {
    ...omit(channel, ['fallback', 'programCount', 'sessions']),
    streamMode: channel.streamMode ?? 'hls',
    fillerCollections: channel.fillerCollections ?? [],
    fillerRepeatCooldown:
      (!isNil(channel.fillerRepeatCooldown)
        ? channel.fillerRepeatCooldown
        : DefaultChannel.fillerRepeatCooldown!) / 1000,
    guideFlexTitle: channel.guideFlexTitle ?? '',
    guideMinimumDuration: channel.guideMinimumDuration / 1000,
    offline: {
      ...channel.offline,
      picture: channel.offline.picture ?? DefaultChannel.offline.picture ?? '',
      soundtrack:
        channel.offline.soundtrack ?? DefaultChannel.offline.soundtrack ?? '',
      // '' = no gap music
      musicListId: channel.offline.musicListId ?? '',
      // on unless turned off
      showNowPlaying: channel.offline.showNowPlaying ?? true,
      // '' = gaps use the image above, or the channel logo, in the guide
      guidePicture: channel.offline.guidePicture ?? '',
    },
    watermark: {
      ...(channel.watermark ?? {}),
      enabled: channel.watermark?.enabled ?? false,
      url: channel.watermark?.url ?? '',
      width: channel.watermark?.width ?? 10,
      horizontalMargin: channel.watermark?.horizontalMargin ?? 1,
      verticalMargin: channel.watermark?.verticalMargin ?? 1,
      fixedSize: channel.watermark?.fixedSize ?? false,
      animated: channel.watermark?.animated ?? false,
      duration: channel.watermark?.duration ?? 0,
      position: channel.watermark?.position ?? 'bottom-right',
      opacity: channel.watermark?.opacity ?? 100,
      fadeConfig: channel.watermark?.fadeConfig?.map((conf) => ({
        ...conf,
        leadingEdge: conf.leadingEdge ?? false,
        programType: conf.programType ?? 'episode',
      })) ?? [
        {
          periodMins: 0,
          leadingEdge: true,
          programType: 'episode', // Unused
        },
      ],
    },
    icon: {
      ...channel.icon,
      useDefaultIconFallback: channel.icon?.useDefaultIconFallback ?? true,
    },
    onDemand: {
      enabled: channel.onDemand.enabled,
    },
    subtitlesEnabled: channel.subtitlesEnabled,
    subtitlePreferences: channel.subtitlePreferences ?? [],
    audioTracks: channel.audioTracks ?? [],
    captions: channel.captions ?? null,
  };
}

export function EditChannelForm({
  channel,
  isNew,
  initialTab,
}: EditChannelFormProps) {
  const navigate = useNavigate({
    from: isNew ? '/channels/new' : '/channels/$channelId/edit',
  });
  const toasts = useToasts();
  const [currentTab, setCurrentTab] = useState<EditChannelTabs>(
    initialTab ?? 'properties',
  );

  const form = useForm<SaveableChannel>({
    mode: 'onTouched',
    defaultValues: getDefaultFormValues(channel),
  });

  const {
    reset,
    formState: { defaultValues },
  } = form;
  useEffect(() => {
    const loaded = getDefaultFormValues(channel);
    if (!isEqual(loaded, defaultValues)) {
      reset(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, reset]);

  // The channel list, every loaded channel and their lineups
  const invalidate = { predicate: invalidateTaggedQueries('Channels') };

  const updateChannelMutation = useSettingsMutation({
    form,
    mutation: putApiChannelsByIdMutation(),
    toFormValues: (saved) => getDefaultFormValues(saved),
    invalidate,
    failureMessage: toasts.couldNotSave,
  });

  const createChannelMutation = useSettingsMutation({
    form,
    mutation: {
      ...createChannelV2Mutation(),
      // A new channel is programmed next. The save has reset the form, but
      // the unsaved guard keeps the state from before it until it renders
      // again, so it would stop this
      onSuccess: (created) =>
        navigate({
          to: '/channels/$channelId/programming',
          params: { channelId: created.id },
          ignoreBlocker: true,
        }),
    },
    toFormValues: (created) => getDefaultFormValues(created),
    invalidate,
    failureMessage: toasts.couldNotSave,
  });

  const formIsValid = form.formState.isValid;
  const tabsWithFormErrors = tabsWithErrors(keys(form.formState.errors));

  const onSubmit: SubmitHandler<SaveableChannel> = (data) => {
    const fadeConfigs = reject(
      data.watermark?.fadeConfig,
      (conf) => conf.periodMins <= 0,
    );

    const preferences =
      !data.subtitlePreferences || data.subtitlePreferences.length === 0
        ? undefined
        : map(data.subtitlePreferences, (pref, idx) => ({
            ...pref,
            priority: idx,
          }));

    const dataTransform = {
      ...data,
      // Transform this to milliseconds before we send it over
      guideMinimumDuration: data.guideMinimumDuration * 1000,
      fillerRepeatCooldown: !isNil(data.fillerRepeatCooldown)
        ? data.fillerRepeatCooldown * 1000
        : undefined,
      guideFlexTitle: isNonEmptyString(data.guideFlexTitle)
        ? data.guideFlexTitle
        : undefined,
      fillerCollections: data.fillerCollections,
      watermark: data.watermark
        ? {
            ...data.watermark,
            enabled: !!data.watermark.enabled,
            fadeConfig: isEmpty(fadeConfigs) ? undefined : fadeConfigs,
          }
        : undefined,
      subtitlePreferences: preferences as NonEmptyArray<SubtitlePreference>,
    } satisfies SaveableChannel;

    if (isNew) {
      createChannelMutation.mutate({
        body: {
          type: 'new',
          channel: dataTransform,
        },
      });
    } else {
      updateChannelMutation.mutate({
        path: { id: channel.id },
        body: toChannelUpdateRequest(
          dataTransform,
          form.formState.defaultValues?.startTime,
        ),
      });
    }
  };

  const handleChange = (_: React.SyntheticEvent, newValue: EditChannelTabs) => {
    if (newValue !== currentTab) {
      setCurrentTab(newValue);
      // Don't enable routing for new channel, yet.
      if (!isNew) {
        navigate({
          replace: true,
          search: { tab: newValue === 'properties' ? undefined : newValue },
        }).catch(console.warn);
      }
    }
  };

  // Which fields each tab holds is in ChannelFieldTabs
  const tabLabels = useChannelTabLabels();

  const renderTab = (tab: EditChannelTabs) => {
    const hasError = tabsWithFormErrors.has(tab);
    return (
      <Tab
        key={tab}
        disabled={isNew && tab !== currentTab && !formIsValid}
        value={tab}
        label={
          <Badge
            color="error"
            variant="dot"
            slotProps={{ badge: { style: { right: -3, top: -3 } } }}
            invisible={!hasError}
          >
            {tabLabels[tab]}
          </Badge>
        }
      />
    );
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ borderColor: 'primary', borderBottom: 1 }}>
        <Tabs
          value={currentTab}
          onChange={handleChange}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {ChannelEditorTabs.map(renderTab)}
        </Tabs>
      </Box>
      <SettingsForm
        form={form}
        onSubmit={onSubmit}
        isSubmitting={
          createChannelMutation.isPending || updateChannelMutation.isPending
        }
        isNew={isNew}
        // The page moves on once the channel exists, so a change made while
        // it is being created would be lost
        disabled={createChannelMutation.isPending}
      >
        <EditChannelTabPanel value="properties" currentValue={currentTab}>
          <ChannelPropertiesEditor />
        </EditChannelTabPanel>
        <EditChannelTabPanel value="flex" currentValue={currentTab}>
          <ChannelFlexConfig />
        </EditChannelTabPanel>
        <EditChannelTabPanel value="epg" currentValue={currentTab}>
          <ChannelEpgConfig />
        </EditChannelTabPanel>
        <EditChannelTabPanel value="ffmpeg" currentValue={currentTab}>
          <ChannelTranscodingConfig />
        </EditChannelTabPanel>
      </SettingsForm>
    </Paper>
  );
}
type EditChannelFormProps = {
  channel: Channel;
  isNew: boolean;
  initialTab?: EditChannelTabs;
};
