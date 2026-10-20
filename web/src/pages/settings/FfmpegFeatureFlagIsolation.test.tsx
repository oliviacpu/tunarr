import {
  renderWithProviders,
  screen,
  waitFor,
  within,
  act,
} from '@/test/utils';
import { defaultFfmpegSettings } from '@tunarr/types';
import { QueryClient } from '@tanstack/react-query';
import {
  getApiSystemFeatureFlagsQueryKey,
  getApiSystemStateQueryKey,
} from '../../generated/@tanstack/react-query.gen.ts';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type { GetApiSystemFeatureFlagsResponse } from '../../generated/types.gen.ts';
import FfmpegSettingsPage from './FfmpegSettingsPage.tsx';

const { flagsRequest, stateRequest } = vi.hoisted(() => ({
  flagsRequest: vi.fn(),
  stateRequest: vi.fn(),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiFfmpegSettings: () => Promise.resolve({ data: defaultFfmpegSettings }),
  getApiSystemState: () => stateRequest(),
  getApiFfmpegInfo: () =>
    Promise.resolve({
      data: {
        audioEncoders: [{ ffmpegName: 'aac', name: 'AAC' }],
        videoEncoders: [{ ffmpegName: 'libx264', name: 'H.264' }],
        hardwareAccelerationTypes: [],
      },
    }),
  getApiSystemFeatureFlags: () => flagsRequest(),
}));

vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: ({ isDirty }: { isDirty: boolean }) => (
    <output data-testid="navigation-guard">{String(isDirty)}</output>
  ),
}));
vi.mock('../../components/settings/ffmpeg/TranscodeConfigsTable.tsx', () => ({
  TranscodeConfigsTable: () => null,
}));

function renderPage(
  section: 'playback' | 'captions-audio',
  queryClient?: QueryClient,
) {
  return renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={<div>Core settings suspended</div>}>
        <FfmpegSettingsPage section={section} />
      </Suspense>
    </SnackbarProvider>,
    { queryClient },
  );
}

const coreField = (section: 'playback' | 'captions-audio') =>
  section === 'playback'
    ? screen.findByLabelText('FFmpeg executable path')
    : screen.findByRole('checkbox', { name: 'Extract embedded subtitles' });

beforeEach(() => {
  flagsRequest.mockReset();
  stateRequest
    .mockReset()
    .mockResolvedValue({ data: { isInContainer: false } });
});

describe('optional feature flag isolation', () => {
  for (const section of ['playback', 'captions-audio'] as const) {
    test(`${section} stays editable while optional flags load`, async () => {
      flagsRequest.mockImplementation(() => new Promise(() => {}));
      renderPage(section);
      expect(await coreField(section)).toBeEnabled();
      expect(
        screen.getByLabelText('Loading optional features'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Core settings suspended'),
      ).not.toBeInTheDocument();
    });

    test(`${section} stays editable when optional flags fail`, async () => {
      flagsRequest.mockRejectedValue(new Error('Flags unavailable'));
      renderPage(section);
      expect(await coreField(section)).toBeEnabled();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Optional feature settings could not be loaded.',
      );
      expect(
        screen.queryByText('Core settings suspended'),
      ).not.toBeInTheDocument();
    });
  }

  test('retrying flags preserves edits in the core settings form', async () => {
    flagsRequest.mockRejectedValueOnce(new Error('Flags unavailable'));
    const { user } = renderPage('playback');
    const path = await screen.findByLabelText('FFmpeg executable path');
    await screen.findByRole('alert');
    await user.clear(path);
    await user.type(path, '/opt/ffmpeg');

    const data: GetApiSystemFeatureFlagsResponse = {
      flags: {
        proxyArtwork: false,
        tonemapEnabled: false,
        webvttSidecarEnabled: false,
        xmltvCreditImagesEnabled: false,
        disableSearchSnapshotInBackup: false,
        disableVulkan: false,
        disableVaapiPad: false,
      },
      metadata: [
        {
          key: 'tonemapEnabled',
          displayName: 'HDR Tonemapping',
          description: 'Enable tonemapping.',
          category: 'experimental',
          envOverride: false,
        },
      ],
    };
    flagsRequest.mockResolvedValue({ data });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('checkbox', { name: 'HDR Tonemapping' }),
    ).toBeEnabled();
    expect(path).toHaveValue('/opt/ffmpeg');
  });
});

describe('captions system state isolation', () => {
  for (const state of ['loading', 'failed'] as const) {
    test(`captions stay editable when unrelated system state is ${state}`, async () => {
      flagsRequest.mockImplementation(() => new Promise(() => {}));
      stateRequest.mockImplementation(() =>
        state === 'loading'
          ? new Promise(() => {})
          : Promise.reject(new Error('System state unavailable')),
      );
      renderPage('captions-audio');
      expect(await coreField('captions-audio')).toBeEnabled();
      expect(stateRequest).not.toHaveBeenCalled();
      expect(
        screen.queryByText('Core settings suspended'),
      ).not.toBeInTheDocument();
    });
  }
});

for (const section of ['playback', 'captions-audio'] as const) {
  test(`${section} shares one navigation guard across both forms`, async () => {
    const flags = {
      proxyArtwork: false,
      tonemapEnabled: false,
      webvttSidecarEnabled: false,
      xmltvCreditImagesEnabled: false,
      disableSearchSnapshotInBackup: false,
      disableVulkan: false,
      disableVaapiPad: false,
    };
    const key =
      section === 'playback' ? 'tonemapEnabled' : 'webvttSidecarEnabled';
    flagsRequest.mockResolvedValue({
      data: {
        flags,
        metadata: [
          {
            key,
            displayName: 'Optional test feature',
            description: 'Optional feature.',
            category: 'experimental',
            envOverride: false,
          },
        ],
      },
    });
    const { user } = renderPage(section);
    const core = await coreField(section);
    const flag = await screen.findByRole('checkbox', {
      name: 'Optional test feature',
    });
    expect(screen.getAllByTestId('navigation-guard')).toHaveLength(1);
    if (section === 'playback') await user.type(core, '-edited');
    else await user.click(core);
    await user.click(flag);
    expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
    const coreForm = core.closest('form');
    const flagForm = flag.closest('form');
    if (coreForm === null || flagForm === null)
      throw new Error('Both settings groups have forms');
    await user.click(
      within(coreForm).getByRole('button', { name: 'Reset changes' }),
    );
    expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
    await user.click(
      within(flagForm).getByRole('button', { name: 'Reset changes' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('navigation-guard')).toHaveTextContent('false'),
    );
  });
}

for (const section of ['playback', 'captions-audio'] as const) {
  test(`${section} preserves unsaved flags and its guard across background failure and retry`, async () => {
    const data: GetApiSystemFeatureFlagsResponse = {
      flags: {
        proxyArtwork: false,
        tonemapEnabled: false,
        webvttSidecarEnabled: false,
        xmltvCreditImagesEnabled: false,
        disableSearchSnapshotInBackup: false,
        disableVulkan: false,
        disableVaapiPad: false,
      },
      metadata: [
        {
          key:
            section === 'playback' ? 'tonemapEnabled' : 'webvttSidecarEnabled',
          displayName: 'Optional test feature',
          description: 'Optional feature.',
          category: 'experimental',
          envOverride: false,
        },
      ],
    };
    flagsRequest.mockResolvedValue({ data });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { user } = renderPage(section, client);
    const flag = await screen.findByRole('checkbox', {
      name: 'Optional test feature',
    });
    await user.click(flag);
    flagsRequest.mockRejectedValue(new Error('Background flags unavailable'));
    await act(async () => {
      await client.refetchQueries({
        queryKey: getApiSystemFeatureFlagsQueryKey(),
      });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your unsaved edits are kept.',
    );
    expect(flag).toBeInTheDocument();
    expect(flag).toBeChecked();
    expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
    flagsRequest.mockResolvedValue({ data });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(flag).toBeChecked();
    expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
  });
}

test('Playback preserves executable-path edits during cached system-state failures and retry', async () => {
  flagsRequest.mockImplementation(() => new Promise(() => {}));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const { user } = renderPage('playback', client);
  const ffmpeg = await screen.findByLabelText('FFmpeg executable path');
  const ffprobe = screen.getByLabelText('FFprobe executable path');
  await user.clear(ffmpeg);
  await user.type(ffmpeg, '/opt/custom-ffmpeg');
  await user.clear(ffprobe);
  await user.type(ffprobe, '/opt/custom-ffprobe');
  stateRequest.mockRejectedValue(
    new Error('Background system state unavailable'),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: getApiSystemStateQueryKey() });
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Using the last loaded environment; your edits are kept.',
  );
  expect(ffmpeg).toBeVisible();
  expect(ffprobe).toBeVisible();
  expect(ffmpeg).toBeEnabled();
  expect(ffprobe).toBeEnabled();
  expect(ffmpeg).toHaveValue('/opt/custom-ffmpeg');
  expect(ffprobe).toHaveValue('/opt/custom-ffprobe');
  expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
  stateRequest.mockResolvedValue({ data: { isInContainer: false } });
  await act(async () => {
    await client.refetchQueries({ queryKey: getApiSystemStateQueryKey() });
  });
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
  expect(ffmpeg).toHaveValue('/opt/custom-ffmpeg');
  expect(ffprobe).toHaveValue('/opt/custom-ffprobe');
  expect(screen.getByTestId('navigation-guard')).toHaveTextContent('true');
});
