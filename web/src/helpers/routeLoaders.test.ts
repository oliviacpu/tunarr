import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, test, vi } from 'vitest';
import {
  preloadChannelAndProgramming,
  preloadCustomShowAndProgramming,
  preloadFillerAndProgramming,
} from './routeLoaders.ts';

const statusError = (status: number) =>
  new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    { headers: new AxiosHeaders() },
    undefined,
    {
      data: '',
      status,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );

// A query client whose every fetch fails with the given error
function failingClient(error: unknown) {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'ensureQueryData').mockRejectedValue(error);
  return queryClient;
}

const loaders = [
  [
    'channel',
    (queryClient: QueryClient) =>
      preloadChannelAndProgramming({
        params: { channelId: 'missing' },
        context: { queryClient },
      }),
  ],
  [
    'filler list',
    (queryClient: QueryClient) =>
      preloadFillerAndProgramming({
        params: { fillerId: 'missing' },
        context: { queryClient },
      }),
  ],
  [
    'custom show',
    (queryClient: QueryClient) =>
      preloadCustomShowAndProgramming({
        params: { showId: 'missing' },
        context: { queryClient },
      }),
  ],
] as const;

describe.each(loaders)('the %s loader', (_, load) => {
  test.each([404, 400])(
    'throws notFound() when the server answers %d',
    async (status) => {
      const thrown = await load(failingClient(statusError(status))).catch(
        (e: unknown) => e,
      );

      expect(isNotFound(thrown)).toBe(true);
    },
  );

  test('passes any other failure on to the error page', async () => {
    const serverError = statusError(500);

    const thrown = await load(failingClient(serverError)).catch(
      (e: unknown) => e,
    );

    expect(thrown).toBe(serverError);
  });
});
