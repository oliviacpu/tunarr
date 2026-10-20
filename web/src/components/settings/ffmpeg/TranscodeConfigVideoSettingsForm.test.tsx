import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { QueryClient } from '@tanstack/react-query';
import type { TranscodeConfig } from '@tunarr/types';
import { TranscodeConfigSchema } from '@tunarr/types/schemas';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, test, vi } from 'vitest';
import { getApiFfmpegInfoQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
import { TranscodeConfigVideoSettingsForm } from './TranscodeConfigVideoSettingsForm.tsx';
import type { TranscodeConfigFormValues } from './useTranscodeConfigForm.ts';

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
  const form = useForm<TranscodeConfigFormValues, unknown, TranscodeConfig>({
    resolver: zodResolver(TranscodeConfigSchema),
    defaultValues: initialConfig,
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((value) => onSave(value.videoPreset))}>
        <TranscodeConfigVideoSettingsForm />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
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
        screen.getByRole('combobox', { name: 'Video preset' }),
      ).toHaveTextContent(preset);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(preset));
    },
  );

  test.each([null, '', 'placebo'])(
    'shows veryfast for a saved %j preset and keeps it',
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
        screen.getByRole('combobox', { name: 'Video preset' }),
      ).toHaveTextContent('veryfast (default)');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(preset));
    },
  );
});
