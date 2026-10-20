import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import MediaSourceSettingsPage from '@/pages/settings/MediaSourceSettingsPage';
import { createFileRoute } from '@tanstack/react-router';
import {
  getApiMediaSourcesOptions,
  getApiSettingsMediaSourceOptions,
} from '../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/settings/sources')({
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.ensureQueryData(getApiMediaSourcesOptions()),
      context.queryClient.ensureQueryData(getApiSettingsMediaSourceOptions()),
    ]);
  },
  component: MediaSourceSettingsPage,
  pendingComponent: () => <TableSkeleton columns={6} />,
});
