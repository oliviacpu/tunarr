import GeneralSettingsPage from '@/pages/settings/GeneralSettingsPage';
import { createFileRoute } from '@tanstack/react-router';
import {
  getApiSystemSettingsOptions,
  getApiSystemStateOptions,
} from '../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/settings/general')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...getApiSystemStateOptions(),
      }),
      context.queryClient.ensureQueryData(getApiSystemSettingsOptions()),
    ]);
  },
  component: GeneralSettingsPage,
});
