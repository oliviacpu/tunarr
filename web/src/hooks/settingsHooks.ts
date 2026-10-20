import { useSuspenseQuery } from '@tanstack/react-query';
import {
  getApiChannelsByIdTranscodeConfigOptions,
  getApiSettingsFfmpegOptions,
  getApiSettingsHdhrOptions,
  getApiMediaSourcesOptions,
  getApiTranscodeConfigsByIdOptions,
  getApiTranscodeConfigsOptions,
  getApiSettingsXmltvOptions,
} from '../generated/@tanstack/react-query.gen.ts';

export const useXmlTvSettings = () =>
  useSuspenseQuery(getApiSettingsXmltvOptions());

export const useFfmpegSettings = () =>
  useSuspenseQuery(getApiSettingsFfmpegOptions());

export const useMediaSources = () =>
  useSuspenseQuery(getApiMediaSourcesOptions());

export const useHdhrSettings = () => {
  return useSuspenseQuery({
    ...getApiSettingsHdhrOptions(),
  });
};

export const transcodeConfigsQueryOptions = () =>
  getApiTranscodeConfigsOptions();

export const useTranscodeConfigs = () => {
  return useSuspenseQuery(transcodeConfigsQueryOptions());
};

export const useTranscodeConfig = (id: string) =>
  useSuspenseQuery({
    ...getApiTranscodeConfigsByIdOptions({ path: { id } }),
  });

export const useChannelTranscodeConfig = (channelId: string) =>
  useSuspenseQuery({
    ...getApiChannelsByIdTranscodeConfigOptions({ path: { id: channelId } }),
  });
