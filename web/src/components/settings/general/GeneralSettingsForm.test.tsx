import useStore from '@/store/index.ts';
import { setBackendUri } from '@/store/settings/actions.ts';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { QueryClient } from '@tanstack/react-query';
import type { SystemSettings } from '@tunarr/types';
import type { UpdateSystemSettingsRequest } from '@tunarr/types/api';
import { SnackbarProvider } from 'notistack';
import type * as ReactHookForm from 'react-hook-form';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiSystemStateQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
import type * as Sdk from '../../../generated/sdk.gen.ts';
import { GeneralSettingsForm } from './GeneralSettingsForm.tsx';

const LoadedBackendUri = 'http://localhost:8000';

// Log rolling with neither a schedule nor a size limit, which is what the
// server keeps after both are unticked and saved
const systemSettings: SystemSettings = {
  backup: { configurations: [] },
  logging: {
    logLevel: 'info',
    logsDirectory: '/config/logs',
    useEnvVarLevel: false,
    logRollConfig: { enabled: true, rolledFileLimit: 3 },
  },
  server: { port: 8000, searchSettings: { snapshotIntervalHours: 4 } },
};

const { mockPutSystemSettings } = vi.hoisted(() => ({
  mockPutSystemSettings: vi.fn(
    (_options: { body: UpdateSystemSettingsRequest }): Promise<unknown> =>
      Promise.resolve({ data: {} }),
  ),
}));

vi.mock('../../../generated/sdk.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  putApiSystemSettings: (options: { body: UpdateSystemSettingsRequest }) =>
    mockPutSystemSettings(options),
}));

// The form keeps its values to itself, so the tests read them through the
// useForm call it makes
const { latestForm } = vi.hoisted(() => {
  const ref: { current?: Pick<UseFormReturn<FieldValues>, 'getValues'> } = {};
  return { latestForm: ref };
});

vi.mock('react-hook-form', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactHookForm>();
  return {
    ...actual,
    useForm: (...args: Parameters<typeof actual.useForm>) => {
      const form = actual.useForm(...args);
      latestForm.current = form;
      return form;
    },
  };
});

// It blocks navigation through the router, which these tests don't have
vi.mock('../UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

// It compares the server's version with a build-time global tests don't have
vi.mock('../../../hooks/useVersion.tsx', () => ({
  useVersion: () => ({ isLoading: false, isError: false }),
}));

function formValues() {
  const form = latestForm.current;
  if (form === undefined) {
    throw new Error('The form has not rendered');
  }
  return structuredClone(form.getValues());
}

async function renderForm(settings: SystemSettings = systemSettings) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(getApiSystemStateQueryKey(), {
    isDocker: false,
    isPodman: false,
    isInContainer: false,
  });
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <GeneralSettingsForm systemSettings={settings} />
      </LocalizationProvider>
    </SnackbarProvider>,
    { queryClient },
  );
  const backendUri = () => screen.getByLabelText('Tunarr server URL');
  await waitFor(() => expect(backendUri()).toHaveValue(LoadedBackendUri));
  // It only shows while the form has changes
  const resetButton = () =>
    screen.getByRole('button', { name: 'Reset changes' });
  const isResetShown = () =>
    screen.queryByRole('button', { name: 'Reset changes' }) !== null;
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  const setBackendUriField = async (value: string) => {
    await rendered.user.clear(backendUri());
    await rendered.user.type(backendUri(), value);
  };
  return {
    ...rendered,
    backendUri,
    resetButton,
    isResetShown,
    saveButton,
    setBackendUriField,
  };
}

describe('GeneralSettingsForm', () => {
  beforeEach(() => {
    latestForm.current = undefined;
    setBackendUri(LoadedBackendUri);
    mockPutSystemSettings.mockReset();
    mockPutSystemSettings.mockResolvedValue({ data: systemSettings });
  });

  test('category timing distinguishes live explicit levels from returning to inheritance', async () => {
    const { user } = await renderForm({
      ...systemSettings,
      logging: {
        ...systemSettings.logging,
        categoryLogLevel: { streaming: 'debug', scheduling: 'trace' },
      },
    });
    expect(screen.getAllByLabelText('Category log level: Live')).toHaveLength(
      2,
    );
    await user.click(
      screen.getByRole('combobox', { name: 'Streaming log level' }),
    );
    await user.click(
      await screen.findByRole('option', {
        name: 'Inherit default',
      }),
    );
    expect(
      screen.getByLabelText('Inherited category log level: Restart required'),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Category log level: Live')).toHaveLength(
      1,
    );
  });

  test('Reset clears an invalid value', async () => {
    const {
      user,
      backendUri,
      resetButton,
      isResetShown,
      saveButton,
      setBackendUriField,
    } = await renderForm();

    await setBackendUriField('not a url');
    await waitFor(() => expect(saveButton()).toBeDisabled());

    expect(resetButton()).toBeEnabled();
    await user.click(resetButton());

    await waitFor(() => expect(backendUri()).toHaveValue(LoadedBackendUri));
    expect(isResetShown()).toBe(false);
  });

  test('Reset fills the form exactly as loading it did', async () => {
    const { user, backendUri, resetButton, isResetShown, setBackendUriField } =
      await renderForm();
    const loaded = formValues();

    await setBackendUriField('http://tunarr.local:8000');
    await waitFor(() => expect(resetButton()).toBeEnabled());
    await user.click(resetButton());
    await waitFor(() => expect(backendUri()).toHaveValue(LoadedBackendUri));

    expect(formValues()).toEqual(loaded);
    // The schedule and size are filled in for log rolling, not left out
    expect(formValues()).toMatchObject({
      logging: {
        logRollConfig: {
          maxFileSizeBytes: 0,
          schedule: { type: 'every', unit: 'day', increment: 0, offsetMs: 0 },
        },
      },
    });
    // So nothing is left to save or reset
    expect(isResetShown()).toBe(false);
  });

  test('the log level help names the variable the server reads', async () => {
    await renderForm();

    const help = screen.getByText(/How much the Tunarr server logs/);
    const text = help.textContent ?? '';
    expect(text).toContain('TUNARR_LOG_LEVEL');
    expect(text.replaceAll('TUNARR_LOG_LEVEL', '')).not.toContain('LOG_LEVEL');
  });

  test('a save keeps the new server URL in the form and leaves it clean', async () => {
    const { user, backendUri, isResetShown, saveButton, setBackendUriField } =
      await renderForm();

    await setBackendUriField('http://tunarr.local:8000/');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // Saved without the trailing slash, and the form shows what was saved
    expect(useStore.getState().settings.backendUri).toBe(
      'http://tunarr.local:8000',
    );
    expect(backendUri()).toHaveValue('http://tunarr.local:8000');
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(isResetShown()).toBe(false);
  });

  test('unticking Roll on schedule saves log rolling without a schedule', async () => {
    const hourly = {
      ...systemSettings,
      logging: {
        ...systemSettings.logging,
        logRollConfig: {
          enabled: true,
          rolledFileLimit: 3,
          schedule: {
            type: 'every',
            increment: 1,
            unit: 'hour',
            offsetMs: 0,
          },
        },
      },
    } satisfies SystemSettings;
    const { user, saveButton } = await renderForm(hourly);

    await user.click(
      screen.getByRole('checkbox', { name: 'Roll on schedule' }),
    );
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutSystemSettings).toHaveBeenCalledOnce());
    const sent = mockPutSystemSettings.mock.calls[0]?.[0].body;
    expect(sent?.logging?.logRollConfig).toEqual({
      enabled: true,
      rolledFileLimit: 3,
      maxFileSizeBytes: undefined,
      schedule: undefined,
    });
  });

  test('unticking and ticking Roll on schedule keeps a cron schedule, and a save sends it', async () => {
    const cron = { type: 'cron', cron: '0 3 * * *' } as const;
    const cronRolling = {
      ...systemSettings,
      logging: {
        ...systemSettings.logging,
        logRollConfig: { enabled: true, rolledFileLimit: 3, schedule: cron },
      },
    } satisfies SystemSettings;
    const { user, saveButton } = await renderForm(cronRolling);
    const rollOnSchedule = () =>
      screen.getByRole('checkbox', { name: 'Roll on schedule' });
    const cronText =
      'Runs on the cron schedule 0 3 * * *, set in settings.json.';
    expect(rollOnSchedule()).toBeChecked();
    expect(screen.getByText(/Runs on the cron schedule/)).toHaveTextContent(
      cronText,
    );

    await user.click(rollOnSchedule());
    await user.click(rollOnSchedule());

    expect(rollOnSchedule()).toBeChecked();
    expect(screen.getByText(/Runs on the cron schedule/)).toHaveTextContent(
      cronText,
    );
    // Another change, so there is something to save
    await user.click(
      screen.getByRole('checkbox', { name: 'Roll based on size' }),
    );
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutSystemSettings).toHaveBeenCalledOnce());
    const sent = mockPutSystemSettings.mock.calls[0]?.[0].body;
    expect(sent?.logging?.logRollConfig?.schedule).toEqual(cron);
  });

  test('an invalid roll interval stops blocking Save once Roll on schedule is unticked', async () => {
    const hourly = {
      ...systemSettings,
      logging: {
        ...systemSettings.logging,
        logRollConfig: {
          enabled: true,
          rolledFileLimit: 3,
          schedule: {
            type: 'every',
            increment: 1,
            unit: 'hour',
            offsetMs: 0,
          },
        },
      },
    } satisfies SystemSettings;
    const { user, saveButton } = await renderForm(hourly);

    await user.clear(screen.getByLabelText('Roll interval'));
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeDisabled());

    // The schedule is no longer sent, so its empty interval no longer matters
    const rollOnSchedule = () =>
      screen.getByRole('checkbox', { name: 'Roll on schedule' });
    await user.click(rollOnSchedule());
    await waitFor(() => expect(saveButton()).toBeEnabled());

    // Ticked again, it starts from a fresh schedule with no leftover error
    await user.click(rollOnSchedule());
    const interval = screen.getByLabelText('Roll interval');
    expect(interval).toHaveValue('1');
    expect(interval).toBeValid();
    expect(interval).not.toHaveAccessibleDescription();

    await user.click(rollOnSchedule());
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutSystemSettings).toHaveBeenCalledOnce());
    const sent = mockPutSystemSettings.mock.calls[0]?.[0].body;
    expect(sent?.logging?.logRollConfig?.schedule).toBeUndefined();
  });

  test('an invalid backup interval stops blocking Save once backups are turned off', async () => {
    const withBackup = {
      ...systemSettings,
      backup: {
        configurations: [
          {
            enabled: true,
            outputs: [
              {
                type: 'file',
                outputPath: '',
                archiveFormat: 'tar',
                maxBackups: 3,
              },
            ],
            schedule: {
              type: 'every',
              increment: 1,
              unit: 'day',
              offsetMs: 3 * 60 * 60 * 1000,
            },
          },
        ],
      },
    } satisfies SystemSettings;
    const { user, saveButton } = await renderForm(withBackup);

    await user.clear(screen.getByLabelText('Backup interval'));
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeDisabled());

    await user.click(screen.getByRole('checkbox', { name: 'Enable backups' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutSystemSettings).toHaveBeenCalledOnce());
    const sent = mockPutSystemSettings.mock.calls[0]?.[0].body;
    expect(sent?.backup).toEqual({ configurations: [] });
  });

  test('turning log rolling off stops an invalid roll interval holding up Save, and sends neither schedule nor size', async () => {
    const rolling = {
      ...systemSettings,
      logging: {
        ...systemSettings.logging,
        logRollConfig: {
          enabled: true,
          rolledFileLimit: 3,
          maxFileSizeBytes: 50 * 1024 * 1024,
          schedule: {
            type: 'every',
            increment: 1,
            unit: 'hour',
            offsetMs: 0,
          },
        },
      },
    } satisfies SystemSettings;
    const { user, saveButton } = await renderForm(rolling);

    await user.clear(screen.getByLabelText('Roll interval'));
    await user.tab();
    await waitFor(() => expect(saveButton()).toBeDisabled());

    await user.click(
      screen.getByRole('checkbox', { name: 'Enable log file rolling' }),
    );
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());

    await waitFor(() => expect(mockPutSystemSettings).toHaveBeenCalledOnce());
    const sent = mockPutSystemSettings.mock.calls[0]?.[0].body;
    expect(sent?.logging?.logRollConfig).toEqual({
      enabled: false,
      rolledFileLimit: 3,
      maxFileSizeBytes: undefined,
      schedule: undefined,
    });
  });
});
