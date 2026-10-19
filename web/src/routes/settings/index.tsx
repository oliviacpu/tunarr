import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings has no page of its own; open its first tab.
export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/general', replace: true });
  },
});
