import { TableSkeleton } from '@/components/base/TableSkeleton.tsx';
import { createFileRoute } from '@tanstack/react-router';
import TasksPage from '../../pages/system/TasksPage.tsx';

export const Route = createFileRoute('/system/tasks')({
  component: TasksPage,
  pendingComponent: () => <TableSkeleton columns={5} />,
});
