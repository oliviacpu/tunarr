import { act, renderWithProviders, screen, waitFor } from '@/test/utils';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import type {
  GetApiSystemFeatureFlagsResponse,
  PutApiSystemFeatureFlagsData,
} from '../../generated/types.gen.ts';
import FeaturesSettingsPage from './FeaturesSettingsPage.tsx';
import { i18n } from '@lingui/core';
import { FeatureFlagMetadata } from '@tunarr/types';
import { featureFlagMessages } from './featureFlagMessages.ts';

type Flags = GetApiSystemFeatureFlagsResponse['flags'];
type FlagsBody = NonNullable<PutApiSystemFeatureFlagsData['body']>;

const savedFlags: Flags = {
  proxyArtwork: true,
  tonemapEnabled: false,
  webvttSidecarEnabled: false,
  xmltvCreditImagesEnabled: false,
  disableSearchSnapshotInBackup: false,
  disableVulkan: false,
  disableVaapiPad: false,
};

const metadata: GetApiSystemFeatureFlagsResponse['metadata'] =
  FeatureFlagMetadata.map((meta) => ({
    ...meta,
    envOverride: meta.key === 'proxyArtwork',
  }));

// What the server has; a save changes it as the server would
const { server, mockPutFlags } = vi.hoisted(() => ({
  server: { flags: null as Flags | null },
  mockPutFlags: vi.fn(),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiSystemFeatureFlagsOptions: () => ({
      queryKey: ['test-feature-flags'],
      queryFn: () => Promise.resolve({ flags: server.flags, metadata }),
    }),
    getApiSystemFeatureFlagsQueryKey: () => ['test-feature-flags'],
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSystemFeatureFlags: (options: { body: FlagsBody }) =>
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
  afterEach(() => {
    act(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));
  });

  test('web descriptors preserve every shared English flag name and description', () => {
    expect(Object.keys(featureFlagMessages).sort()).toEqual(
      FeatureFlagMetadata.map((meta) => meta.key).sort(),
    );
    for (const meta of FeatureFlagMetadata) {
      expect(i18n._(featureFlagMessages[meta.key].displayName)).toBe(
        meta.displayName,
      );
      expect(i18n._(featureFlagMessages[meta.key].description)).toBe(
        meta.description,
      );
    }
  });

  test.each([
    ['proxyArtwork', 'experimental'],
    ['tonemapEnabled', 'playback'],
    ['webvttSidecarEnabled', 'captions-audio'],
    ['xmltvCreditImagesEnabled', 'experimental'],
    ['disableSearchSnapshotInBackup', 'experimental'],
    ['disableVulkan', 'playback'],
    ['disableVaapiPad', 'playback'],
  ] as const)(
    'renders translated %s copy in its settings group',
    async (key, group) => {
      const messages = featureFlagMessages[key];
      i18n.loadAndActivate({
        locale: 'es',
        messages: {
          [messages.displayName.id]: `Nombre traducido ${key}`,
          [messages.description.id]: `Descripción traducida ${key}`,
        },
      });
      renderWithProviders(
        <SnackbarProvider>
          <FeaturesSettingsPage group={group} />
        </SnackbarProvider>,
      );
      expect(
        await screen.findByRole('checkbox', {
          name: `Nombre traducido ${key}`,
        }),
      ).toHaveAccessibleDescription(`Descripción traducida ${key}`);
    },
  );

  beforeEach(() => {
    server.flags = savedFlags;
    mockPutFlags.mockReset();
    mockPutFlags.mockImplementation((options: { body: FlagsBody }) => {
      server.flags = { ...savedFlags, ...options.body };
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
      'Enable embedding images of people in the xmltv credit elements. (must regenerate xmltv to take effect)',
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPutFlags).toHaveBeenCalledOnce());
    expect(mockPutFlags.mock.calls[0]?.[0]).toMatchObject({
      body: { ...savedFlags, disableVulkan: true },
    });
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

  test('a switched flag is saved with the others, and the saved form is clean', async () => {
    const { user, flag, saveButton } = await renderPage();
    expect(saveButton()).toBeDisabled();

    await user.click(flag('XMLTV Credit Images'));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutFlags).toHaveBeenCalledOnce());
    expect(mockPutFlags.mock.calls[0]?.[0]).toMatchObject({
      body: { ...savedFlags, xmltvCreditImagesEnabled: true },
    });
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
