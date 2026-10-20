import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import { fillerListsQuery } from '@/hooks/useFillerLists';
import FillerListsPage from '@/pages/library/FillerListsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/library/fillers')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(fillerListsQuery()),
  component: FillerListsPage,
  pendingComponent: () => <TableSkeleton columns={3} />,
});
