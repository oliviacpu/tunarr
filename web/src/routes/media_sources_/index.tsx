import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import { createFileRoute } from '@tanstack/react-router';
import MediaSourcesPage from '../../pages/media_sources/MediaSourcesPage.tsx';

export const Route = createFileRoute('/media_sources_/')({
  component: MediaSourcesPage,
  pendingComponent: () => <TableSkeleton columns={6} />,
});
