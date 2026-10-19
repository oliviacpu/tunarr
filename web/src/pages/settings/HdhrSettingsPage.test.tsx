import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { HdhrSettings } from '@tunarr/types';
import { defaultHdhrSettings } from '@tunarr/types';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Sdk from '../../generated/sdk.gen.ts';
import HdhrSettingsPage from './HdhrSettingsPage.tsx';

const saved: HdhrSettings = {
  ...defaultHdhrSettings,
  tunerCount: 2,
};

const { mockPutHdhrSettings } = vi.hoisted(() => ({
  mockPutHdhrSettings: vi.fn(
    (_options: { body: Partial<HdhrSettings> }): Promise<unknown> =>
      Promise.resolve({ data: {} }),
  ),
}));

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  getApiHdhrSettings: () => Promise.resolve({ data: saved }),
  putApiHdhrSettings: (options: { body: Partial<HdhrSettings> }) =>
    mockPutHdhrSettings(options),
}));

// It blocks navigation through the router, which these tests don't have
vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

// Changes the tuner count and saves it
async function renderAndSave() {
  const { user } = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <HdhrSettingsPage />
      </Suspense>
    </SnackbarProvider>,
  );
  const tunerCount = await screen.findByLabelText('Tuner Count');
  await waitFor(() => expect(tunerCount).toHaveValue('2'));

  await user.clear(tunerCount);
  await user.type(tunerCount, '4');
  await user.tab();
  const save = screen.getByRole('button', { name: 'Save' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  await waitFor(() => expect(mockPutHdhrSettings).toHaveBeenCalledOnce());
}

describe('HdhrSettingsPage', () => {
  beforeEach(() => {
    mockPutHdhrSettings.mockReset();
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
