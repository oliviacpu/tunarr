import { TranscodeConfigSettingsForm } from '@/components/settings/ffmpeg/TranscodeConfigSettingsForm';

import { getApiTranscodeConfigsByIdOptions } from '@/generated/@tanstack/react-query.gen.ts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Route } from '@/routes/settings/playback_/$configId';

export const EditTranscodeConfigSettingsPage = () => {
  const { configId } = Route.useParams();

  const transcodeConfig = useSuspenseQuery({
    ...getApiTranscodeConfigsByIdOptions({ path: { id: configId } }),
    refetchOnMount: false,
  });

  return <TranscodeConfigSettingsForm initialConfig={transcodeConfig.data} />;
};
