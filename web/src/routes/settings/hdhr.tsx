import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/hdhr')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/tuner', replace: true });
  },
});
