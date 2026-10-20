import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
  getApiSettingsSystemOptions,
  getApiSystemStateOptions,
} from '../generated/@tanstack/react-query.gen.ts';

export const useSystemSettings = () =>
  useQuery({
    ...getApiSettingsSystemOptions(),
  });

export const useSystemSettingsSuspense = () =>
  useSuspenseQuery(getApiSettingsSystemOptions());

export const useSystemState = () =>
  useSuspenseQuery({
    ...getApiSystemStateOptions(),
  });
