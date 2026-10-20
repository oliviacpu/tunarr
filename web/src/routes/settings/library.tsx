import {
  getApiMediaSourcesOptions,
  getApiSettingsMediaSourceOptions,
  getApiSystemSettingsOptions,
} from '@/generated/@tanstack/react-query.gen.ts';
import { LibrarySettingsPage } from '@/pages/settings/LibrarySettingsPage.tsx';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/library')({
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(getApiMediaSourcesOptions()),
      context.queryClient.ensureQueryData(getApiSettingsMediaSourceOptions()),
      context.queryClient.ensureQueryData(getApiSystemSettingsOptions()),
    ]);
  },
  component: LibrarySettingsPage,
});
