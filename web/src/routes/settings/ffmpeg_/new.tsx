import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/ffmpeg_/new')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/playback/new', replace: true });
  },
});
