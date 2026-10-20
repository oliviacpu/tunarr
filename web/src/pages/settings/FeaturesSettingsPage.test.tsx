import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type {
  GetApiSettingsFeatureFlagsResponse,
  PutApiSettingsFeatureFlagsData,
} from '../../generated/types.gen.ts';
import FeaturesSettingsPage from './FeaturesSettingsPage.tsx';

type Flags = GetApiSettingsFeatureFlagsResponse['flags'];
type FlagsBody = NonNullable<PutApiSettingsFeatureFlagsData['body']>;

const savedFlags: Flags = {
  proxyArtwork: true,
  tonemapEnabled: false,
  webvttSidecarEnabled: false,
  xmltvCreditImagesEnabled: false,
  disableSearchSnapshotInBackup: false,
  disableVulkan: false,
  disableVaapiPad: false,
};

const metadata: GetApiSettingsFeatureFlagsResponse['metadata'] = [
  {
    key: 'proxyArtwork',
    displayName: 'Proxy Artwork',
    description: 'Route artwork requests through the Tunarr server.',
    category: 'experimental',
    // TUNARR_PROXY_ARTWORK is set
    envOverride: true,
  },
  {
    key: 'xmltvCreditImagesEnabled',
    displayName: 'XMLTV Credit Images',
    description: 'Enable embedding images of people in the xmltv credits.',
    category: 'experimental',
    envOverride: false,
  },
  {
    key: 'webvttSidecarEnabled',
    displayName: 'WebVTT Sidecar Subtitles',
    description: 'Enable subtitle sidecars.',
    category: 'experimental',
    envOverride: false,
  },
  {
    key: 'disableVulkan',
    displayName: 'Disable Vulkan (NVIDIA)',
    description: 'Disable Vulkan-based processing.',
    category: 'escape-hatch',
    envOverride: false,
  },
];

// What the server has; a save changes it as the server would
const { server, mockPutFlags } = vi.hoisted(() => ({
  server: { flags: null as Flags | null },
  mockPutFlags: vi.fn(),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiSettingsFeatureFlagsOptions: () => ({
      queryKey: ['test-feature-flags'],
      queryFn: () => Promise.resolve({ flags: server.flags, metadata }),
    }),
    getApiSettingsFeatureFlagsQueryKey: () => ['test-feature-flags'],
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSettingsFeatureFlags: (options: { body: FlagsBody }) =>
    mockPutFlags(options),
}));

// It blocks navigation through the router, which these tests don't have
vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

async function renderPage() {
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <FeaturesSettingsPage />
      </Suspense>
    </SnackbarProvider>,
  );
  const flag = (name: string) => screen.getByRole('checkbox', { name });
  await waitFor(() => expect(flag('Proxy Artwork')).toBeChecked());
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  return { ...rendered, flag, saveButton };
}

describe('FeaturesSettingsPage', () => {
  beforeEach(() => {
    server.flags = savedFlags;
    mockPutFlags.mockReset();
    mockPutFlags.mockImplementation((options: { body: FlagsBody }) => {
      server.flags = { ...(server.flags ?? savedFlags), ...options.body };
      return Promise.resolve({ data: { flags: server.flags, metadata } });
    });
  });

  test('a flag an environment variable sets cannot be switched here', async () => {
    const { flag } = await renderPage();

    expect(flag('Proxy Artwork')).toBeDisabled();
    expect(screen.getByText('Set by environment variable')).toBeInTheDocument();
    expect(flag('XMLTV Credit Images')).toBeEnabled();
    expect(
      screen.queryByRole('checkbox', { name: 'Disable Vulkan (NVIDIA)' }),
    ).not.toBeInTheDocument();
    expect(flag('XMLTV Credit Images')).toHaveAccessibleDescription(
      'Enable embedding images of people in the xmltv credits.',
    );
  });

  test('playback shows its flags and preserves flags from other tabs on save', async () => {
    const { user } = renderWithProviders(
      <SnackbarProvider>
        <Suspense fallback={null}>
          <FeaturesSettingsPage group="playback" />
        </Suspense>
      </SnackbarProvider>,
    );
    const vulkan = await screen.findByRole('checkbox', {
      name: 'Disable Vulkan (NVIDIA)',
    });
    expect(
      screen.queryByRole('checkbox', { name: 'XMLTV Credit Images' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'WebVTT Sidecar Subtitles' }),
    ).not.toBeInTheDocument();
    await user.click(vulkan);
    server.flags = { ...savedFlags, xmltvCreditImagesEnabled: true };
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPutFlags).toHaveBeenCalledOnce());
    expect(mockPutFlags).toHaveBeenCalledWith(
      expect.objectContaining({ body: { disableVulkan: true } }),
    );
    expect(server.flags.xmltvCreditImagesEnabled).toBe(true);
  });

  test('captions shows only its subtitle flag', async () => {
    renderWithProviders(
      <SnackbarProvider>
        <Suspense fallback={null}>
          <FeaturesSettingsPage group="captions-audio" />
        </Suspense>
      </SnackbarProvider>,
    );
    expect(
      await screen.findByRole('checkbox', { name: 'WebVTT Sidecar Subtitles' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'XMLTV Credit Images' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Disable Vulkan (NVIDIA)' }),
    ).not.toBeInTheDocument();
  });

  test('a switched flag is saved with its group, and the saved form is clean', async () => {
    const { user, flag, saveButton } = await renderPage();
    expect(saveButton()).toBeDisabled();

    await user.click(flag('XMLTV Credit Images'));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutFlags).toHaveBeenCalledOnce());
    expect(mockPutFlags).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { proxyArtwork: true, xmltvCreditImagesEnabled: true },
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(flag('XMLTV Credit Images')).toBeChecked();
    expect(
      screen.queryByRole('button', { name: 'Reset changes' }),
    ).not.toBeInTheDocument();
  });

  test('Reset changes puts the saved flags back', async () => {
    const { user, flag, saveButton } = await renderPage();

    await user.click(flag('XMLTV Credit Images'));
    expect(flag('XMLTV Credit Images')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));

    expect(flag('XMLTV Credit Images')).not.toBeChecked();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(mockPutFlags).not.toHaveBeenCalled();
  });
});
