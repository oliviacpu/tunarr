import { describeError } from '@/helpers/apiError.ts';
import { useToasts, withReason } from '@/strings/actions';
import type {
  InvalidateQueryFilters,
  UseMutationOptions,
  UseMutationResult,
} from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { castArray } from 'lodash-es';
import { useSnackbar } from 'notistack';
import type { FieldValues, UseFormReset } from 'react-hook-form';

export type UseSettingsMutationOptions<
  TFieldValues extends FieldValues,
  TData,
  TError,
  TVariables,
  TContext,
> = {
  /** The settings form; only its `reset` is used. */
  form: { reset: UseFormReset<TFieldValues> };
  /**
   * The save's mutation options, as the generated client makes them, e.g.
   * `putApiXmltvSettingsMutation()`. Their own `onSuccess` and `onError` still
   * run, after this hook's.
   */
  mutation: UseMutationOptions<TData, TError, TVariables, TContext>;
  /**
   * The form values the save leaves behind, from what the server answered
   * (or what was sent). The form resets to them, so it is clean and its
   * saved values are the server's.
   */
  toFormValues: (saved: TData, variables: TVariables) => TFieldValues;
  /** Queries to refetch once saved, such as the settings the page loaded. */
  invalidate?: InvalidateQueryFilters | readonly InvalidateQueryFilters[];
};

/**
 * Saves a settings form. On success it resets the form to the saved values,
 * toasts "Saved" and refetches the queries in `invalidate`; the mutation stays
 * pending until they are back. On failure it toasts "Could not save settings"
 * with the server's reason.
 */
export function useSettingsMutation<
  TFieldValues extends FieldValues,
  TData,
  TError,
  TVariables,
  TContext = unknown,
>({
  form,
  mutation,
  toFormValues,
  invalidate,
}: UseSettingsMutationOptions<
  TFieldValues,
  TData,
  TError,
  TVariables,
  TContext
>): UseMutationResult<TData, TError, TVariables, TContext> {
  const toasts = useToasts();
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  return useMutation({
    ...mutation,
    onSuccess: async (data, variables, context) => {
      form.reset(toFormValues(data, variables));
      enqueueSnackbar(toasts.saved, { variant: 'success' });
      await mutation.onSuccess?.(data, variables, context);
      if (invalidate !== undefined) {
        await Promise.all(
          castArray(invalidate).map((filters) =>
            queryClient.invalidateQueries(filters),
          ),
        );
      }
    },
    onError: async (error, variables, context) => {
      enqueueSnackbar(
        withReason(toasts.couldNotSaveSettings, describeError(error)),
        { variant: 'error' },
      );
      await mutation.onError?.(error, variables, context);
    },
  });
}
