import { describeError } from '@/helpers/apiError';
import { useToasts, withReason } from '@/strings/actions';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useSnackbar } from 'notistack';
import { useCallback, useState } from 'react';

export type BulkFailure<T> = { item: T; reason: string | undefined };

export type BulkOutcome<T> = {
  succeeded: T[];
  failed: BulkFailure<T>[];
};

// A partial-failure toast names this many failures, then "and N more"
const MaxListedFailures = 3;

/**
 * Runs `run` for every item at once and waits for all of them, so one failure
 * neither stops the rest nor hides which items failed. The reason for each
 * failure is the server's message when it sent one.
 */
export async function settleEach<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
): Promise<BulkOutcome<T>> {
  const settled = await Promise.allSettled(items.map((item) => run(item)));
  const outcome: BulkOutcome<T> = { succeeded: [], failed: [] };
  items.forEach((item, i) => {
    const result = settled[i];
    if (result?.status === 'fulfilled') {
      outcome.succeeded.push(item);
    } else {
      outcome.failed.push({
        item,
        reason: result !== undefined ? describeError(result.reason) : undefined,
      });
    }
  });
  return outcome;
}

type BulkVerb = 'delete' | 'save';

/**
 * Runs one action over many items with `settleEach` and reports the result in
 * one toast: "Deleted" / "Saved" when every item succeeded, otherwise
 * "3 of 4 deleted; could not delete Late Night: <reason>".
 */
export function useBulkAction<T>(verb: BulkVerb, getName: (item: T) => string) {
  const { t } = useLingui();
  const toasts = useToasts();
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = useState(false);

  const describeFailure = useCallback(
    ({ item, reason }: BulkFailure<T>) => {
      const name = getName(item);
      return withReason(
        verb === 'delete'
          ? t`could not delete ${name}`
          : t`could not save ${name}`,
        reason,
      );
    },
    [getName, t, verb],
  );

  const run = useCallback(
    async (items: readonly T[], action: (item: T) => Promise<unknown>) => {
      setBusy(true);
      try {
        const outcome = await settleEach(items, action);
        const done = outcome.succeeded.length;
        const total = items.length;

        if (outcome.failed.length === 0) {
          enqueueSnackbar({
            message: verb === 'delete' ? toasts.deleted : toasts.saved,
            variant: 'success',
          });
          return outcome;
        }

        const summary =
          verb === 'delete'
            ? t`${done} of ${total} deleted`
            : t`${done} of ${total} saved`;
        const listed = outcome.failed
          .slice(0, MaxListedFailures)
          .map(describeFailure);
        const more = outcome.failed.length - listed.length;
        if (more > 0) {
          listed.push(
            t`${plural(more, { one: 'and # more', other: 'and # more' })}`,
          );
        }
        enqueueSnackbar({
          message: [summary, ...listed].join('; '),
          variant: done > 0 ? 'warning' : 'error',
        });
        return outcome;
      } finally {
        setBusy(false);
      }
    },
    [describeFailure, enqueueSnackbar, t, toasts, verb],
  );

  return { busy, run };
}

type BulkDeleteOptions<T> = {
  getId: (item: T) => string;
  getName: (item: T) => string;
  /** Deletes one item; rejects when the server refuses. */
  deleteOne: (item: T) => Promise<unknown>;
  /** Runs once the deletes settle and the toast is up: refetch, clear selection. */
  onDone: (outcome: BulkOutcome<T>) => void;
};

/**
 * State for a bulk delete through `DeleteConfirmationDialog`. `open(items)`
 * takes a snapshot of the selection, so the dialog deletes exactly what it
 * listed even if the table refetches meanwhile. The dialog stays open, busy,
 * until every delete settles.
 */
export function useBulkDelete<T>({
  getId,
  getName,
  deleteOne,
  onDone,
}: BulkDeleteOptions<T>) {
  const [pending, setPending] = useState<readonly T[]>();
  const { busy, run } = useBulkAction<T>('delete', getName);

  return {
    busy,
    count: pending?.length ?? 0,
    named: (pending ?? []).map((item) => ({
      id: getId(item),
      name: getName(item),
    })),
    open: (items: readonly T[]) => {
      if (items.length > 0) {
        setPending(items);
      }
    },
    dialogProps: {
      open: pending !== undefined,
      busy,
      closeOnConfirm: false,
      onClose: () => {
        if (!busy) {
          setPending(undefined);
        }
      },
      onConfirm: () => {
        if (pending === undefined) {
          return;
        }
        run(pending, deleteOne)
          .then((outcome) => {
            setPending(undefined);
            onDone(outcome);
          })
          .catch(console.error);
      },
    },
  };
}
