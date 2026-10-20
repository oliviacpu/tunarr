import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { InvalidateQueryFilters } from '@tanstack/react-query';
import { QueryClient } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import type { ComponentProps } from 'react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type UnsavedNavigationAlert from '../components/settings/UnsavedNavigationAlert.tsx';
import {
  changedFieldPaths,
  useSettingsMutation,
} from './useSettingsMutation.ts';

type GuardProps = ComponentProps<typeof UnsavedNavigationAlert>;

// The guard blocks navigation through the router, which these tests don't
// have; record whether the form tells it there are unsaved changes instead
const { guardProps } = vi.hoisted(() => ({
  guardProps: vi.fn((_props: GuardProps) => null),
}));

vi.mock('../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: guardProps,
}));

const guardIsArmed = () => guardProps.mock.lastCall?.[0].isDirty;

type Values = { name: string; host: string };

type HarnessProps = {
  save: (values: Values) => Promise<Values>;
  toFormValues?: (saved: Values, sent: Values) => Values;
  onSuccess?: (saved: Values) => void;
  invalidate?: InvalidateQueryFilters;
  failureMessage?: string;
};

function Harness({
  save,
  toFormValues = (saved) => saved,
  onSuccess,
  invalidate,
  failureMessage,
}: HarnessProps) {
  const form = useForm<Values>({
    defaultValues: { name: 'Tunarr', host: 'localhost' },
  });
  const mutation = useSettingsMutation({
    form,
    mutation: { mutationFn: save, onSuccess },
    toFormValues,
    invalidate,
    failureMessage,
  });
  return (
    <SettingsForm
      form={form}
      onSubmit={(values) => mutation.mutate(values)}
      isSubmitting={mutation.isPending}
    >
      <label>
        Name
        <input {...form.register('name')} />
      </label>
      <label>
        Host
        <input {...form.register('host')} />
      </label>
    </SettingsForm>
  );
}

async function renderAndSave(props: HarnessProps, typed: string) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const rendered = renderWithProviders(
    <SnackbarProvider>
      <Harness {...props} />
    </SnackbarProvider>,
    { queryClient },
  );
  const { user } = rendered;
  const name = () => screen.getByRole('textbox', { name: 'Name' });
  const host = () => screen.getByRole('textbox', { name: 'Host' });
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  await user.clear(name());
  await user.type(name(), typed);
  await waitFor(() => expect(saveButton()).toBeEnabled());
  await user.click(saveButton());
  return { ...rendered, name, host, saveButton, invalidateQueries };
}

function serverRefuses(message: string) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
    data: { message },
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

describe('useSettingsMutation', () => {
  beforeEach(() => {
    guardProps.mockClear();
  });

  test("a save leaves the form clean with the server's values and says Saved", async () => {
    // The server tidies what it was sent
    const save = vi.fn((values: Values) =>
      Promise.resolve({ ...values, name: values.name.trim() }),
    );
    const { name, saveButton } = await renderAndSave({ save }, 'Tunarr Live ');

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(save).toHaveBeenCalledOnce();
    expect(name()).toHaveValue('Tunarr Live');
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(
      screen.queryByRole('button', { name: 'Reset changes' }),
    ).not.toBeInTheDocument();
  });

  test('a save refetches the queries it was given', async () => {
    const { invalidateQueries } = await renderAndSave(
      {
        save: (values) => Promise.resolve(values),
        invalidate: { queryKey: ['settings'] },
      },
      'Tunarr Live',
    );

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['settings'],
      }),
    );
  });

  test('the form takes what toFormValues makes of the save', async () => {
    const onSuccess = vi.fn();
    const { name } = await renderAndSave(
      {
        // This server answers with something that isn't the form's values
        save: () => Promise.resolve({ name: 'ignored', host: 'ignored' }),
        toFormValues: (_saved, sent) => sent,
        onSuccess,
      },
      'Tunarr Live',
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(onSuccess.mock.calls[0]?.[0]).toEqual({
      name: 'ignored',
      host: 'ignored',
    });
    expect(name()).toHaveValue('Tunarr Live');
  });

  test('a field changed while the save is in flight keeps its new value and stays unsaved', async () => {
    let answer: (saved: Values) => void = () => {};
    const save = vi.fn(
      (_values: Values) =>
        new Promise<Values>((resolve) => {
          answer = resolve;
        }),
    );
    const { user, name, host, saveButton } = await renderAndSave(
      { save },
      'Tunarr Live ',
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual({
      name: 'Tunarr Live ',
      host: 'localhost',
    });

    // The user goes on editing before the server answers
    await user.clear(host());
    await user.type(host(), 'tunarr.lan');
    // The server tidies what it was sent
    answer({ name: 'Tunarr Live', host: 'localhost' });

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // The field saved as it was takes the server's value...
    await waitFor(() => expect(name()).toHaveValue('Tunarr Live'));
    // ...and the one changed since keeps the user's, still unsaved
    expect(host()).toHaveValue('tunarr.lan');
    await waitFor(() => expect(guardIsArmed()).toBe(true));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    // What the form now compares against is what the server saved
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(host()).toHaveValue('localhost');
    expect(name()).toHaveValue('Tunarr Live');
    await waitFor(() => expect(guardIsArmed()).toBe(false));
  });

  test("a save the server refuses says why and keeps the user's changes", async () => {
    const { name } = await renderAndSave(
      {
        save: () =>
          Promise.reject(serverRefuses('That name is taken by a channel.')),
      },
      'Tunarr Live',
    );

    expect(
      await screen.findByText(
        'Could not save settings: That name is taken by a channel.',
      ),
    ).toBeInTheDocument();
    expect(name()).toHaveValue('Tunarr Live');
    expect(
      screen.getByRole('button', { name: 'Reset changes' }),
    ).toBeInTheDocument();
  });

  test('an editor that is not a settings page names its own failure', async () => {
    await renderAndSave(
      {
        save: () => Promise.reject(serverRefuses('Channel number in use.')),
        failureMessage: 'Could not save',
      },
      'Tunarr Live',
    );

    expect(
      await screen.findByText('Could not save: Channel number in use.'),
    ).toBeInTheDocument();
  });

  test('a save that never reached the server says what went wrong', async () => {
    await renderAndSave(
      { save: () => Promise.reject(new Error('Network Error')) },
      'Tunarr Live',
    );

    expect(
      await screen.findByText('Could not save settings: Network Error'),
    ).toBeInTheDocument();
  });
});

describe('changedFieldPaths', () => {
  test('nothing changed', () => {
    expect(
      changedFieldPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }),
    ).toEqual([]);
  });

  test('finds changed fields inside nested objects', () => {
    expect(
      changedFieldPaths(
        { name: 'x', logging: { level: 'info', roll: { size: 1 } } },
        { name: 'x', logging: { level: 'debug', roll: { size: 2 } } },
      ),
    ).toEqual([
      ['logging', 'level'],
      ['logging', 'roll', 'size'],
    ]);
  });

  test('treats an array as one field, and counts added and removed keys', () => {
    expect(
      changedFieldPaths(
        { outputs: [1, 2], gone: true },
        { outputs: [1, 3], added: 'y' },
      ),
    ).toEqual([['outputs'], ['gone'], ['added']]);
  });
});
