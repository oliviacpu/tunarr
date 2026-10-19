import { getApiFfmpegInfoQueryKey } from '../../generated/@tanstack/react-query.gen.ts';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import type { FfmpegSettings } from '@tunarr/types';
import { defaultFfmpegSettings } from '@tunarr/types';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type { GetApiFfmpegInfoResponse } from '../../generated/types.gen.ts';
import FfmpegSettingsPage from './FfmpegSettingsPage.tsx';

const saved: FfmpegSettings = {
  ...defaultFfmpegSettings,
  ffmpegExecutablePath: '/usr/bin/ffmpeg',
  ffprobeExecutablePath: '/usr/bin/ffprobe',
};

const probed: GetApiFfmpegInfoResponse = {
  audioEncoders: [{ ffmpegName: 'aac', name: 'AAC' }],
  videoEncoders: [{ ffmpegName: 'libx264', name: 'H.264' }],
  hardwareAccelerationTypes: ['cuda', 'vaapi'],
};

// A failed request with the reason the server gave
function serverError(message: string, status = 500) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, null, {
    data: { message },
    status,
    statusText: 'Error',
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

// What the server answers; a test can change it before the page loads
const { server, mockPutFfmpegSettings } = vi.hoisted(() => ({
  server: {
    settings: null as FfmpegSettings | null,
    ffmpegInfo: (): Promise<unknown> => Promise.resolve({ data: null }),
  },
  mockPutFfmpegSettings: vi.fn(
    (_options: { body: Partial<FfmpegSettings> }): Promise<unknown> =>
      Promise.resolve({ data: {} }),
  ),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiFfmpegSettings: () => Promise.resolve({ data: server.settings }),
  getApiSystemState: () =>
    Promise.resolve({
      data: { isDocker: false, isPodman: false, isInContainer: false },
    }),
  getApiFfmpegInfo: () => server.ffmpegInfo(),
  putApiFfmpegSettings: (options: { body: Partial<FfmpegSettings> }) =>
    mockPutFfmpegSettings(options),
}));

// It blocks navigation through the router, which these tests don't have
vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

// It links into the router and loads its own configs; not under test here
vi.mock('../../components/settings/ffmpeg/TranscodeConfigsTable.tsx', () => ({
  TranscodeConfigsTable: () => null,
}));

async function renderPage(queryClient?: QueryClient) {
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <FfmpegSettingsPage />
      </Suspense>
    </SnackbarProvider>,
    { queryClient },
  );
  // The saved settings are in the form. The page renders every language in
  // its preferences list, which can take a few seconds on a busy runner
  await waitFor(
    () =>
      expect(screen.getByLabelText('FFmpeg Executable Path')).toHaveValue(
        '/usr/bin/ffmpeg',
      ),
    { timeout: 10_000 },
  );
  return rendered;
}

describe('FfmpegSettingsPage', () => {
  beforeEach(() => {
    server.settings = saved;
    server.ffmpegInfo = () => Promise.resolve({ data: probed });
    mockPutFfmpegSettings.mockReset();
    mockPutFfmpegSettings.mockResolvedValue({ data: saved });
  });

  test('the form is there while ffmpeg is still being probed', async () => {
    server.ffmpegInfo = () => new Promise(() => {});

    await renderPage();

    expect(screen.getByLabelText('FFmpeg Executable Path')).toBeEnabled();
    expect(screen.getByLabelText('FFprobe Executable Path')).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/FFmpeg is working/)).not.toBeInTheDocument();
  });

  test('a failed probe warns above a path that can still be fixed', async () => {
    server.ffmpegInfo = () =>
      Promise.reject(serverError('spawn /usr/bin/ffmpeg ENOENT'));
    const { user } = await renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'FFmpeg could not be probed. Check that the FFmpeg executable path below points to a working ffmpeg, then save.',
    );
    expect(alert).toHaveTextContent('spawn /usr/bin/ffmpeg ENOENT');

    const path = screen.getByLabelText('FFmpeg Executable Path');
    await user.clear(path);
    await user.type(path, '/opt/ffmpeg/bin/ffmpeg');
    expect(path).toHaveValue('/opt/ffmpeg/bin/ffmpeg');
  });

  test('a probe that finds no encoders warns the same way', async () => {
    server.ffmpegInfo = () =>
      Promise.resolve({
        data: {
          audioEncoders: [],
          videoEncoders: [],
          hardwareAccelerationTypes: [],
        },
      });
    await renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'FFmpeg could not be probed.',
    );
  });

  test('a working ffmpeg shows the hardware acceleration it supports', async () => {
    await renderPage();

    expect(
      await screen.findByText(
        'FFmpeg is working. Hardware acceleration it supports: cuda, vaapi',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test("a save the server refuses shows the server's reason", async () => {
    mockPutFfmpegSettings.mockRejectedValue(
      serverError('FFmpeg executable path does not exist', 400),
    );
    const { user } = await renderPage();

    const path = screen.getByLabelText('FFmpeg Executable Path');
    await user.clear(path);
    await user.type(path, '/nowhere/ffmpeg');
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(
      await screen.findByText(
        'Could not save settings. FFmpeg executable path does not exist',
      ),
    ).toBeInTheDocument();
  });

  test('a re-probe after a save shows the probing state, not the old result', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await renderPage(queryClient);
    expect(await screen.findByText(/FFmpeg is working/)).toBeInTheDocument();

    // The next probe never answers; the cached result is still there
    server.ffmpegInfo = () => new Promise(() => {});
    void queryClient.invalidateQueries({
      queryKey: getApiFfmpegInfoQueryKey(),
    });

    await waitFor(() =>
      expect(screen.queryByText(/FFmpeg is working/)).not.toBeInTheDocument(),
    );
  });
});
