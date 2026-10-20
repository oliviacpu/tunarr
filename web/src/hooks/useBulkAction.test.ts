import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, test } from 'vitest';
import { settleEach } from './useBulkAction.ts';

describe('settleEach', () => {
  test('runs every item and splits successes from failures in order', async () => {
    const outcome = await settleEach(['a', 'b', 'c', 'd'], (item) =>
      item === 'b' || item === 'd'
        ? Promise.reject(new Error(`no ${item}`))
        : Promise.resolve(item),
    );

    expect(outcome.succeeded).toEqual(['a', 'c']);
    expect(outcome.failed).toEqual([
      { item: 'b', reason: 'no b' },
      { item: 'd', reason: 'no d' },
    ]);
  });

  test('one failure does not stop the others', async () => {
    const ran: string[] = [];
    const outcome = await settleEach(['a', 'b', 'c'], async (item) => {
      ran.push(item);
      if (item === 'a') {
        throw new Error('first one fails');
      }
    });

    expect(ran).toEqual(['a', 'b', 'c']);
    expect(outcome.succeeded).toEqual(['b', 'c']);
  });

  test("prefers the server's message as the reason", async () => {
    const error = new AxiosError(
      'Request failed with status code 400',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { message: 'body/icon/path must be a string' },
      },
    );

    const outcome = await settleEach(['x'], () => Promise.reject(error));

    expect(outcome.failed).toEqual([
      { item: 'x', reason: 'body/icon/path must be a string' },
    ]);
  });

  test('nothing to run is an empty outcome', async () => {
    expect(await settleEach([], () => Promise.resolve())).toEqual({
      succeeded: [],
      failed: [],
    });
  });
});
