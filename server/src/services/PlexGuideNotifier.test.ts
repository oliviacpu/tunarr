import type { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { QueryError } from '@/external/BaseApiClient.js';
import type { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import type { PlexApiClient } from '@/external/plex/PlexApiClient.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import {
  flushResponseStatus,
  isPlexAuthError,
  PlexGuideNotifier,
} from './PlexGuideNotifier.ts';

type Calls = { getDvrs: number; refreshGuide: number };

type ServerSpec = {
  sendGuideUpdates?: boolean;
  accessToken?: string;
  /** The first this-many tries fail (a 503 unless `failWith` says otherwise). */
  failFirst?: number;
  failWith?: unknown;
  /** Which call fails. */
  failOn?: 'getDvrs' | 'refreshGuide';
  /** Making the server's client throws. */
  lookupThrows?: boolean;
  /** The DVR lookup never answers. */
  hangs?: boolean;
  /** The DVR lookup fails, this long after it was made. */
  failsAfterMs?: number;
};

function serverName(i: number) {
  return i === 0 ? 'Plex' : `Plex ${i + 1}`;
}

function setup(...specs: ServerSpec[]) {
  if (specs.length === 0) {
    specs = [{}];
  }
  const calls: Calls[] = specs.map(() => ({ getDvrs: 0, refreshGuide: 0 }));
  const sources = specs.map((spec, i) => ({
    uuid: `plex-${i}`,
    name: serverName(i),
    sendGuideUpdates: spec.sendGuideUpdates ?? true,
    accessToken: spec.accessToken ?? 'token',
  }));
  const clients = specs.map((spec, i) => {
    let failuresLeft = spec.failFirst ?? 0;
    const fail = (on: 'getDvrs' | 'refreshGuide') => {
      if ((spec.failOn ?? 'getDvrs') !== on || failuresLeft === 0) {
        return undefined;
      }
      failuresLeft--;
      return Promise.reject(spec.failWith ?? new Error('503 Maintenance'));
    };
    return {
      getDvrs: () => {
        calls[i].getDvrs++;
        if (spec.hangs) {
          return new Promise(() => {});
        }
        const { failsAfterMs } = spec;
        if (failsAfterMs !== undefined) {
          return new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('503 Maintenance')),
              failsAfterMs,
            ),
          );
        }
        return fail('getDvrs') ?? Promise.resolve([{ key: '4' }]);
      },
      refreshGuide: () => {
        calls[i].refreshGuide++;
        return fail('refreshGuide') ?? Promise.resolve();
      },
    } as unknown as PlexApiClient;
  });
  const db: { findByType: () => Promise<unknown> } = {
    findByType: () => Promise.resolve(sources),
  };
  const factory = {
    getPlexApiClientForMediaSource: (source: { uuid: string }) => {
      const i = sources.findIndex((s) => s.uuid === source.uuid);
      if (specs[i].lookupThrows) {
        return Promise.reject(new Error('no client for this server'));
      }
      return Promise.resolve(clients[i]);
    },
  } as unknown as MediaSourceApiFactory;
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const notifier = new PlexGuideNotifier(
    db as unknown as MediaSourceDB,
    factory,
  );
  (notifier as unknown as { logger: Logger }).logger =
    logger as unknown as Logger;
  return { calls: calls[0], allCalls: calls, notifier, logger, db };
}

// The total wait between the first try and the last.
const AllRetryWaitsMs = Array.from(
  { length: PlexGuideNotifier.Retries - 1 },
  (_, i) => PlexGuideNotifier.retryDelayMs(i + 1),
).reduce((a, b) => a + b, 0);

// Lets the promise chain behind a fired timer run to completion.
async function settle() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

describe('PlexGuideNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('asks Plex once, DebounceMs after the last of a burst of requests', async () => {
    const { calls, notifier } = setup();
    notifier.markListening();
    for (let i = 0; i < 6; i++) {
      notifier.requestRefresh();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(calls.refreshGuide).toBe(0);
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.refreshGuide).toBe(1);
  });

  test('a request before the server listens waits for markListening', async () => {
    const { calls, notifier } = setup();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs * 3);
    expect(calls.refreshGuide).toBe(0);
    notifier.markListening();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(calls.refreshGuide).toBe(1);
  });

  test('retries a failed ask', async () => {
    const { calls, notifier } = setup({ failFirst: 2 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.refreshGuide).toBe(0);
    await vi.advanceTimersByTimeAsync(AllRetryWaitsMs);
    await settle();
    expect(calls.getDvrs).toBe(3);
    expect(calls.refreshGuide).toBe(1);
  });

  test('waits longer after each failure: 5 s, then 15 s', async () => {
    // The wait was a fixed 5 s, so a Plex restarting got all three tries within ten seconds.
    const { calls, notifier, logger } = setup({ failFirst: 2 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.getDvrs).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(calls.getDvrs).toBe(2);

    // 5 s after the second failure is not enough any more.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(calls.getDvrs).toBe(2);

    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(calls.getDvrs).toBe(3);
    expect(calls.refreshGuide).toBe(1);
    expect(logger.warn.mock.calls.map((call) => call.at(-1))).toEqual([5, 15]);
  });

  test('the retry wait grows threefold up to MaxRetryDelayMs', () => {
    expect(
      [1, 2, 3, 4, 10].map((attempt) =>
        PlexGuideNotifier.retryDelayMs(attempt),
      ),
    ).toEqual([5_000, 15_000, 45_000, 45_000, 45_000]);
  });

  test('gives up after Retries failed asks', async () => {
    const { calls, notifier, logger } = setup({ failFirst: 10 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await vi.advanceTimersByTimeAsync(AllRetryWaitsMs);
    await settle();
    expect(calls.getDvrs).toBe(PlexGuideNotifier.Retries);
    expect(calls.refreshGuide).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.MaxRetryDelayMs * 3);
    await settle();
    expect(calls.getDvrs).toBe(PlexGuideNotifier.Retries);
  });

  // The Plex client rejects both calls with a classified QueryError (PlexApiClient.test.ts).
  test.each([
    ['401 from the DVR lookup', 401, 'getDvrs'],
    ['403 from the DVR lookup', 403, 'getDvrs'],
    ['401 from the reload', 401, 'refreshGuide'],
    ['403 from the reload', 403, 'refreshGuide'],
  ] as const)(
    'a refused token (%s) is not retried, logs one hint, and the next server is still asked',
    async (_, status, failOn) => {
      // A 401/403 was retried like a 503, three tries and three log lines for a token that can't work.
      const error = QueryError.create(
        'auth_error',
        `Request failed with status code ${status}`,
      );
      const { allCalls, notifier, logger } = setup(
        { failFirst: 10, failWith: error, failOn },
        {},
      );
      notifier.markListening();
      notifier.requestRefresh();
      await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
      await settle();

      // The next server is asked at once, not after the retry waits.
      expect(allCalls[1].refreshGuide).toBe(1);

      await vi.advanceTimersByTimeAsync(AllRetryWaitsMs * 2);
      await settle();
      expect(allCalls[0].getDvrs).toBe(1);
      expect(allCalls[0].refreshGuide).toBe(failOn === 'refreshGuide' ? 1 : 0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('check the Plex token for media source %s'),
        'Plex',
        `Request failed with status code ${status}`,
        'Plex',
      );
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test('isPlexAuthError tells a refused token from other failures', () => {
    expect(isPlexAuthError(QueryError.create('auth_error'))).toBe(true);
    expect(isPlexAuthError(QueryError.genericQueryError('503'))).toBe(false);
    expect(isPlexAuthError(QueryError.create('not_found'))).toBe(false);
    expect(isPlexAuthError(new Error('401'))).toBe(false);
  });

  test('a Plex server without a token is not tried, and the next server is still asked', async () => {
    // The client threw a plain Error on every try, so a missing token got three tries and an error line.
    const { allCalls, notifier, logger } = setup({ accessToken: '' }, {});
    notifier.markListening();
    notifier.requestRefresh();
    const flushing = notifier.flush();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(allCalls[0].getDvrs).toBe(0);
    expect(allCalls[1].refreshGuide).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('has no token'),
      'Plex',
      'Plex',
    );
    expect(await flushing).toEqual({
      done: true,
      servers: [
        { name: 'Plex', outcome: 'auth_failed' },
        { name: 'Plex 2', outcome: 'reloaded' },
      ],
    });
  });

  test('a log line keeps its arguments in place whatever the server is called', async () => {
    // The name was part of the format string, so a '%s' in it took the next argument's place.
    const { notifier, logger } = setup({ failFirst: 1 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(logger.warn).toHaveBeenCalledWith(
      "Couldn't tell Plex %s to refresh guide (%s); trying again in %d s",
      'Plex',
      '503 Maintenance',
      5,
    );
  });

  test("one server's client lookup throwing doesn't keep the next from being asked", async () => {
    // The throw used to end the whole ask, so every Plex server after it was skipped.
    const { allCalls, notifier, logger } = setup({ lookupThrows: true }, {});
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(allCalls[0].getDvrs).toBe(0);
    expect(allCalls[1].refreshGuide).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][1])).toContain('Plex');
    expect(await notifier.flush()).toEqual({ done: true, servers: [] });
  });

  test('skips a Plex server that does not want guide updates', async () => {
    const { calls, notifier } = setup({ sendGuideUpdates: false });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.getDvrs).toBe(0);
  });

  test('flush resolves after the pending ask, without waiting out the debounce', async () => {
    const { calls, notifier } = setup();
    notifier.markListening();
    notifier.requestRefresh();
    let flushed = false;
    const flushing = notifier.flush().then((result) => {
      flushed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(await flushing).toEqual({
      done: true,
      servers: [{ name: 'Plex', outcome: 'reloaded' }],
    });
    expect(flushed).toBe(true);
    expect(calls.refreshGuide).toBe(1);
  });

  test('flush stops waiting after FlushTimeoutMs and names the server that has not answered', async () => {
    // A Plex that never answered held the flush (and its HTTP request) for minutes per server.
    const { allCalls, notifier, logger } = setup({}, { hangs: true });
    notifier.markListening();
    notifier.requestRefresh();
    let result: Awaited<ReturnType<PlexGuideNotifier['flush']>> | undefined;
    void notifier.flush().then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.FlushTimeoutMs - 1);
    await settle();
    expect(allCalls[0].refreshGuide).toBe(1);
    expect(allCalls[1].getDvrs).toBe(1);
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(result).toEqual({
      done: false,
      servers: [
        { name: 'Plex', outcome: 'reloaded' },
        { name: 'Plex 2', outcome: 'pending' },
      ],
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][2])).toContain(
      'Plex Plex 2 has not answered',
    );
  });

  test("a server that never answers doesn't hold up the next one", async () => {
    // Servers were asked one after another, so one that timed out (60 s a request, three tries) kept the
    // next waiting for minutes.
    const { allCalls, notifier } = setup({ hangs: true }, {});
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(allCalls[0].getDvrs).toBe(1);
    expect(allCalls[1].refreshGuide).toBe(1);
  });

  test('a flush that stops waiting before any server is reached still says what is left', async () => {
    // With no server named yet, the warning ended in "still left: " and nothing after it.
    const { notifier, logger, db } = setup();
    db.findByType = () => new Promise(() => {});
    notifier.markListening();
    notifier.requestRefresh();
    const flushing = notifier.flush();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.FlushTimeoutMs);
    await settle();
    expect(await flushing).toEqual({ done: false, servers: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('still left'),
      PlexGuideNotifier.FlushTimeoutMs / 1000,
      'an ask under way',
    );
  });

  test('the flush route answers 200 when everything finished and 202 when it stopped waiting', () => {
    // A caller that checks only the status must not take a flush that gave up for a finished one.
    expect(flushResponseStatus({ done: true, servers: [] })).toBe(200);
    expect(
      flushResponseStatus({
        done: false,
        servers: [{ name: 'Plex', outcome: 'pending' }],
      }),
    ).toBe(202);
  });

  test('flush waits for a guide write under way, then for the ask it ends with', async () => {
    const { calls, notifier } = setup();
    notifier.markListening();
    notifier.writeStarted();
    let flushed = false;
    const flushing = notifier.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs * 2);
    await settle();
    expect(flushed).toBe(false);
    expect(calls.refreshGuide).toBe(0);
    notifier.requestRefresh();
    notifier.writeFinished();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    await flushing;
    expect(flushed).toBe(true);
    expect(calls.refreshGuide).toBe(1);
  });

  test('an ask is deferred while a later write is under way', async () => {
    const { calls, notifier } = setup();
    notifier.markListening();
    notifier.writeStarted(); // channel 1
    notifier.requestRefresh();
    notifier.writeFinished();
    notifier.writeStarted(); // channel 2, still writing when the debounce fires
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs * 2);
    await settle();
    expect(calls.refreshGuide).toBe(0);
    notifier.requestRefresh();
    notifier.writeFinished();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.refreshGuide).toBe(1);
  });

  test('flush during a write does not expedite the ask past the write', async () => {
    const { calls, notifier } = setup();
    notifier.markListening();
    notifier.requestRefresh(); // an earlier write's ask, pending
    notifier.writeStarted(); // a later write
    let flushed = false;
    const flushing = notifier.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(calls.refreshGuide).toBe(0);
    expect(flushed).toBe(false);
    notifier.requestRefresh();
    notifier.writeFinished(); // a flusher is waiting: the ask goes out at once
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    await flushing;
    expect(calls.refreshGuide).toBe(1);
    expect(flushed).toBe(true);
  });

  test('flush resolves at once when nothing is pending', async () => {
    const { notifier } = setup();
    await expect(notifier.flush()).resolves.toEqual({
      done: true,
      servers: [],
    });
  });

  test('stop drops a retry waiting for its turn; its timer never holds the process open', async () => {
    // The retry wait was a plain setTimeout: it kept the process alive and fired after shutdown.
    // Two servers, so two retry waits are under way at once.
    const { allCalls, notifier } = setup({ failFirst: 10 }, { failFirst: 10 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      notifier.markListening();
      notifier.requestRefresh();
      await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
      await settle();
      expect(allCalls.map((c) => c.getDvrs)).toEqual([1, 1]);

      const retryWaits = setTimeoutSpy.mock.results.filter(
        (_, i) =>
          setTimeoutSpy.mock.calls[i][1] === PlexGuideNotifier.retryDelayMs(1),
      );
      expect(retryWaits).toHaveLength(2);
      for (const wait of retryWaits) {
        expect((wait.value as NodeJS.Timeout).hasRef()).toBe(false);
      }

      let result: Awaited<ReturnType<PlexGuideNotifier['flush']>> | undefined;
      void notifier.flush().then((r) => {
        result = r;
      });
      notifier.stop();
      await settle();
      expect(vi.getTimerCount()).toBe(0);
      // A flush still waiting answers at once.
      expect(result).toEqual({
        done: false,
        servers: [
          { name: 'Plex', outcome: 'pending' },
          { name: 'Plex 2', outcome: 'pending' },
        ],
      });

      await vi.advanceTimersByTimeAsync(PlexGuideNotifier.MaxRetryDelayMs * 3);
      await settle();
      expect(allCalls.map((c) => c.getDvrs)).toEqual([1, 1]);

      // Nothing new starts after stop.
      notifier.requestRefresh();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('a try that fails after stop is not tried again', async () => {
    const { calls, notifier, logger } = setup({ failsAfterMs: 1_000 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await settle();
    expect(calls.getDvrs).toBe(1);

    notifier.stop(); // while the lookup is under way
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    // No retry timer was started, and no "trying again" line was logged.
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.MaxRetryDelayMs * 3);
    await settle();
    expect(calls.getDvrs).toBe(1);
  });
});
