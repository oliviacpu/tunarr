import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/xmltv')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/guide', replace: true });
  },
});
