import { LoadingIcon } from '@/components/base/LoadingIcon.tsx';
import UnsavedNavigationAlert from '@/components/settings/UnsavedNavigationAlert.tsx';
import { useActions } from '@/strings/actions';
import { Box, Button, Stack } from '@mui/material';
import type { ComponentProps, ReactNode } from 'react';
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
  /** Disable only when a containing page owns the combined unsaved guard. */
  guardNavigation?: boolean;
  /** The fields. */
  children: ReactNode;
};

/**
 * The shell every settings page sits in: the `<form>`, React Hook Form's
 * `FormProvider` (so fields can call `useFormContext()`), the save bar and the
 * unsaved-changes guard.
 *
 * The save bar has "Restore defaults" on the left when `onRestoreDefaults` is
 * given, and on the right "Reset changes" (only while there are changes; it
 * puts the saved values back) and Save. Save is the page's one contained
 * button and is enabled only when the form has changes, they are valid, and
 * no save is in flight; while one is, it shows a spinner.
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
  guardNavigation = true,
  children,
}: SettingsFormProps<TFieldValues, TContext, TTransformedValues>) {
  return (
    <FormProvider {...form}>
      <Box component="form" onSubmit={form.handleSubmit(onSubmit)}>
        {children}
        <SaveBar
          control={form.control}
          reset={form.reset}
          isSubmitting={isSubmitting}
          onRestoreDefaults={onRestoreDefaults}
          exceptTargetPaths={exceptTargetPaths}
          guardNavigation={guardNavigation}
        />
      </Box>
    </FormProvider>
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
  guardNavigation: boolean;
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
  guardNavigation,
}: SaveBarProps<TFieldValues, TContext, TTransformedValues>) {
  const actions = useActions();
  const formState = useFormState({ control });
  const { isDirty, isValid } = formState;
  const saving = isSubmitting || formState.isSubmitting;

  return (
    <>
      {guardNavigation && (
        <UnsavedNavigationAlert
          isDirty={isDirty}
          exceptTargetPaths={exceptTargetPaths}
        />
      )}
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
          <Button variant="outlined" onClick={() => reset()}>
            {actions.resetChanges}
          </Button>
        )}
        <Button
          variant="contained"
          type="submit"
          disabled={!isDirty || !isValid || saving}
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
