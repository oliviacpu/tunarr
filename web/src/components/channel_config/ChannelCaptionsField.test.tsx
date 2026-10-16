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

const { mockPutFfmpegSettings } = vi.hoisted(() => ({
  mockPutFfmpegSettings: vi.fn((_options: unknown) => Promise.resolve({})),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiFfmpegSettingsOptions: () => ({
      queryKey: ['test-ffmpeg-settings'],
      queryFn: () => Promise.resolve(globalSettings),
    }),
    putApiFfmpegSettingsMutation: () => ({
      mutationFn: (options: unknown) => mockPutFfmpegSettings(options),
    }),
  }),
);

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
  await screen.findByText('Captions for this channel');
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
    mockPutFfmpegSettings.mockClear();
  });

  test('a channel without its own settings saves none', async () => {
    const { save } = await renderField(null);

    expect(screen.queryByLabelText('Text color')).not.toBeInTheDocument();
    expect(await save()).toBeNull();
  });

  test('its own look starts from the global look', async () => {
    const { user, save } = await renderField(null);

    await user.click(screen.getByLabelText('Use own caption look'));

    expect(await save()).toEqual({
      alignment: 'centeredLines',
      appearance: globalSettings.hdhrCaptionAppearance,
    });
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

    expect(await save()).toEqual({
      alignment: 'centeredLines',
      appearance: { ...globalSettings.hdhrCaptionAppearance, textColor: 'red' },
    });
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
    expect(mockPutFfmpegSettings.mock.calls[0]?.[0]).toEqual({
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
});
