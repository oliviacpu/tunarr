import { createFileRoute, redirect } from '@tanstack/react-router';

// Media sources used to render here too. Keep old links working.
export const Route = createFileRoute('/settings/sources')({
  beforeLoad: () => {
    throw redirect({ to: '/media_sources', replace: true });
  },
});
