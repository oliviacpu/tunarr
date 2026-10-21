import { bulkDeleteChannels } from '@/generated/sdk.gen.ts';
import { runChannelBatches } from '@/helpers/channelBatches.ts';
import { useToasts, withReason } from '@/strings/actions.ts';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { BulkChannelDeleteResponseSchema } from '@tunarr/types/api';
import { useSnackbar } from 'notistack';
import { useRef, useState } from 'react';

type NamedChannel = { id: string; name: string };

export function useBulkChannelDelete(onDone: () => void) {
  const { t } = useLingui();
  const toasts = useToasts();
  const { enqueueSnackbar } = useSnackbar();
  const [pending, setPending] = useState<NamedChannel[]>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const describeNames = (channels: readonly NamedChannel[]) => {
    const names = channels.slice(0, 3).map((channel) => channel.name);
    const more = channels.length - names.length;
    if (more > 0) {
      names.push(
        t`${plural(more, { one: 'and # more', other: 'and # more' })}`,
      );
    }
    return names.join(', ');
  };

  const confirm = async () => {
    if (running.current || pending === undefined) {
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runChannelBatches(pending, async (ids) => {
        const { data } = await bulkDeleteChannels({
          body: { ids },
          throwOnError: true,
        });
        return BulkChannelDeleteResponseSchema.parse(data);
      });
      const done = outcome.succeeded.length;
      const total = pending.length;
      const complete =
        outcome.failed.length === 0 && outcome.unknown.length === 0;
      const messages = [
        complete
          ? toasts.deleted
          : outcome.unknown.length > 0
            ? t`${done} of ${total} confirmed deleted`
            : t`${done} of ${total} deleted`,
      ];
      const listed = outcome.failed.slice(0, 3).map(({ item, reason }) => {
        const name = item.name;
        return withReason(t`could not delete ${name}`, reason);
      });
      const more = outcome.failed.length - listed.length;
      if (more > 0) {
        listed.push(
          t`${plural(more, { one: 'and # more', other: 'and # more' })}`,
        );
      }
      messages.push(...listed);
      if (outcome.unknown.length > 0) {
        const names = describeNames(outcome.unknown);
        messages.push(
          t`Outcome unknown for ${names}. Channels may have been deleted. Refreshing channels to check; no automatic retry.`,
        );
      }
      if (outcome.unattempted.length > 0) {
        const names = describeNames(outcome.unattempted);
        messages.push(t`Not attempted: ${names}`);
      }
      enqueueSnackbar({
        message: messages.join('; '),
        variant: complete
          ? 'success'
          : done > 0 || outcome.unknown.length > 0
            ? 'warning'
            : 'error',
        autoHideDuration: outcome.unknown.length > 0 ? 15000 : undefined,
      });
      if (outcome.cleanupFailures.length > 0) {
        const warnings = outcome.cleanupFailures
          .slice(0, 3)
          .map(({ item, reason, deleted }) => {
            const name = item.name;
            return withReason(
              deleted
                ? t`Deleted ${name}, but cleanup failed`
                : t`Cleanup failed for ${name} after deletion failed`,
              reason,
            );
          });
        const more = outcome.cleanupFailures.length - warnings.length;
        if (more > 0) {
          warnings.push(
            t`${plural(more, { one: 'and # more', other: 'and # more' })}`,
          );
        }
        enqueueSnackbar({ message: warnings.join('; '), variant: 'warning' });
      }
      if (outcome.publicationFailures.length > 0) {
        const publications = outcome.publicationFailures
          .map((publication) =>
            publication === 'xmltv' ? t`XMLTV guide` : t`M3U playlist`,
          )
          .join(', ');
        enqueueSnackbar({
          message: t`Channels were deleted, but publication failed for ${publications}. These files may be out of date.`,
          variant: 'warning',
        });
      }
    } finally {
      setPending(undefined);
      running.current = false;
      setBusy(false);
      onDone();
    }
  };

  return {
    busy,
    count: pending?.length ?? 0,
    named: pending ?? [],
    open: (channels: readonly NamedChannel[]) => {
      if (!running.current && channels.length > 0) {
        setPending(channels.map(({ id, name }) => ({ id, name })));
      }
    },
    dialogProps: {
      open: pending !== undefined,
      busy,
      closeOnConfirm: false,
      onClose: () => {
        if (!running.current) {
          setPending(undefined);
        }
      },
      onConfirm: () => {
        confirm().catch(console.error);
      },
    },
  };
}
