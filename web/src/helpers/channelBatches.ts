import type { BulkChannelStealthResponse } from '@tunarr/types/api';

export const ChannelBatchSize = 100;

export type ChannelBatchOutcome<T> = {
  succeeded: T[];
  failed: { item: T; reason: string }[];
  unknown: T[];
  unattempted: T[];
  publicationFailures: ('xmltv' | 'm3u')[];
};

/** Stops after an unconfirmed response: replaying a mutation is unsafe. */
export async function runChannelBatches<T extends { id: string }>(
  items: readonly T[],
  send: (ids: string[]) => Promise<BulkChannelStealthResponse>,
): Promise<ChannelBatchOutcome<T>> {
  const snapshot = [...items];
  const outcome: ChannelBatchOutcome<T> = {
    succeeded: [],
    failed: [],
    unknown: [],
    unattempted: [],
    publicationFailures: [],
  };

  for (let offset = 0; offset < snapshot.length; offset += ChannelBatchSize) {
    const batch = snapshot.slice(offset, offset + ChannelBatchSize);
    try {
      const response = await send(batch.map((item) => item.id));
      if (
        response.results.length !== batch.length ||
        response.results.some((result, index) => result.id !== batch[index]?.id)
      ) {
        throw new Error('Channel batch response did not match the request');
      }
      response.results.forEach((result, index) => {
        const item = batch[index];
        if (item === undefined) {
          return;
        }
        if (result.success) {
          outcome.succeeded.push(item);
        } else {
          outcome.failed.push({ item, reason: result.message });
        }
      });
      for (const publication of ['xmltv', 'm3u'] as const) {
        if (
          response.refresh[publication] === 'failed' &&
          !outcome.publicationFailures.includes(publication)
        ) {
          outcome.publicationFailures.push(publication);
        }
      }
    } catch {
      outcome.unknown = batch;
      outcome.unattempted = snapshot.slice(offset + ChannelBatchSize);
      break;
    }
  }
  return outcome;
}
