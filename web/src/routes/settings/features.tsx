import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/features')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/experimental', replace: true });
  },
});
