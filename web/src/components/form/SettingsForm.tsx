import { LoadingIcon } from '@/components/base/LoadingIcon.tsx';
import UnsavedNavigationAlert from '@/components/settings/UnsavedNavigationAlert.tsx';
import { useActions } from '@/strings/actions';
import { Box, Button, Stack } from '@mui/material';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type {
  Control,
  FieldValues,
  SubmitHandler,
  UseFormReset,
  UseFormReturn,
} from 'react-hook-form';
import { FormProvider, useFormState } from 'react-hook-form';

type ExceptTargetPaths = ComponentProps<
  typeof UnsavedNavigationAlert
>['exceptTargetPaths'];

export type SettingsFormProps<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues,
> = {
  /** The page's `useForm()` result. Its default values are the saved settings. */
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>;
  /** Called with the form's values when Save is pressed and they are valid. */
  onSubmit: SubmitHandler<TTransformedValues>;
  /** True while the save is in flight, usually the mutation's `isPending`. */
  isSubmitting?: boolean;
  /**
   * Shows "Restore defaults" on the left of the save bar. It should fill the
   * form with the defaults without saving and without replacing the saved
   * values the form compares against, so the form turns dirty and Save,
   * Reset changes and the unsaved guard all work:
   * `form.reset(defaults, { keepDefaultValues: true })`. Leave it out to hide
   * the button, for example while the form already holds the defaults.
   */
  onRestoreDefaults?: () => void;
  /** Routes the unsaved-changes guard lets the user leave to without asking. */
  exceptTargetPaths?: ExceptTargetPaths;
  /**
   * The form creates something that isn't saved yet, such as a new channel.
   * Save is then enabled whenever the values are valid, changed or not, so
   * the starting values can be saved as they are.
   */
  isNew?: boolean;
  /**
   * Unsaved changes the page holds outside the form's fields, such as a
   * program list in a store draft. They count as changes: Save and "Reset
   * changes" show as they do for an edited field, and leaving the page asks
   * first.
   */
  hasOtherChanges?: boolean;
  /**
   * Throws away the changes held outside the form. Called when "Reset
   * changes" is pressed, after the form's own fields are reset, and when the
   * user leaves the page through the unsaved-changes guard.
   */
  onDiscardChanges?: () => void;
  /**
   * Keeps Save disabled for a reason the form's validation doesn't cover,
   * such as an empty program list. The page should say why.
   */
  saveDisabled?: boolean;
  /**
   * Locks every field, for example while a save is in flight that must not
   * see edits made after it was pressed: a create that moves on to another
   * page, or a save that includes a draft held outside the form.
   */
  disabled?: boolean;
  /** The fields. */
  children: ReactNode;
};

/**
 * The shell every settings page and entity editor sits in: the `<form>`, React
 * Hook Form's `FormProvider` (so fields can call `useFormContext()`), the save
 * bar and the unsaved-changes guard.
 *
 * The save bar has "Restore defaults" on the left when `onRestoreDefaults` is
 * given, and on the right "Reset changes" (only while there are changes; it
 * puts the saved values back) and Save. Save is the page's one contained
 * button and is enabled only when the form has changes (or `isNew`), they are
 * valid, and no save is in flight; while one is, it shows a spinner.
 */
export function SettingsForm<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues,
>({
  form,
  onSubmit,
  isSubmitting = false,
  onRestoreDefaults,
  exceptTargetPaths,
  isNew = false,
  hasOtherChanges = false,
  onDiscardChanges,
  saveDisabled = false,
  disabled,
  children,
}: SettingsFormProps<TFieldValues, TContext, TTransformedValues>) {
  return (
    <FormProvider {...form}>
      <Box component="form" onSubmit={form.handleSubmit(onSubmit)}>
        {disabled === undefined ? (
          children
        ) : (
          <FieldLock disabled={disabled}>{children}</FieldLock>
        )}
        <SaveBar
          control={form.control}
          reset={form.reset}
          isSubmitting={isSubmitting}
          onRestoreDefaults={onRestoreDefaults}
          exceptTargetPaths={exceptTargetPaths}
          isNew={isNew}
          hasOtherChanges={hasOtherChanges}
          onDiscardChanges={onDiscardChanges}
          saveDisabled={saveDisabled}
        />
      </Box>
    </FormProvider>
  );
}

// A borderless fieldset, so `disabled` turns off every native input and
// button inside it. MUI's select, slider and drag handles are not native
// controls, so the fieldset is also made inert, which takes clicks, focus and
// key presses away from everything inside it. React 18 has no `inert` prop;
// the DOM property is set directly
function FieldLock({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.inert = disabled;
    }
  }, [disabled]);
  return (
    <Box
      component="fieldset"
      ref={ref}
      disabled={disabled}
      aria-busy={disabled}
      sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}

type SaveBarProps<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues,
> = {
  control: Control<TFieldValues, TContext, TTransformedValues>;
  reset: UseFormReset<TFieldValues>;
  isSubmitting: boolean;
  onRestoreDefaults?: () => void;
  exceptTargetPaths?: ExceptTargetPaths;
  isNew: boolean;
  hasOtherChanges: boolean;
  onDiscardChanges?: () => void;
  saveDisabled: boolean;
};

// Subscribes to the form state on its own, so typing in a field re-renders
// the bar and not the whole page
function SaveBar<
  TFieldValues extends FieldValues,
  TContext,
  TTransformedValues,
>({
  control,
  reset,
  isSubmitting,
  onRestoreDefaults,
  exceptTargetPaths,
  isNew,
  hasOtherChanges,
  onDiscardChanges,
  saveDisabled,
}: SaveBarProps<TFieldValues, TContext, TTransformedValues>) {
  const actions = useActions();
  const formState = useFormState({ control });
  const { isValid } = formState;
  const isDirty = formState.isDirty || hasOtherChanges;
  const saving = isSubmitting || formState.isSubmitting;

  const resetChanges = () => {
    reset();
    onDiscardChanges?.();
  };

  return (
    <>
      <UnsavedNavigationAlert
        isDirty={isDirty}
        exceptTargetPaths={exceptTargetPaths}
        onProceed={onDiscardChanges}
      />
      <Stack
        direction="row"
        useFlexGap
        spacing={2}
        sx={{
          mt: 3,
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
          justifyContent: 'flex-end',
          alignItems: 'center',
        }}
      >
        {onRestoreDefaults !== undefined && (
          // Its right margin soaks up the free space, so this button sits on
          // the left and the rest on the right
          <Button
            variant="outlined"
            onClick={onRestoreDefaults}
            sx={{ mr: 'auto' }}
          >
            {actions.restoreDefaults}
          </Button>
        )}
        {isDirty && (
          <Button variant="outlined" onClick={resetChanges} disabled={saving}>
            {actions.resetChanges}
          </Button>
        )}
        <Button
          variant="contained"
          type="submit"
          disabled={(!isDirty && !isNew) || !isValid || saving || saveDisabled}
          aria-busy={saving}
          // The button keeps its name; the spinner is only decoration
          startIcon={saving ? <LoadingIcon aria-hidden /> : undefined}
        >
          {actions.save}
        </Button>
      </Stack>
    </>
  );
}
