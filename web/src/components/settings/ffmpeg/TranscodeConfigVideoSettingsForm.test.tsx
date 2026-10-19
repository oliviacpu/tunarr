import { useAppForm } from '@/hooks/form.ts';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import type { TranscodeConfig } from '@tunarr/types';
import { describe, expect, test, vi } from 'vitest';
import { getApiFfmpegInfoQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
import { TranscodeConfigVideoSettingsForm } from './TranscodeConfigVideoSettingsForm.tsx';
import { useBaseTranscodeConfigFormOptions } from './useTranscodeConfigFormOptions.ts';

function Harness({
  preset,
  onSave,
}: {
  preset: string | null;
  onSave: (preset: string | null) => void;
}) {
  const initialConfig: TranscodeConfig = {
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
    videoPreset: preset,
    videoProfile: '',
    disableHardwareDecoder: false,
    disableHardwareEncoding: false,
    disableHardwareFilters: false,
    audioLoudnormConfig: null,
  };
  const form = useAppForm({
    ...useBaseTranscodeConfigFormOptions(initialConfig),
    onSubmit: ({ value }) => onSave(value.videoPreset),
  });
  return (
    <form.AppForm>
      <TranscodeConfigVideoSettingsForm initialConfig={initialConfig} />
      <button onClick={() => void form.handleSubmit()}>Save</button>
    </form.AppForm>
  );
}

describe('software video presets', () => {
  test.each(['slow', 'slower', 'veryslow'])(
    'displays and preserves a saved %s preset',
    async (preset) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity } },
      });
      queryClient.setQueryData(getApiFfmpegInfoQueryKey(), {
        hardwareAccelerationTypes: [],
      });
      const onSave = vi.fn();
      const { user } = renderWithProviders(
        <Harness preset={preset} onSave={onSave} />,
        { queryClient },
      );
      expect(
        screen.getByRole('combobox', { name: 'Video Preset' }),
      ).toHaveTextContent(preset);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(preset));
    },
  );
});
