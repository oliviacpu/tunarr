import GeneralSettingsPage from '@/pages/settings/GeneralSettingsPage';
import { createFileRoute } from '@tanstack/react-router';
import {
  getApiSettingsSystemOptions,
  getApiSystemStateOptions,
} from '../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/settings/general')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...getApiSystemStateOptions(),
      }),
      context.queryClient.ensureQueryData(getApiSettingsSystemOptions()),
    ]);
  },
  component: GeneralSettingsPage,
});
