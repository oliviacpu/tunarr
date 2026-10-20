import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/ffmpeg_/$configId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/settings/playback/$configId',
      params,
      replace: true,
    });
  },
});
