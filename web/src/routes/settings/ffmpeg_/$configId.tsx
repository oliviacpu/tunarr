import { orNotFound } from '@/helpers/routeLoaders.ts';
import { EditTranscodeConfigSettingsPage } from '@/pages/settings/EditTranscodeConfigSettingsPage';
import { createFileRoute } from '@tanstack/react-router';
import { getApiTranscodeConfigsByIdOptions } from '../../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/settings/ffmpeg_/$configId')({
  gcTime: 0,
  loader: ({ params, context }) => {
    return orNotFound(
      context.queryClient.fetchQuery(
        getApiTranscodeConfigsByIdOptions({
          path: { id: params.configId },
        }),
      ),
    );
  },
  component: EditTranscodeConfigSettingsPage,
});
