import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { HdhrSettings } from '@tunarr/types';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import HdhrSettingsPage from './HdhrSettingsPage.tsx';

const saved: HdhrSettings = { autoDiscoveryEnabled: true, tunerCount: 4 };

const { mockPutHdhrSettings } = vi.hoisted(() => ({
  mockPutHdhrSettings: vi.fn(
    (_options: { body: Partial<HdhrSettings> }): Promise<unknown> =>
      Promise.resolve({ data: {} }),
  ),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiHdhrSettingsOptions: () => ({
      queryKey: ['test-hdhr-settings'],
      queryFn: () => Promise.resolve(saved),
    }),
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiHdhrSettings: (options: { body: Partial<HdhrSettings> }) =>
    mockPutHdhrSettings(options),
}));

// It blocks navigation through the router, which these tests don't have
vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

async function renderPage() {
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <HdhrSettingsPage />
      </Suspense>
    </SnackbarProvider>,
  );
  // The saved settings are in the form. The first render in a run can take
  // longer than waitFor's default second
  await waitFor(
    () => expect(screen.getByLabelText('Tuner count')).toHaveValue('4'),
    { timeout: 10_000 },
  );
  const { user } = rendered;
  const tunerCount = () => screen.getByLabelText('Tuner count');
  const setTunerCount = async (value: string) => {
    await user.clear(tunerCount());
    await user.type(tunerCount(), value);
    await user.tab();
  };
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  return { ...rendered, tunerCount, setTunerCount, saveButton };
}

// Changes the tuner count to a valid new value and saves it
async function renderAndSave() {
  const { user, setTunerCount, saveButton } = await renderPage();
  await setTunerCount('2');
  await waitFor(() => expect(saveButton()).toBeEnabled());
  await user.click(saveButton());
  await waitFor(() => expect(mockPutHdhrSettings).toHaveBeenCalledOnce());
}

describe('HdhrSettingsPage', () => {
  beforeEach(() => {
    mockPutHdhrSettings.mockReset();
    mockPutHdhrSettings.mockResolvedValue({ data: saved });
  });

  test('a tuner count of 0 is flagged and cannot be saved', async () => {
    const { tunerCount, setTunerCount, saveButton } = await renderPage();

    await setTunerCount('0');

    await waitFor(() =>
      // The help text stays under the message
      expect(tunerCount()).toHaveAccessibleDescription(
        expect.stringMatching(/^Tuner count must be >= 1\s*How many tuners/),
      ),
    );
    expect(tunerCount()).toBeInvalid();
    expect(saveButton()).toBeDisabled();
  });

  test('a single tuner is saved', async () => {
    const { user, tunerCount, setTunerCount, saveButton } = await renderPage();

    await setTunerCount('1');

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(tunerCount()).toBeValid();
    await user.click(saveButton());
    await waitFor(() => expect(mockPutHdhrSettings).toHaveBeenCalledOnce());
    expect(mockPutHdhrSettings.mock.calls[0]?.[0].body).toEqual({
      autoDiscoveryEnabled: true,
      tunerCount: 1,
    });
  });

  test("a save the server refuses shows the server's reason", async () => {
    mockPutHdhrSettings.mockRejectedValue(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
        data: { message: 'Tuner count must be at least 1' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );

    await renderAndSave();

    expect(
      await screen.findByText(
        'Could not save settings. Tuner count must be at least 1',
      ),
    ).toBeInTheDocument();
  });

  test('a save that fails without a reason still says so', async () => {
    mockPutHdhrSettings.mockRejectedValue(new Error('Network Error'));

    await renderAndSave();

    expect(
      await screen.findByText('Could not save settings'),
    ).toBeInTheDocument();
  });
});
