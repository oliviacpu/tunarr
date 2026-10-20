import { renderWithProviders, screen } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { TranscodeConfig } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import { getApiFfmpegInfoQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
import { TranscodeConfigSettingsForm } from './TranscodeConfigSettingsForm.tsx';

const config: TranscodeConfig = {
  id: 'b9cd0d93-ad9d-492b-947d-2b96faf8fa32',
  name: 'Software',
  threadCount: 0,
  resolution: { widthPx: 1920, heightPx: 1080 },
  audioBitRate: 192,
  audioBufferSize: 576,
  audioChannels: 2,
  audioSampleRate: 48,
  audioFormat: 'aac',
  hardwareAccelerationMode: 'none',
  normalizeFrameRate: false,
  deinterlaceVideo: true,
  videoBitRate: 3500,
  videoBufferSize: 7000,
  videoFormat: 'h264',
  isDefault: false,
  audioVolumePercent: 100,
  disableChannelOverlay: false,
  errorScreen: 'pic',
  errorScreenAudio: 'silent',
  vaapiDevice: '',
  vaapiDriver: 'system',
  videoBitDepth: 8,
  videoPreset: '',
  videoProfile: '',
  disableHardwareDecoder: false,
  disableHardwareEncoding: false,
  disableHardwareFilters: false,
  audioLoudnormConfig: null,
};

function renderForm(path: string, isNew: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(getApiFfmpegInfoQueryKey(), {
    audioEncoders: [],
    videoEncoders: [],
    hardwareAccelerationTypes: [],
  });
  const rootRoute = createRootRoute();
  const formRoute = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => (
      <TranscodeConfigSettingsForm initialConfig={config} isNew={isNew} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([formRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithProviders(<RouterProvider router={router} />, {
    queryClient,
  });
}

describe('TranscodeConfigSettingsForm title', () => {
  test('says New when creating a config', async () => {
    renderForm('/settings/ffmpeg/new', true);

    expect(
      await screen.findByRole('heading', { name: 'New transcode config' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Edit transcode config/i),
    ).not.toBeInTheDocument();
  });

  test('says Edit and names the config when editing one', async () => {
    renderForm(`/settings/ffmpeg/${config.id}`, false);

    expect(
      await screen.findByRole('heading', {
        name: 'Edit transcode config: "Software"',
      }),
    ).toBeInTheDocument();
  });
});
