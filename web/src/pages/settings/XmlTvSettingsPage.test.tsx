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
    getApiSettingsXmltvOptions: () => ({
      // Tagged like the generated key, so a save refetches it
      queryKey: [{ _id: 'test-xmltv-settings', tags: ['Settings'] }],
      queryFn: () => Promise.resolve(server.settings),
    }),
  }),
);

vi.mock('../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSettingsXmltv: (options: { body: Partial<XmlTvSettings> }) =>
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
  await waitFor(
    () =>
      expect(screen.getByLabelText('Refresh interval (hours)')).toHaveValue(
        refreshHours,
      ),
    { timeout: 5_000 },
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

  test('settings saved with a guide too short for the timer still cannot be saved after another change', async () => {
    server.settings = { ...saved, refreshHours: 24 };
    const { user, saveButton, refreshTimer } = await renderPage('24');
    await waitFor(() => expect(refreshTimer()).toBeInvalid());

    await user.click(screen.getByRole('checkbox', { name: 'Use show poster' }));

    await screen.findByRole('button', { name: 'Reset changes' });
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

  test('Restore defaults is not offered while the settings are the defaults', async () => {
    await renderPage();

    expect(
      screen.queryByRole('button', { name: 'Restore defaults' }),
    ).not.toBeInTheDocument();
  });

  test('Restore defaults fills in the defaults, keeps the output path, and can be undone', async () => {
    server.settings = {
      ...saved,
      refreshHours: 6,
      refreshStartHour: 3,
      publicUrl: 'https://tv.example.com',
    };
    const { user, saveButton, refreshTimer } = await renderPage('6');
    const startHour = () =>
      screen.getByRole('combobox', { name: 'Refreshes start at' });
    expect(startHour()).toHaveTextContent('03:00');

    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(refreshTimer()).toHaveValue('4');
    expect(startHour()).toHaveTextContent('00:00');
    expect(
      screen.getByLabelText('Public address for guide pictures'),
    ).toHaveValue('');
    expect(screen.getByLabelText('XMLTV output path')).toHaveValue(
      '/data/xmltv.xml',
    );
    expect(
      screen.queryByRole('button', { name: 'Restore defaults' }),
    ).not.toBeInTheDocument();
    // Nothing is saved yet, so it is a change like any other
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Reset changes' }));

    expect(refreshTimer()).toHaveValue('6');
    expect(startHour()).toHaveTextContent('03:00');
    expect(
      screen.getByRole('button', { name: 'Restore defaults' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(mockPutXmlTvSettings).not.toHaveBeenCalled();
  });

  test('restored defaults are saved with Save', async () => {
    server.settings = { ...saved, refreshHours: 6, refreshStartHour: 3 };
    const { user, saveButton } = await renderPage('6');

    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutXmlTvSettings).toHaveBeenCalledOnce());
    expect(mockPutXmlTvSettings.mock.calls[0]?.[0].body).toEqual({
      ...defaultXmlTvSettings,
      outputPath: '/data/xmltv.xml',
    });
  });

  test('the refresh start hour is saved as a number, and the saved form is clean', async () => {
    // The server keeps what it is sent
    mockPutXmlTvSettings.mockImplementation(({ body }) => {
      server.settings = { ...saved, ...body };
      return Promise.resolve({ data: server.settings });
    });
    const { user, saveButton } = await renderPage();

    await user.click(
      screen.getByRole('combobox', { name: 'Refreshes start at' }),
    );
    await user.click(await screen.findByRole('option', { name: '05:00' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutXmlTvSettings).toHaveBeenCalledOnce());
    expect(mockPutXmlTvSettings.mock.calls[0]?.[0].body.refreshStartHour).toBe(
      5,
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(
      screen.getByRole('combobox', { name: 'Refreshes start at' }),
    ).toHaveTextContent('05:00');
    expect(
      screen.queryByRole('button', { name: 'Reset changes' }),
    ).not.toBeInTheDocument();
  });

  test('Save cannot be pressed again while a save is in flight', async () => {
    // The server never answers
    mockPutXmlTvSettings.mockReturnValue(new Promise(() => {}));
    const { user, setField, saveButton } = await renderPage();

    await setField('Refresh interval (hours)', '6');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    expect(mockPutXmlTvSettings).toHaveBeenCalledOnce();
  });

  test('a field changed while a save is in flight survives the save and the reload after it', async () => {
    let answer: () => void = () => {};
    mockPutXmlTvSettings.mockImplementation(
      ({ body }) =>
        new Promise((resolve) => {
          answer = () => {
            server.settings = { ...saved, ...body };
            resolve({ data: server.settings });
          };
        }),
    );
    const { user, setField, saveButton, refreshTimer } = await renderPage();
    await setField('Refresh interval (hours)', '6');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(mockPutXmlTvSettings).toHaveBeenCalledOnce());

    await setField('Public address for guide pictures', 'https://tv.example');
    answer();

    // Saved, and the page has reloaded the settings
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await waitFor(() =>
      expect(saveButton()).not.toHaveAttribute('aria-busy', 'true'),
    );
    expect(refreshTimer()).toHaveValue('6');
    expect(
      screen.getByLabelText('Public address for guide pictures'),
    ).toHaveValue('https://tv.example');
    expect(
      screen.getByRole('button', { name: 'Reset changes' }),
    ).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
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
        'Could not save settings: The refresh timer is too long.',
      ),
    ).toBeInTheDocument();
  });
});
