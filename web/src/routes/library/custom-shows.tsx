import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import { customShowsQuery } from '@/hooks/useCustomShows';
import CustomShowsPage from '@/pages/library/CustomShowsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/library/custom-shows')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(customShowsQuery()),
  component: CustomShowsPage,
  pendingComponent: () => <TableSkeleton columns={3} />,
});
