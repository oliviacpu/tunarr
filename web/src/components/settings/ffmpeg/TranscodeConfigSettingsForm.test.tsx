import { setShowAdvancedSettings } from '@/store/settings/actions.ts';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { TranscodeConfig } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiFfmpegInfoQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../../generated/sdk.gen.ts';
import type { GetApiFfmpegInfoResponse } from '../../../generated/types.gen.ts';
import type UnsavedNavigationAlert from '../UnsavedNavigationAlert.tsx';
import { TranscodeConfigSettingsForm } from './TranscodeConfigSettingsForm.tsx';

type GuardProps = ComponentProps<typeof UnsavedNavigationAlert>;

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

const createdId = '0f5b6a43-6f43-4a39-9d8b-3f1f2b0d7c11';

const { mockPost, mockPut, guardProps } = vi.hoisted(() => ({
  mockPost: vi.fn(
    (options: { body: Record<string, unknown> }): Promise<unknown> =>
      Promise.resolve({ data: { ...options.body, id: createdId } }),
  ),
  mockPut: vi.fn(
    (options: {
      path: { id: string };
      body: Record<string, unknown>;
    }): Promise<unknown> => Promise.resolve({ data: options.body }),
  ),
  // The guard blocks navigation through the router; record what the form
  // tells it instead
  guardProps: vi.fn((_props: GuardProps) => null),
}));

vi.mock('../../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  postApiTranscodeConfigs: (options: { body: Record<string, unknown> }) =>
    mockPost(options),
  putApiTranscodeConfigsById: (options: {
    path: { id: string };
    body: Record<string, unknown>;
  }) => mockPut(options),
}));

vi.mock('../UnsavedNavigationAlert.tsx', () => ({
  default: guardProps,
}));

function lastGuardProps(): GuardProps {
  const call = guardProps.mock.lastCall;
  if (call === undefined) {
    throw new Error('The unsaved guard was never rendered');
  }
  return call[0];
}

const ffmpegInfo = (
  hardwareAccelerationTypes: string[] = [],
): GetApiFfmpegInfoResponse => ({
  audioEncoders: [],
  videoEncoders: [],
  hardwareAccelerationTypes,
});

function renderForm(
  mode: 'new' | 'edit',
  info: GetApiFfmpegInfoResponse = ffmpegInfo(),
  initialConfig: TranscodeConfig = config,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(getApiFfmpegInfoQueryKey(), info);
  const rootRoute = createRootRoute();
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/ffmpeg/new',
    component: () => (
      <TranscodeConfigSettingsForm initialConfig={initialConfig} isNew />
    ),
  });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/ffmpeg/$configId',
    component: () => (
      <TranscodeConfigSettingsForm initialConfig={initialConfig} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([newRoute, editRoute]),
    history: createMemoryHistory({
      initialEntries: [
        mode === 'new'
          ? '/settings/ffmpeg/new'
          : `/settings/ffmpeg/${config.id}`,
      ],
    }),
  });
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <RouterProvider router={router} />
    </SnackbarProvider>,
    { queryClient },
  );
  return { ...rendered, router };
}

// Opens a select by its label and picks an option
async function pick(
  user: ReturnType<typeof renderForm>['user'],
  label: string,
  option: string,
) {
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  mockPost.mockClear();
  mockPut.mockClear();
  guardProps.mockClear();
});

afterEach(() => {
  setShowAdvancedSettings(false);
});

describe('TranscodeConfigSettingsForm title', () => {
  test('says New when creating a config', async () => {
    renderForm('new');

    expect(
      await screen.findByRole('heading', { name: 'New transcode config' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Edit transcode config/i),
    ).not.toBeInTheDocument();
  });

  test('says Edit and names the config when editing one', async () => {
    renderForm('edit');

    expect(
      await screen.findByRole('heading', {
        name: 'Edit transcode config: "Software"',
      }),
    ).toBeInTheDocument();
  });
});

// The form checks the config with the schema the server uses, so these fail
// if the form validates with anything else
describe('TranscodeConfigSettingsForm validation', () => {
  test('an empty name cannot be saved', async () => {
    const { user } = renderForm('edit');
    const name = await screen.findByLabelText('Name');

    await user.clear(name);

    await waitFor(() =>
      expect(name).toHaveAccessibleDescription('Name cannot be empty'),
    );
    expect(name).toBeInvalid();
    expect(saveButton()).toBeDisabled();
  });

  test('a bitrate that is not a number cannot be saved', async () => {
    const { user } = renderForm('edit');
    const bitrate = await screen.findByLabelText('Video bitrate');

    await user.clear(bitrate);
    await user.type(bitrate, 'fast');

    await waitFor(() => expect(bitrate).toBeInvalid());
    expect(bitrate).toHaveAccessibleDescription(/expected number/);
    expect(saveButton()).toBeDisabled();
  });

  test('a thread count that is not a number cannot be saved', async () => {
    const { user } = renderForm('edit');
    const threads = await screen.findByLabelText('Threads');

    await user.clear(threads);
    await user.type(threads, 'all');

    await waitFor(() => expect(threads).toBeInvalid());
    expect(threads).toHaveAccessibleDescription(/expected number/);
    expect(saveButton()).toBeDisabled();
  });

  test('a cleared thread count saves as 0, which lets FFmpeg decide', async () => {
    const { user } = renderForm('edit', ffmpegInfo(), {
      ...config,
      threadCount: 4,
    });
    const threads = await screen.findByLabelText('Threads');
    expect(threads).toHaveValue('4');

    await user.clear(threads);

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(threads).toBeValid();
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({ threadCount: 0 });
  });

  test('a decimal number is saved as typed', async () => {
    const { user } = renderForm('edit');
    const sampleRate = await screen.findByLabelText('Audio sample rate');

    await user.clear(sampleRate);
    await user.type(sampleRate, '44.1');
    expect(sampleRate).toHaveValue('44.1');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      audioSampleRate: 44.1,
    });
  });

  test('a number followed by text cannot be saved', async () => {
    const { user } = renderForm('edit');
    const bitrate = await screen.findByLabelText('Video bitrate');

    await user.clear(bitrate);
    await user.type(bitrate, '4000k');

    await waitFor(() => expect(bitrate).toBeInvalid());
    expect(bitrate).toHaveValue('4000k');
    expect(bitrate).toHaveAccessibleDescription(/expected number/);
    expect(saveButton()).toBeDisabled();
  });

  test('a loudness target outside -70 to -5 LUFS cannot be saved', async () => {
    setShowAdvancedSettings(true);
    const { user } = renderForm('edit');

    await pick(user, 'Loudness normalization', 'Enabled (loudnorm)');
    const target = await screen.findByLabelText('Loudness target');
    expect(target).toHaveValue('-24');
    await user.clear(target);
    await user.type(target, '-80');

    await waitFor(() => expect(target).toBeInvalid());
    expect(saveButton()).toBeDisabled();

    await user.clear(target);
    await user.type(target, '-23.5');
    await waitFor(() => expect(target).toBeValid());
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    // The schema turned what was typed into a number
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      audioLoudnormConfig: { i: -23.5 },
    });
  });

  test('numbers are saved as numbers', async () => {
    const { user } = renderForm('edit');
    const bitrate = await screen.findByLabelText('Video bitrate');

    await user.clear(bitrate);
    await user.type(bitrate, '4000');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      videoBitRate: 4000,
      threadCount: 0,
    });
  });

  test('a resolution is picked as WxH and saved as its width and height', async () => {
    const { user } = renderForm('edit');

    expect(
      await screen.findByRole('combobox', { name: 'Resolution' }),
    ).toHaveTextContent('1920x1080 (FHD 16:9)');
    await pick(user, 'Resolution', '1280x720 (HD 16:9)');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      resolution: { widthPx: 1280, heightPx: 720 },
    });
  });
});

describe('TranscodeConfigSettingsForm hardware acceleration', () => {
  test('offers only the accelerators FFmpeg has', async () => {
    const { user } = renderForm('edit', ffmpegInfo(['vaapi']));

    await user.click(
      await screen.findByRole('combobox', { name: 'Hardware acceleration' }),
    );
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Software (no GPU)', 'Video Acceleration API (VA-API)']);
  });

  test('shows each option only for the accelerator it applies to', async () => {
    const { user } = renderForm('edit', ffmpegInfo(['cuda', 'vaapi', 'qsv']));
    await screen.findByRole('combobox', { name: 'Hardware acceleration' });

    // Software encoding has a preset and no device
    expect(
      screen.getByRole('combobox', { name: 'Video preset' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Device/)).not.toBeInTheDocument();

    await pick(
      user,
      'Hardware acceleration',
      'Video Acceleration API (VA-API)',
    );
    expect(await screen.findByLabelText('VA-API Device')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Video preset' }),
    ).not.toBeInTheDocument();

    await pick(user, 'Hardware acceleration', 'Intel QuickSync');
    expect(await screen.findByLabelText('QSV Device')).toBeInTheDocument();

    await pick(user, 'Hardware acceleration', 'Nvidia (CUDA)');
    await waitFor(() =>
      expect(screen.queryByLabelText(/Device/)).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('combobox', { name: 'Video preset' }),
    ).not.toBeInTheDocument();
  });

  test('a device path entered for VA-API is saved', async () => {
    const { user } = renderForm('edit', ffmpegInfo(['vaapi']));

    await pick(
      user,
      'Hardware acceleration',
      'Video Acceleration API (VA-API)',
    );
    await user.type(
      await screen.findByLabelText('VA-API Device'),
      '/dev/dri/renderD129',
    );
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      hardwareAccelerationMode: 'vaapi',
      vaapiDevice: '/dev/dri/renderD129',
    });
  });

  test('the hardware switches show with advanced settings and an accelerator', async () => {
    setShowAdvancedSettings(true);
    const { user } = renderForm('edit', ffmpegInfo(['cuda']));
    await screen.findByRole('combobox', { name: 'Hardware acceleration' });

    expect(
      screen.queryByLabelText('Disable hardware decoding'),
    ).not.toBeInTheDocument();

    await pick(user, 'Hardware acceleration', 'Nvidia (CUDA)');
    await user.click(await screen.findByLabelText('Disable hardware decoding'));
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPut.mock.calls[0]?.[0].body).toMatchObject({
      hardwareAccelerationMode: 'cuda',
      disableHardwareDecoder: true,
    });
  });
});

describe('TranscodeConfigSettingsForm saving', () => {
  test('creating a config POSTs it without an id, then opens it', async () => {
    const { user, router } = renderForm('new');
    const name = await screen.findByLabelText('Name');

    await user.clear(name);
    await user.type(name, 'Living room');
    await user.click(saveButton());

    await waitFor(() => expect(mockPost).toHaveBeenCalledOnce());
    expect(mockPut).not.toHaveBeenCalled();
    const body = mockPost.mock.calls[0]?.[0].body;
    expect(body).toMatchObject({ name: 'Living room' });
    expect(body).not.toHaveProperty('id');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/settings/ffmpeg/${createdId}`,
      ),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  test('nothing can change while a create is in flight', async () => {
    let finishCreate: () => void = () => {};
    mockPost.mockImplementationOnce(
      (options) =>
        new Promise((resolve) => {
          finishCreate = () =>
            resolve({ data: { ...options.body, id: createdId } });
        }),
    );
    const { user, router } = renderForm('new');
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Living room');
    await user.click(saveButton());

    await waitFor(() => expect(mockPost).toHaveBeenCalledOnce());
    const fields = screen.getByRole('group');
    expect(fields).toHaveAttribute('aria-busy', 'true');
    // inert also covers the selects, which are not native controls
    expect(fields).toHaveAttribute('inert');
    expect(name).toBeDisabled();
    expect(screen.getByLabelText('Video bitrate')).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Disable watermarks' }),
    ).toBeDisabled();

    finishCreate();

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/settings/ffmpeg/${createdId}`,
      ),
    );
    expect(await screen.findByLabelText('Name')).toBeEnabled();
    expect(screen.getByRole('group')).not.toHaveAttribute('inert');
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'false');
  });

  test('fields stay editable while an update is in flight', async () => {
    let finishUpdate: () => void = () => {};
    mockPut.mockImplementationOnce(
      (options) =>
        new Promise((resolve) => {
          finishUpdate = () => resolve({ data: options.body });
        }),
    );
    const { user } = renderForm('edit');
    const name = await screen.findByLabelText('Name');
    await user.type(name, ' 2');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(name).toBeEnabled();
    expect(screen.getByRole('group')).not.toHaveAttribute('inert');

    finishUpdate();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  test('saving an existing config PUTs it to its id', async () => {
    const { user, router } = renderForm('edit');
    const name = await screen.findByLabelText('Name');

    await user.type(name, ' 2');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPut.mock.calls[0]?.[0]).toMatchObject({
      path: { id: config.id },
      body: { id: config.id, name: 'Software 2' },
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/settings/ffmpeg/${config.id}`,
    );
    // What was saved is what the form now compares against
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });
});

describe('TranscodeConfigSettingsForm unsaved guard', () => {
  test('follows whether the form has changes', async () => {
    const { user } = renderForm('edit');
    const name = await screen.findByLabelText('Name');

    expect(lastGuardProps().isDirty).toBe(false);

    await user.type(name, ' 2');
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(false));
    expect(name).toHaveValue('Software');

    await user.click(
      screen.getByRole('checkbox', { name: 'Disable watermarks' }),
    );
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(true));
    await user.click(saveButton());
    await waitFor(() => expect(mockPut).toHaveBeenCalledOnce());
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(false));
  });
});
