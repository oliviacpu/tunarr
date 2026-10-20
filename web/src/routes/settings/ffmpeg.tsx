import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/ffmpeg')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/playback', replace: true });
  },
});
