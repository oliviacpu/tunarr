import { SettingsForm } from '@/components/form/SettingsForm.tsx';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { InvalidateQueryFilters } from '@tanstack/react-query';
import { QueryClient } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { SnackbarProvider } from 'notistack';
import { useForm } from 'react-hook-form';
import { describe, expect, test, vi } from 'vitest';
import { useSettingsMutation } from './useSettingsMutation.ts';

// It blocks navigation through the router, which these tests don't have
vi.mock('../components/settings/UnsavedNavigationAlert.tsx', () => ({
  default: () => null,
}));

type Values = { name: string };

type HarnessProps = {
  save: (values: Values) => Promise<Values>;
  toFormValues?: (saved: Values, sent: Values) => Values;
  onSuccess?: (saved: Values) => void;
  invalidate?: InvalidateQueryFilters;
};

function Harness({
  save,
  toFormValues = (saved) => saved,
  onSuccess,
  invalidate,
}: HarnessProps) {
  const form = useForm<Values>({ defaultValues: { name: 'Tunarr' } });
  const mutation = useSettingsMutation({
    form,
    mutation: { mutationFn: save, onSuccess },
    toFormValues,
    invalidate,
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
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  await user.clear(name());
  await user.type(name(), typed);
  await waitFor(() => expect(saveButton()).toBeEnabled());
  await user.click(saveButton());
  return { ...rendered, name, saveButton, invalidateQueries };
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
  test("a save leaves the form clean with the server's values and says Saved", async () => {
    // The server tidies what it was sent
    const save = vi.fn((values: Values) =>
      Promise.resolve({ name: values.name.trim() }),
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
        save: () => Promise.resolve({ name: 'ignored' }),
        toFormValues: (_saved, sent) => sent,
        onSuccess,
      },
      'Tunarr Live',
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(onSuccess.mock.calls[0]?.[0]).toEqual({ name: 'ignored' });
    expect(name()).toHaveValue('Tunarr Live');
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
