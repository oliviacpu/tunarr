import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/scanner')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/library', replace: true });
  },
});
