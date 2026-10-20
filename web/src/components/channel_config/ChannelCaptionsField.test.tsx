import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type {
  ChannelCaptions,
  FfmpegSettings,
  SaveableChannel,
} from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import { ChannelCaptionsField } from './ChannelCaptionsField.tsx';

// The global settings: a look that differs from the defaults, so a channel
// seeded from it shows it came from here
const globalSettings: FfmpegSettings = {
  ...defaultFfmpegSettings,
  hdhrCaptionAlignment: 'centeredLines',
  hdhrCaptionAppearance: {
    ...defaultFfmpegSettings.hdhrCaptionAppearance,
    textColor: 'yellow',
    maxLines: 3,
  },
};

// What the server has: the global settings, changed by a test to stand for a
// change made elsewhere after the page loaded
const { server, mockPutFfmpegSettings } = vi.hoisted(() => ({
  server: { settings: null as FfmpegSettings | null },
  mockPutFfmpegSettings: vi.fn((_options: { body: FfmpegSettings }) =>
    Promise.resolve({ data: {} }),
  ),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiSettingsFfmpegOptions: () => ({
      queryKey: ['test-ffmpeg-settings'],
      queryFn: () => Promise.resolve(server.settings),
    }),
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSettingsFfmpeg: (options: { body: FfmpegSettings }) =>
    mockPutFfmpegSettings(options),
}));

function Harness({
  captions,
  onValid,
}: {
  captions: ChannelCaptions | null;
  onValid: (data: Partial<SaveableChannel>) => void;
}): ReactNode {
  const form = useForm<SaveableChannel>({
    defaultValues: { captions } as SaveableChannel,
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onValid)}>
        <ChannelCaptionsField />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

async function renderField(captions: ChannelCaptions | null) {
  const onValid = vi.fn();
  const rendered = renderWithProviders(
    <Harness captions={captions} onValid={onValid} />,
  );
  // Shown once the global settings have loaded
  await screen.findByText('Captions for this channel', {}, { timeout: 5_000 });
  const save = async () => {
    await rendered.user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onValid).toHaveBeenCalledOnce());
    const data = onValid.mock.calls[0]?.[0] as Partial<SaveableChannel>;
    return data.captions;
  };
  return { ...rendered, save };
}

describe('ChannelCaptionsField', () => {
  beforeEach(() => {
    server.settings = globalSettings;
    mockPutFfmpegSettings.mockClear();
  });

  test('a channel without its own settings saves none', async () => {
    const { save } = await renderField(null);

    expect(screen.queryByLabelText('Text color')).not.toBeInTheDocument();
    expect(await save()).toBeNull();
  });

  test('its own look shows the global look and saves nothing until a setting changes', async () => {
    const { user, save } = await renderField(null);

    await user.click(screen.getByLabelText('Use own caption look'));

    expect(
      screen.getByRole('combobox', { name: 'Text color' }),
    ).toHaveTextContent('Yellow');
    expect(await save()).toBeNull();
  });

  test('shows and saves a changed setting', async () => {
    const { user, save } = await renderField({
      appearance: { textColor: 'magenta' },
    });

    expect(
      screen.getByRole('combobox', { name: 'Text color' }),
    ).toHaveTextContent('Magenta');
    await user.click(screen.getByRole('combobox', { name: 'Text color' }));
    await user.click(screen.getByRole('option', { name: 'Red' }));

    expect(await save()).toEqual({ appearance: { textColor: 'red' } });
  });

  test('saves only the settings changed; the rest keep following the global look', async () => {
    const { user, save } = await renderField({
      appearance: { textColor: 'magenta' },
    });

    await user.click(
      screen.getByRole('combobox', { name: 'Lines per caption' }),
    );
    await user.click(screen.getByRole('option', { name: '4' }));
    await user.click(
      screen.getByRole('combobox', { name: 'Caption alignment' }),
    );
    await user.click(screen.getByRole('option', { name: 'Left' }));

    expect(await save()).toEqual({
      alignment: 'left',
      appearance: { textColor: 'magenta', maxLines: 4 },
    });
  });

  test('turning its own look off drops it and keeps the test pattern', async () => {
    const { user, save } = await renderField({
      testPattern: true,
      appearance: { textColor: 'magenta' },
    });

    await user.click(screen.getByLabelText('Use own caption look'));

    // The fields close once the collapse's transition ends
    await waitFor(() =>
      expect(screen.queryByLabelText('Text color')).not.toBeInTheDocument(),
    );
    expect(await save()).toEqual({ testPattern: true });
  });

  test('the test pattern alone leaves the look global', async () => {
    const { user, save } = await renderField(null);

    await user.click(screen.getByLabelText('Test pattern on this channel'));

    expect(screen.queryByLabelText('Text color')).not.toBeInTheDocument();
    expect(await save()).toEqual({ testPattern: true });
  });

  test('reset to global drops the look and keeps the test pattern', async () => {
    const { user, save } = await renderField({
      testPattern: true,
      alignment: 'left',
      appearance: { textColor: 'magenta' },
    });

    await user.click(screen.getByRole('button', { name: 'Reset to global' }));

    expect(await save()).toEqual({ testPattern: true });
  });

  test('reset to global with no test pattern saves none', async () => {
    const { user, save } = await renderField({ alignment: 'left' });

    await user.click(screen.getByRole('button', { name: 'Reset to global' }));

    expect(await save()).toBeNull();
  });

  test("copy to all channels makes the channel's look the global one", async () => {
    const { user } = await renderField({
      alignment: 'left',
      appearance: { textColor: 'magenta' },
    });

    await user.click(
      screen.getByRole('button', { name: 'Copy to all channels' }),
    );
    expect(mockPutFfmpegSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(mockPutFfmpegSettings).toHaveBeenCalledOnce());
    expect(mockPutFfmpegSettings.mock.calls[0]?.[0]).toMatchObject({
      body: {
        ...globalSettings,
        hdhrCaptionAlignment: 'left',
        hdhrCaptionAppearance: {
          ...globalSettings.hdhrCaptionAppearance,
          textColor: 'magenta',
        },
      },
    });
  });

  test('copy to all channels keeps settings changed since the page loaded', async () => {
    const { user } = await renderField({
      appearance: { textColor: 'magenta' },
    });
    // Changed elsewhere (the FFmpeg settings page in another tab) after this
    // page loaded the settings: another setting, and caption settings the
    // channel doesn't set itself
    server.settings = {
      ...globalSettings,
      enableSubtitleExtraction: true,
      hdhrCaptionAlignment: 'left',
      hdhrCaptionAppearance: {
        ...globalSettings.hdhrCaptionAppearance,
        maxLines: 4,
      },
    };

    await user.click(
      screen.getByRole('button', { name: 'Copy to all channels' }),
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(mockPutFfmpegSettings).toHaveBeenCalledOnce());
    expect(mockPutFfmpegSettings.mock.calls[0]?.[0]).toMatchObject({
      body: { enableSubtitleExtraction: true, hdhrCaptionAlignment: 'left' },
    });
    expect(
      mockPutFfmpegSettings.mock.calls[0]?.[0]?.body.hdhrCaptionAppearance,
    ).toEqual({
      ...globalSettings.hdhrCaptionAppearance,
      maxLines: 4,
      textColor: 'magenta',
    });
  });
});
