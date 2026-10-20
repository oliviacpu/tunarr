import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import { createFileRoute } from '@tanstack/react-router';
import MediaSourceSettingsPage from '../../pages/settings/MediaSourceSettingsPage.tsx';

export const Route = createFileRoute('/media_sources_/')({
  component: MediaSourceSettingsPage,
  pendingComponent: () => <TableSkeleton columns={6} />,
});
