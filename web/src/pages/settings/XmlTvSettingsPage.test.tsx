import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { XmlTvSettings } from '@tunarr/types';
import { defaultXmlTvSettings } from '@tunarr/types';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as Generated from '../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../generated/sdk.gen.ts';
import XmlTvSettingsPage from './XmlTvSettingsPage.tsx';

const saved: XmlTvSettings = {
  ...defaultXmlTvSettings,
  programmingHours: 12,
  refreshHours: 4,
  outputPath: '/data/xmltv.xml',
};

// What the server has; a test can change it before the page loads
const { server, mockPutXmlTvSettings } = vi.hoisted(() => ({
  server: { settings: null as XmlTvSettings | null },
  mockPutXmlTvSettings: vi.fn(
    (_options: { body: Partial<XmlTvSettings> }): Promise<unknown> =>
      Promise.resolve({ data: {} }),
  ),
}));

vi.mock(
  '../../generated/@tanstack/react-query.gen.ts',
  async (importOriginal) => ({
    ...(await importOriginal<typeof Generated>()),
    getApiXmltvSettingsOptions: () => ({
      queryKey: ['test-xmltv-settings'],
      queryFn: () => Promise.resolve(server.settings),
    }),
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiXmltvSettings: (options: { body: Partial<XmlTvSettings> }) =>
    mockPutXmlTvSettings(options),
}));

// It blocks navigation through the router, which these tests don't have
vi.mock('../../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

// The start of the message on the refresh interval when the guide can't last it
const TooShort = 'The guide would run out before the next rebuild';
const tooShortFor = (minimum: number) =>
  `${TooShort}. Set Guide length to ${minimum} hours or more, two hours longer than the interval.`;

async function renderPage(refreshHours = '4') {
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Suspense fallback={null}>
        <XmlTvSettingsPage />
      </Suspense>
    </SnackbarProvider>,
  );
  // The saved settings are in the form
  await waitFor(() =>
    expect(screen.getByLabelText('Refresh interval (hours)')).toHaveValue(
      refreshHours,
    ),
  );
  const { user } = rendered;
  const setField = async (label: string, value: string) => {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    if (value !== '') {
      await user.type(field, value);
    }
    await user.tab();
  };
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  // Its helper text, which starts with its error, is its accessible
  // description
  const refreshTimer = () => screen.getByLabelText('Refresh interval (hours)');
  return { ...rendered, setField, saveButton, refreshTimer };
}

describe('XmlTvSettingsPage', () => {
  beforeEach(() => {
    server.settings = saved;
    mockPutXmlTvSettings.mockReset();
    mockPutXmlTvSettings.mockResolvedValue({ data: saved });
  });

  test('a refresh timer the guide is too short for is flagged and cannot be saved', async () => {
    const { setField, saveButton, refreshTimer } = await renderPage();

    // A 12-hour guide lasts an 11-hour timer, not a 12-hour one
    await setField('Refresh interval (hours)', '12');

    await waitFor(() =>
      expect(refreshTimer()).toHaveAccessibleDescription(
        expect.stringContaining(tooShortFor(14)),
      ),
    );
    expect(refreshTimer()).toBeInvalid();
    expect(saveButton()).toBeDisabled();
  });

  test('settings saved with a guide too short for the timer say so when the page opens', async () => {
    server.settings = { ...saved, refreshHours: 24 };
    const { saveButton, refreshTimer } = await renderPage('24');

    await waitFor(() =>
      expect(refreshTimer()).toHaveAccessibleDescription(
        expect.stringContaining(tooShortFor(26)),
      ),
    );
    expect(saveButton()).toBeDisabled();
  });

  test('a longer guide clears it, and both are saved', async () => {
    const { user, setField, saveButton, refreshTimer } = await renderPage();
    await setField('Refresh interval (hours)', '12');
    await waitFor(() => expect(refreshTimer()).toBeInvalid());

    await setField('Guide length (hours)', '14');

    await waitFor(() => expect(refreshTimer()).toBeValid());
    expect(refreshTimer()).not.toHaveAccessibleDescription(
      expect.stringContaining(TooShort),
    );
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(mockPutXmlTvSettings).toHaveBeenCalledOnce());
    expect(mockPutXmlTvSettings.mock.calls[0]?.[0].body).toMatchObject({
      programmingHours: 14,
      refreshHours: 12,
    });
  });

  test('a guide two hours longer than the timer is fine', async () => {
    const { setField, saveButton, refreshTimer } = await renderPage();

    await setField('Refresh interval (hours)', '10');

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(refreshTimer()).toBeValid();
  });

  test('an empty guide is not compared with the timer', async () => {
    const { setField, refreshTimer } = await renderPage();
    await setField('Refresh interval (hours)', '12');
    await waitFor(() => expect(refreshTimer()).toBeInvalid());

    await setField('Guide length (hours)', '');

    await waitFor(() => expect(refreshTimer()).toBeValid());
    expect(refreshTimer()).not.toHaveAccessibleDescription(
      expect.stringContaining(TooShort),
    );
  });

  test('a refresh timer that is not a number is still flagged as one', async () => {
    const { setField, saveButton, refreshTimer } = await renderPage();

    await setField('Refresh interval (hours)', 'abc');

    await waitFor(() =>
      expect(refreshTimer()).toHaveAccessibleDescription(
        expect.stringContaining('Refresh interval (hours) should be numeric.'),
      ),
    );
    expect(saveButton()).toBeDisabled();
  });

  test('the output path help points clients at the guide URL', async () => {
    await renderPage();

    expect(
      screen.getByLabelText('XMLTV output path'),
    ).toHaveAccessibleDescription(
      expect.stringContaining('/api/xmltv.xml, not from this file.'),
    );
  });

  test("a save the server refuses shows the server's reason", async () => {
    mockPutXmlTvSettings.mockRejectedValue(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
        data: { message: 'The refresh timer is too long.' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    const { user, setField, saveButton } = await renderPage();

    await setField('Refresh interval (hours)', '6');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(
      await screen.findByText(
        'Error saving XMLTV settings. The refresh timer is too long.',
      ),
    ).toBeInTheDocument();
  });
});
