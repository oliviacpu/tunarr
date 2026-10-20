import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
  getApiSystemSettingsOptions,
  getApiSystemStateOptions,
} from '../generated/@tanstack/react-query.gen.ts';

export const useSystemSettings = () =>
  useQuery({
    ...getApiSystemSettingsOptions(),
  });

export const useSystemSettingsSuspense = () =>
  useSuspenseQuery(getApiSystemSettingsOptions());

export const useSystemState = () =>
  useSuspenseQuery({
    ...getApiSystemStateOptions(),
  });
