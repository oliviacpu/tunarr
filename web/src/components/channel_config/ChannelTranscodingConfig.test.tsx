import { renderWithProviders, screen } from '@/test/utils';
import type { SaveableChannel } from '@tunarr/types';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, test, vi } from 'vitest';
import ChannelTranscodingConfig from './ChannelTranscodingConfig.tsx';

vi.mock('../../hooks/settingsHooks.ts', () => ({
  useTranscodeConfigs: () => ({ data: [] }),
}));
vi.mock('../../store/index.ts', () => ({ default: () => ({ id: 'channel' }) }));
vi.mock('../base/RouterLink.tsx', () => ({
  RouterLink: () => <span>Settings › Playback</span>,
}));
vi.mock('./ChannelCaptionsField.tsx', () => ({
  ChannelCaptionsField: () => null,
}));
vi.mock('./ChannelSubtitlePreferencesField.tsx', () => ({
  ChannelSubtitlePreferencesField: () => <p>Subtitle inheritance controls</p>,
}));
vi.mock('./ChannelAudioTracksField.tsx', () => ({
  ChannelAudioTracksField: ({ disabled }: { disabled: boolean }) => (
    <input aria-label="Audio tracks" disabled={disabled} />
  ),
}));

function Harness({
  streamMode,
  subtitlesEnabled,
}: Pick<SaveableChannel, 'streamMode' | 'subtitlesEnabled'>) {
  const form = useForm<SaveableChannel>({
    defaultValues: { streamMode, subtitlesEnabled, transcodeConfigId: '' },
  });
  return (
    <FormProvider {...form}>
      <ChannelTranscodingConfig />
    </FormProvider>
  );
}

test('describes the channel audio layout accurately and keeps inheritance accessible with subtitles off', () => {
  renderWithProviders(<Harness streamMode="hls" subtitlesEnabled={false} />);
  expect(
    screen.getByText(
      /Choose a fixed audio output layout and subtitle preferences/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Subtitle inheritance controls')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Audio tracks' })).toBeEnabled();
  expect(
    screen.getByRole('checkbox', { name: 'Enable subtitles' }),
  ).not.toBeChecked();
});

test('HLS Direct v2 retains the existing audio layout capability gate', () => {
  renderWithProviders(<Harness streamMode="hls_direct_v2" subtitlesEnabled />);
  expect(screen.getByRole('textbox', { name: 'Audio tracks' })).toBeDisabled();
  expect(screen.getByText('Subtitle inheritance controls')).toBeVisible();
});
