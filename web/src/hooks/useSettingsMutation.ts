import { describeError } from '@/helpers/apiError.ts';
import { useToasts, withReason } from '@/strings/actions';
import type {
  InvalidateQueryFilters,
  UseMutationOptions,
  UseMutationResult,
} from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  castArray,
  cloneDeep,
  get,
  isEqual,
  isPlainObject,
  set,
  union,
} from 'lodash-es';
import { useSnackbar } from 'notistack';
import { useRef } from 'react';
import type {
  FieldValues,
  UseFormGetValues,
  UseFormReset,
} from 'react-hook-form';

export type UseSettingsMutationOptions<
  TFieldValues extends FieldValues,
  TData,
  TError,
  TVariables,
  TContext,
> = {
  /** The settings form; only its `reset` and `getValues` are used. */
  form: {
    reset: UseFormReset<TFieldValues>;
    getValues: UseFormGetValues<TFieldValues>;
  };
  /**
   * The save's mutation options, as the generated client makes them, e.g.
   * `putApiXmltvSettingsMutation()`. Their own `onMutate`, `onSuccess` and
   * `onError` still run, after this hook's.
   */
  mutation: UseMutationOptions<TData, TError, TVariables, TContext>;
  /**
   * The form values the save leaves behind, from what the server answered
   * (or what was sent). They become the values the form compares against.
   */
  toFormValues: (saved: TData, variables: TVariables) => TFieldValues;
  /** Queries to refetch once saved, such as the settings the page loaded. */
  invalidate?: InvalidateQueryFilters | readonly InvalidateQueryFilters[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value);

/**
 * The paths of the fields whose value differs between two snapshots of a
 * form. Objects are compared key by key; anything else (arrays included) is
 * one field.
 */
export function changedFieldPaths(
  before: unknown,
  after: unknown,
  path: string[] = [],
): string[][] {
  if (isEqual(before, after)) {
    return [];
  }
  if (isRecord(before) && isRecord(after)) {
    return union(Object.keys(before), Object.keys(after)).flatMap((key) =>
      changedFieldPaths(before[key], after[key], [...path, key]),
    );
  }
  return [path];
}

/**
 * Saves a settings form.
 *
 * On success the server's values (`toFormValues`) become what the form
 * compares against, and every field takes them except the ones the user has
 * changed since pressing Save: those keep the user's value and stay unsaved,
 * so the form stays dirty and the unsaved-changes guard stays on. Then it
 * toasts "Saved" and refetches the queries in `invalidate`; the mutation stays
 * pending until they are back. On failure it toasts "Could not save settings"
 * with the server's reason and leaves the form as it is.
 *
 * It tracks one save at a time, which `SettingsForm` ensures by disabling
 * Save while one is in flight.
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
  // What the form held when Save was pressed, to tell later edits apart
  const submittedValues = useRef<TFieldValues | undefined>(undefined);

  return useMutation({
    ...mutation,
    onMutate: (variables) => {
      // getValues() copies only the top level; nested objects keep changing
      submittedValues.current = cloneDeep(form.getValues());
      return mutation.onMutate?.(variables);
    },
    onSuccess: async (data, variables, context) => {
      const saved = toFormValues(data, variables);
      const submitted = submittedValues.current;
      submittedValues.current = undefined;
      const current = form.getValues();
      const editedSinceSave =
        submitted === undefined ? [] : changedFieldPaths(submitted, current);

      form.reset(saved);
      if (editedSinceSave.length > 0) {
        // Put the newer edits back on top of the saved values. Keeping the
        // saved values as the defaults leaves those fields dirty
        const values = cloneDeep(saved);
        for (const path of editedSinceSave) {
          const value: unknown = get(current, path);
          set(values, path, value);
        }
        form.reset(values, { keepDefaultValues: true });
      }

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
      submittedValues.current = undefined;
      enqueueSnackbar(
        withReason(toasts.couldNotSaveSettings, describeError(error)),
        { variant: 'error' },
      );
      await mutation.onError?.(error, variables, context);
    },
  });
}
