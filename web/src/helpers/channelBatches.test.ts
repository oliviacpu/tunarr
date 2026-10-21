import type { BulkChannelStealthResponse } from '@tunarr/types/api';
import { describe, expect, test, vi } from 'vitest';
import { runChannelBatches } from './channelBatches.ts';

const channels = Array.from({ length: 205 }, (_, index) => ({
  id: `channel-${index}`,
  name: `Channel ${index}`,
}));

function success(ids: string[]): BulkChannelStealthResponse {
  return {
    results: ids.map((id) => ({ id, success: true })),
    refresh: { xmltv: 'succeeded', m3u: 'succeeded' },
  };
}

describe('runChannelBatches', () => {
  test('splits over 100 channels into sequential requests and snapshots the selection', async () => {
    const selection = [...channels];
    let finishFirst:
      | ((response: BulkChannelStealthResponse) => void)
      | undefined;
    const send =
      vi.fn<(ids: string[]) => Promise<BulkChannelStealthResponse>>();
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    send.mockImplementation(async (ids) => success(ids));
    const running = runChannelBatches(selection, send);
    selection.splice(0, selection.length);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      channels.slice(0, 100).map(({ id }) => id),
    );
    if (finishFirst === undefined) throw new Error('first batch did not start');
    finishFirst(success(channels.slice(0, 100).map(({ id }) => id)));
    const outcome = await running;
    expect(send.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 5]);
    expect(outcome).toEqual({
      succeeded: channels,
      failed: [],
      unknown: [],
      unattempted: [],
      publicationFailures: [],
    });
  });

  test('aggregates ordered mixed failures and publication failures across all batches', async () => {
    const send = vi.fn(
      async (ids: string[]): Promise<BulkChannelStealthResponse> => ({
        results: ids.map((id) =>
          id === 'channel-3' || id === 'channel-201'
            ? {
                id,
                success: false,
                statusCode: 404,
                message: 'Channel not found',
              }
            : { id, success: true },
        ),
        refresh: {
          xmltv: 'failed',
          m3u: ids.includes('channel-101') ? 'failed' : 'succeeded',
        },
      }),
    );
    const outcome = await runChannelBatches(channels, send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(outcome.succeeded).toEqual(
      channels.filter(({ id }) => id !== 'channel-3' && id !== 'channel-201'),
    );
    expect(outcome.failed).toEqual([
      { item: channels[3], reason: 'Channel not found' },
      { item: channels[201], reason: 'Channel not found' },
    ]);
    expect(outcome.publicationFailures).toEqual(['xmltv', 'm3u']);
    expect(outcome.unknown).toEqual([]);
    expect(outcome.unattempted).toEqual([]);
  });

  test('a lost second response retains confirmed results, stops, and never retries', async () => {
    const first = success(channels.slice(0, 100).map(({ id }) => id));
    first.results[2] = {
      id: 'channel-2',
      success: false,
      statusCode: 500,
      message: 'Write failed',
    };
    first.refresh.m3u = 'failed';
    const send = vi
      .fn<(ids: string[]) => Promise<BulkChannelStealthResponse>>()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('Response lost'));
    const outcome = await runChannelBatches(channels, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outcome.succeeded).toEqual(
      channels.slice(0, 100).filter(({ id }) => id !== 'channel-2'),
    );
    expect(outcome.failed).toEqual([
      { item: channels[2], reason: 'Write failed' },
    ]);
    expect(outcome.unknown).toEqual(channels.slice(100, 200));
    expect(outcome.unattempted).toEqual(channels.slice(200));
    expect(outcome.publicationFailures).toEqual(['m3u']);
  });

  test.each(['missing', 'extra', 'wrong', 'reordered', 'duplicate'])(
    'treats %s response IDs as unknown rather than inventing a result',
    async (mismatch) => {
      const selection = channels.slice(0, 101);
      const send = vi.fn(async (ids: string[]) => {
        const response = success(ids);
        if (mismatch === 'missing') response.results.pop();
        if (mismatch === 'extra')
          response.results.push({ id: 'extra', success: true });
        if (mismatch === 'wrong')
          response.results[0] = { id: 'wrong', success: true };
        if (mismatch === 'reordered') response.results.reverse();
        if (mismatch === 'duplicate')
          response.results[0] = { id: 'channel-1', success: true };
        return response;
      });
      expect(await runChannelBatches(selection, send)).toEqual({
        succeeded: [],
        failed: [],
        unknown: selection.slice(0, 100),
        unattempted: selection.slice(100),
        publicationFailures: [],
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );

  test('nothing selected sends no request', async () => {
    const send = vi.fn();
    expect(await runChannelBatches([], send)).toEqual({
      succeeded: [],
      failed: [],
      unknown: [],
      unattempted: [],
      publicationFailures: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('not-needed publication and per-item failure do not stop later batches', async () => {
    const send = vi.fn(
      async (ids: string[]): Promise<BulkChannelStealthResponse> => ({
        results: ids.map((id) => ({
          id,
          success: false,
          statusCode: 500,
          message: 'Write failed',
        })),
        refresh: { xmltv: 'not_needed', m3u: 'not_needed' },
      }),
    );
    const outcome = await runChannelBatches(channels, send);
    expect(outcome.succeeded).toEqual([]);
    expect(outcome.failed).toHaveLength(205);
    expect(outcome.publicationFailures).toEqual([]);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
