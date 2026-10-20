import { renderWithProviders, screen, waitFor } from '@/test/utils';
import type { ComponentProps } from 'react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type UnsavedNavigationAlert from '../settings/UnsavedNavigationAlert.tsx';
import type { SettingsFormProps } from './SettingsForm.tsx';
import { SettingsForm } from './SettingsForm.tsx';

type GuardProps = ComponentProps<typeof UnsavedNavigationAlert>;

// The guard blocks navigation through the router, which these tests don't
// have; record what the form tells it instead
const { guardProps } = vi.hoisted(() => ({
  guardProps: vi.fn((_props: GuardProps) => null),
}));

vi.mock('../settings/UnsavedNavigationAlert.tsx', () => ({
  default: guardProps,
}));

function lastGuardProps(): GuardProps {
  const call = guardProps.mock.lastCall;
  if (call === undefined) {
    throw new Error('SettingsForm did not render the unsaved guard');
  }
  return call[0];
}

type Values = { name: string; tuners: number };

const saved: Values = { name: 'Tunarr', tuners: 2 };

type HarnessProps = Omit<
  SettingsFormProps<Values, unknown, Values>,
  'form' | 'children' | 'onSubmit'
> & { onSubmit?: (values: Values) => void };

function Harness({ onSubmit = () => {}, ...props }: HarnessProps) {
  const form = useForm<Values>({ defaultValues: saved, mode: 'onChange' });
  return (
    <SettingsForm form={form} onSubmit={onSubmit} {...props}>
      <label>
        Name
        <input
          aria-invalid={form.formState.errors.name !== undefined}
          {...form.register('name', { required: 'Enter a name' })}
        />
      </label>
    </SettingsForm>
  );
}

function renderForm(props: HarnessProps = {}) {
  const rendered = renderWithProviders(<Harness {...props} />);
  return {
    ...rendered,
    name: () => screen.getByRole('textbox', { name: 'Name' }),
    saveButton: () => screen.getByRole('button', { name: 'Save' }),
    resetChanges: () => screen.queryByRole('button', { name: 'Reset changes' }),
    restoreDefaults: () =>
      screen.queryByRole('button', { name: 'Restore defaults' }),
  };
}

describe('SettingsForm', () => {
  beforeEach(() => {
    guardProps.mockClear();
  });

  test('Save is disabled while nothing has changed', () => {
    const { saveButton } = renderForm();

    expect(saveButton()).toBeDisabled();
  });

  test('Save is enabled once a change is valid, and saves the values', async () => {
    const onSubmit = vi.fn();
    const { user, name, saveButton } = renderForm({ onSubmit });

    await user.type(name(), ' Live');

    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      name: 'Tunarr Live',
      tuners: 2,
    });
  });

  test('Save is disabled while a change is invalid', async () => {
    const { user, name, saveButton } = renderForm();
    await user.type(name(), ' Live');
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.clear(name());

    await waitFor(() => expect(name()).toBeInvalid());
    expect(saveButton()).toBeDisabled();
  });

  test('Save is disabled with a spinner while saving', async () => {
    const { user, name, saveButton } = renderForm({ isSubmitting: true });

    await user.type(name(), ' Live');

    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { hidden: true })).toBeVisible();
  });

  test('Reset changes shows only with changes, and puts the saved values back', async () => {
    const { user, name, saveButton, resetChanges } = renderForm();
    expect(resetChanges()).not.toBeInTheDocument();

    await user.type(name(), ' Live');
    const reset = await screen.findByRole('button', { name: 'Reset changes' });
    await user.click(reset);

    expect(name()).toHaveValue('Tunarr');
    await waitFor(() => expect(resetChanges()).not.toBeInTheDocument());
    expect(saveButton()).toBeDisabled();
  });

  test('Restore defaults shows only when the page offers it', async () => {
    const { restoreDefaults, unmount } = renderForm();
    expect(restoreDefaults()).not.toBeInTheDocument();
    unmount();

    const onRestoreDefaults = vi.fn();
    const { user } = renderForm({ onRestoreDefaults });
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(onRestoreDefaults).toHaveBeenCalledOnce();
  });

  test('a new form can save its starting values, but only while they are valid', async () => {
    const onSubmit = vi.fn();
    const { user, name, saveButton, resetChanges } = renderForm({
      isNew: true,
      onSubmit,
    });

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(resetChanges()).not.toBeInTheDocument();
    expect(lastGuardProps().isDirty).toBe(false);

    await user.clear(name());
    await waitFor(() => expect(saveButton()).toBeDisabled());

    await user.type(name(), 'Tunarr');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  test('changes held outside the form count as changes', async () => {
    const onDiscardChanges = vi.fn();
    const { user, name, saveButton } = renderForm({
      hasOtherChanges: true,
      onDiscardChanges,
    });

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(lastGuardProps()).toMatchObject({
      isDirty: true,
      onProceed: onDiscardChanges,
    });

    // Reset changes puts back the fields and the outside changes
    await user.type(name(), ' Live');
    await user.click(screen.getByRole('button', { name: 'Reset changes' }));

    expect(name()).toHaveValue('Tunarr');
    expect(onDiscardChanges).toHaveBeenCalledOnce();
  });

  test('saveDisabled keeps Save disabled after a valid change', async () => {
    const { user, name, saveButton, resetChanges } = renderForm({
      saveDisabled: true,
    });

    await user.type(name(), ' Live');

    await waitFor(() => expect(resetChanges()).toBeInTheDocument());
    expect(saveButton()).toBeDisabled();
  });

  test('disabled locks the fields', async () => {
    const { user, name } = renderForm({ disabled: true });

    expect(name()).toBeDisabled();
    await user.type(name(), ' Live');
    expect(name()).toHaveValue('Tunarr');
  });

  test('Reset changes cannot discard a draft while its save is pending', () => {
    const onDiscardChanges = vi.fn();
    renderForm({
      isSubmitting: true,
      hasOtherChanges: true,
      onDiscardChanges,
    });
    const reset = screen.getByRole('button', { name: 'Reset changes' });
    expect(reset).toBeDisabled();
    expect(onDiscardChanges).not.toHaveBeenCalled();
  });

  test('the unsaved guard follows whether the form has changes', async () => {
    const { user, name } = renderForm({
      exceptTargetPaths: ['/settings/hdhr'],
    });
    expect(lastGuardProps()).toMatchObject({
      isDirty: false,
      exceptTargetPaths: ['/settings/hdhr'],
    });

    await user.type(name(), ' Live');
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Reset changes' }));
    await waitFor(() => expect(lastGuardProps().isDirty).toBe(false));
  });
});
