import { bulkSetChannelStealth } from '@/generated/sdk.gen.ts';
import { runChannelBatches } from '@/helpers/channelBatches.ts';
import { useToasts, withReason } from '@/strings/actions.ts';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { BulkChannelStealthResponseSchema } from '@tunarr/types/api';
import { useSnackbar } from 'notistack';
import { useRef, useState } from 'react';

type NamedChannel = { id: string; name: string };

export function useBulkChannelStealth(onDone: () => void) {
  const { t } = useLingui();
  const toasts = useToasts();
  const { enqueueSnackbar } = useSnackbar();
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

  const run = async (channels: readonly NamedChannel[], stealth: boolean) => {
    if (running.current || channels.length === 0) {
      return;
    }
    const snapshot = channels.map(({ id, name }) => ({ id, name }));
    running.current = true;
    setBusy(true);
    try {
      const outcome = await runChannelBatches(snapshot, async (ids) => {
        const { data } = await bulkSetChannelStealth({
          body: { ids, stealth },
          throwOnError: true,
        });
        return BulkChannelStealthResponseSchema.parse(data);
      });
      const done = outcome.succeeded.length;
      const total = snapshot.length;
      const complete =
        outcome.failed.length === 0 && outcome.unknown.length === 0;
      const messages = [
        complete
          ? toasts.saved
          : outcome.unknown.length > 0
            ? t`${done} of ${total} confirmed saved`
            : t`${done} of ${total} saved`,
      ];
      const listed = outcome.failed.slice(0, 3).map(({ item, reason }) => {
        const name = item.name;
        return withReason(t`could not save ${name}`, reason);
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
          t`Outcome unknown for ${names}. Changes may have been saved. Refreshing channels to check; no automatic retry.`,
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
      if (outcome.publicationFailures.length > 0) {
        const publications = outcome.publicationFailures
          .map((publication) =>
            publication === 'xmltv' ? t`XMLTV guide` : t`M3U playlist`,
          )
          .join(', ');
        enqueueSnackbar({
          message: t`Channel changes were saved, but publication failed for ${publications}. These files may be out of date.`,
          variant: 'warning',
        });
      }
    } finally {
      onDone();
      running.current = false;
      setBusy(false);
    }
  };

  return { busy, run };
}
