import { setBackendUri } from '@/store/settings/actions.ts';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { QueryClient } from '@tanstack/react-query';
import type { SystemSettings } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import type * as ReactHookForm from 'react-hook-form';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getApiSystemStateQueryKey } from '../../../generated/@tanstack/react-query.gen.ts';
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

async function renderForm() {
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
      <GeneralSettingsForm systemSettings={systemSettings} />
    </SnackbarProvider>,
    { queryClient },
  );
  const backendUri = () => screen.getByLabelText('Tunarr server URL');
  await waitFor(() => expect(backendUri()).toHaveValue(LoadedBackendUri));
  // It only shows while the form has changes
  const resetButton = () =>
    screen.getByRole('button', { name: 'Reset Options' });
  const isResetShown = () =>
    screen.queryByRole('button', { name: 'Reset Options' }) !== null;
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
});
