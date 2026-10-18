import type { MediaSourceDB } from '@/db/mediaSourceDB.js';
import type { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import type { PlexApiClient } from '@/external/plex/PlexApiClient.js';
import { PlexGuideNotifier } from './PlexGuideNotifier.ts';

type Calls = { getDvrs: number; refreshGuide: number };

function setup(opts: { failFirst?: number; sendGuideUpdates?: boolean } = {}) {
  const calls: Calls = { getDvrs: 0, refreshGuide: 0 };
  let failuresLeft = opts.failFirst ?? 0;
  const plex = {
    getDvrs: () => {
      calls.getDvrs++;
      if (failuresLeft > 0) {
        failuresLeft--;
        return Promise.reject(new Error('503 Maintenance'));
      }
      return Promise.resolve([{ key: '4' }]);
    },
    refreshGuide: () => {
      calls.refreshGuide++;
      return Promise.resolve();
    },
  } as unknown as PlexApiClient;
  const db = {
    findByType: () =>
      Promise.resolve([
        { name: 'Plex', sendGuideUpdates: opts.sendGuideUpdates ?? true },
      ]),
  } as unknown as MediaSourceDB;
  const factory = {
    getPlexApiClientForMediaSource: () => Promise.resolve(plex),
  } as unknown as MediaSourceApiFactory;
  return { calls, notifier: new PlexGuideNotifier(db, factory) };
}

// Lets the promise chain behind a fired timer run to completion.
async function settle() {
  for (let i = 0; i < 10; i++) {
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
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.RetryDelayMs * 2);
    await settle();
    expect(calls.getDvrs).toBe(3);
    expect(calls.refreshGuide).toBe(1);
  });

  test('gives up after Retries failed asks', async () => {
    const { calls, notifier } = setup({ failFirst: 10 });
    notifier.markListening();
    notifier.requestRefresh();
    await vi.advanceTimersByTimeAsync(PlexGuideNotifier.DebounceMs);
    await vi.advanceTimersByTimeAsync(
      PlexGuideNotifier.RetryDelayMs * PlexGuideNotifier.Retries,
    );
    await settle();
    expect(calls.getDvrs).toBe(PlexGuideNotifier.Retries);
    expect(calls.refreshGuide).toBe(0);
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
    const flushing = notifier.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    await flushing;
    expect(flushed).toBe(true);
    expect(calls.refreshGuide).toBe(1);
  });

  test('flush resolves at once when nothing is pending', async () => {
    const { notifier } = setup();
    await expect(notifier.flush()).resolves.toBeUndefined();
  });
});
