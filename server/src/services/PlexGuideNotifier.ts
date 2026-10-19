import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import type { MediaSourceWithRelations } from '@/db/schema/derivedTypes.js';
import { QueryError } from '@/external/BaseApiClient.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import type { PlexApiClient } from '@/external/plex/PlexApiClient.js';
import { InjectLogger } from '@/util/inject.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import { inject, injectable, LazyServiceIdentifier } from 'inversify';
import { z } from 'zod/v4';

export const PlexGuideAskOutcomeSchema = z.enum([
  // Plex took the ask.
  'reloaded',
  // Plex has no DVR (no Live TV), so there is no guide to reload.
  'no_live_tv',
  // Plex refused the token (401/403). Not retried: the same token gets the same answer.
  'auth_failed',
  // Every try failed, or no client could be made for the server.
  'failed',
  // Not answered yet when the flush returned (still trying, or the server is shutting down).
  'pending',
]);

export type PlexGuideAskOutcome = z.infer<typeof PlexGuideAskOutcomeSchema>;

export const PlexGuideFlushResultSchema = z.object({
  /**
   * True when nothing was left: no guide write, pending ask or running ask.
   * False when the flush stopped waiting after `FlushTimeoutMs`, or the server
   * is shutting down.
   */
  done: z.boolean(),
  /** Each Plex server asked since the flush began, with how its latest ask ended. */
  servers: z.array(
    z.object({ name: z.string(), outcome: PlexGuideAskOutcomeSchema }),
  ),
});

export type PlexGuideFlushResult = z.infer<typeof PlexGuideFlushResultSchema>;

/**
 * Plex refused the token (401/403): asking again with the same token cannot
 * help. getDvrs and refreshGuide both reject with the client's classified
 * `QueryError`, so the 401/403 rule lives in `BaseApiClient.requestErrorResult`.
 */
export function isPlexAuthError(err: unknown): boolean {
  return QueryError.isQueryError(err) && err.type === 'auth_error';
}

/**
 * The status `POST /api/xmltv/flush` answers with: 200 when everything
 * finished, as before the wait was bounded, and 202 when the flush stopped
 * waiting and something is still under way.
 */
export function flushResponseStatus(result: PlexGuideFlushResult): 200 | 202 {
  return result.done ? 200 : 202;
}

/**
 * Asks Plex to reload its guide after the XMLTV file changed, in a way Plex
 * can act on.
 *
 * Plex re-reads the guide only when asked (`POST /livetv/dvrs/<id>/reloadGuide`;
 * its own refresh is daily). Asking straight from the XMLTV task went wrong in
 * two ways on a real deployment:
 *
 * - The startup guide task runs before the HTTP server listens, so Plex's
 *   download of the guide failed ("failed to download XMLTV data … connection
 *   refused") and nothing asked again until the next scheduled write, hours
 *   later. Here, a request made before `markListening()` waits for it.
 * - Saving six channels in a row wrote the guide six times and asked Plex six
 *   times in nine seconds. Plex acted on the first ask and ignored the rest,
 *   so it showed a half-written lineup for hours. Here, requests within
 *   `DebounceMs` of each other collapse into one ask after the last one.
 *
 * Every Plex server is asked at the same time, each on its own, so one that
 * fails or is slow to answer never keeps the others waiting. An ask that fails (Plex restarting, a 503 while it
 * runs maintenance) is tried `Retries` times, waiting longer after each
 * failure (`retryDelayMs`), before it is given up and logged. A refused token
 * (401/403) is not retried: it is logged once, with a hint to check the token.
 */
@injectable()
export class PlexGuideNotifier {
  static readonly DebounceMs = 10_000;
  static readonly Retries = 3;
  /**
   * The wait after the first failed try. Each later wait is `RetryBackoff`
   * times longer, up to `MaxRetryDelayMs`. With 3 tries the waits are 5 s and
   * 15 s; the cap matters only if `Retries` is raised.
   */
  static readonly RetryDelayMs = 5_000;
  static readonly RetryBackoff = 3;
  static readonly MaxRetryDelayMs = 45_000;
  /** The longest a `flush()` waits before it answers with what is done so far. */
  static readonly FlushTimeoutMs = 30_000;

  /** The wait before the next try, after try number `attempt` (1-based) failed. */
  static retryDelayMs(attempt: number): number {
    return Math.min(
      PlexGuideNotifier.RetryDelayMs *
        PlexGuideNotifier.RetryBackoff ** Math.max(0, attempt - 1),
      PlexGuideNotifier.MaxRetryDelayMs,
    );
  }

  @InjectLogger() declare private readonly logger: Logger;

  #listening = false;
  #stopped = false;
  #pending = false;
  #writes = 0;
  #timer?: NodeJS.Timeout;
  #inFlight?: Promise<void>;
  #waiters: ((done: boolean) => void)[] = [];
  /** The latest ask run; `#outcomes` entries carry the run that set them. */
  #run = 0;
  #outcomes = new Map<
    string,
    { run: number; name: string; outcome: PlexGuideAskOutcome }
  >();
  /** Each server's retry wait under way (servers are asked at the same time). */
  #retryWaits = new Set<{ timer: NodeJS.Timeout; end: () => void }>();

  constructor(
    @inject(MediaSourceDB) private mediaSourceDB: MediaSourceDB,
    @inject(new LazyServiceIdentifier(() => MediaSourceApiFactory))
    private mediaSourceApiFactory: MediaSourceApiFactory,
  ) {}

  /** The HTTP server accepts connections: Plex can download the guide now. */
  markListening() {
    this.#listening = true;
    if (this.#pending && !this.#timer) {
      this.#schedule(0);
    }
  }

  get listening() {
    return this.#listening;
  }

  /** The guide file changed. Plex is asked once, `DebounceMs` after the last request. */
  requestRefresh() {
    this.#pending = true;
    this.#schedule(PlexGuideNotifier.DebounceMs);
  }

  /**
   * A guide write is under way (UpdateXmlTvTask). A channel save starts that
   * task without awaiting it, so a flush right after the save must wait for
   * the write, and then for the ask the write ends with.
   */
  writeStarted() {
    this.#writes++;
  }

  writeFinished() {
    this.#writes = Math.max(0, this.#writes - 1);
    if (this.#writes === 0 && this.#pending) {
      // An ask deferred by this write: at once when someone is flushing, else after the usual quiet spell.
      this.#schedule(
        this.#waiters.length > 0 ? 0 : PlexGuideNotifier.DebounceMs,
      );
    }
    this.#settle();
  }

  get idle() {
    return this.#writes === 0 && !this.#pending && !this.#inFlight;
  }

  /**
   * Resolves once no guide write, pending ask or running ask is left (at once
   * when there is none), or after `timeoutMs`, whichever comes first. The
   * result names each Plex server asked meanwhile and how its ask ended; what
   * was still left when the wait ran out is logged.
   */
  flush(
    timeoutMs: number = PlexGuideNotifier.FlushTimeoutMs,
  ): Promise<PlexGuideFlushResult> {
    // A run already going counts: the flush waits for it too.
    const since = this.#inFlight ? this.#run : this.#run + 1;
    if (this.idle || this.#stopped) {
      return Promise.resolve(this.#summary(since, this.idle));
    }
    if (this.#pending && this.#timer && this.#listening && this.#writes === 0) {
      // Don't make a caller wait out the debounce window. While a write is
      // under way the ask waits for it (writeFinished fires it at once).
      this.#schedule(0);
    }
    return new Promise((resolve) => {
      const waiter = (done: boolean) => {
        clearTimeout(timeout);
        resolve(this.#summary(since, done));
      };
      const timeout = setTimeout(() => {
        this.#waiters = this.#waiters.filter((w) => w !== waiter);
        this.logger.warn(
          'Stopped waiting for the Plex guide ask after %d s; still left: %s',
          timeoutMs / 1000,
          this.#describeLeft(since).join('; '),
        );
        waiter(false);
      }, timeoutMs);
      timeout.unref();
      this.#waiters.push(waiter);
    });
  }

  /**
   * The server is shutting down: no new ask starts, a retry waiting for its
   * turn is dropped, and a flush still waiting answers at once (not done).
   */
  stop() {
    this.#stopped = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    for (const wait of this.#retryWaits) {
      clearTimeout(wait.timer);
      // Ends the wait, so its ask sees #stopped and returns.
      wait.end();
    }
    this.#retryWaits.clear();
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const w of waiters) w(false);
  }

  #summary(since: number, done: boolean): PlexGuideFlushResult {
    const servers: PlexGuideFlushResult['servers'] = [];
    for (const { run, name, outcome } of this.#outcomes.values()) {
      if (run >= since) {
        servers.push({ name, outcome });
      }
    }
    return { done, servers };
  }

  #describeLeft(since: number): string[] {
    const left: string[] = [];
    if (this.#writes > 0) {
      left.push(`${this.#writes} guide write(s) under way`);
    }
    if (this.#pending) {
      left.push(
        this.#listening
          ? 'an ask not yet sent'
          : 'an ask waiting for the server to listen',
      );
    }
    let serversLeft = 0;
    for (const { name, outcome } of this.#summary(since, false).servers) {
      if (outcome === 'pending') {
        left.push(`Plex ${name} has not answered`);
        serversLeft++;
      }
    }
    if (this.#inFlight && serversLeft === 0) {
      // Still listing the Plex servers, or about to start the next one.
      left.push('an ask under way');
    }
    return left;
  }

  #settle() {
    if (!this.idle) {
      return;
    }
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const w of waiters) w(true);
  }

  #schedule(ms: number) {
    if (this.#stopped) {
      return;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#fire();
    }, ms);
    this.#timer.unref();
  }

  #fire() {
    if (this.#stopped) {
      return;
    }
    if (!this.#listening) {
      this.logger.debug(
        'Guide changed before the server listens; Plex will be asked once it does',
      );
      return;
    }
    if (this.#writes > 0) {
      // A later write is still going: asking now would have Plex read a guide
      // about to change, and the ask for the new one could be dropped while
      // Plex is busy. writeFinished schedules the ask.
      return;
    }
    if (this.#inFlight) {
      // Ask again when the running one is done, so Plex sees the newest file.
      this.#inFlight.finally(() => this.#schedule(0)).catch(() => {});
      return;
    }
    this.#pending = false;
    this.#inFlight = this.#notify(++this.#run)
      .catch((err) => this.logger.error(err, 'Plex guide notify failed'))
      .finally(() => {
        this.#inFlight = undefined;
        this.#settle();
      });
  }

  async #notify(run: number) {
    const plexServers = (await this.mediaSourceDB.findByType('plex')).filter(
      (server) => server.sendGuideUpdates,
    );
    for (const server of plexServers) {
      this.#outcomes.set(server.uuid, {
        run,
        name: server.name,
        outcome: 'pending',
      });
    }
    if (this.#stopped) {
      return;
    }
    // Every server at once: one that is slow to answer (up to 60 s a request,
    // three tries) or fails, whatever the failure, never holds up the others.
    await Promise.all(
      plexServers.map(async (server) => {
        const outcome = await this.#ask(server).catch((err: unknown) => {
          this.logger.error(
            err,
            "Couldn't tell Plex %s to refresh guide",
            server.name,
          );
          return 'failed' as const;
        });
        this.#outcomes.set(server.uuid, { run, name: server.name, outcome });
      }),
    );
  }

  async #ask(server: MediaSourceWithRelations): Promise<PlexGuideAskOutcome> {
    if (server.accessToken === '') {
      // The client would throw on every try; no retry can fix a missing token.
      this.logger.warn(
        'Plex %s has no token, so it was not asked to refresh guide: sign in to media source %s again.',
        server.name,
        server.name,
      );
      return 'auth_failed';
    }
    let plex: PlexApiClient;
    try {
      plex =
        await this.mediaSourceApiFactory.getPlexApiClientForMediaSource(server);
    } catch (err) {
      this.logger.error(
        err,
        "Couldn't set up a client for Plex %s, so it was not asked to refresh guide. Its guide stays as it was until the next guide write.",
        server.name,
      );
      return 'failed';
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const dvrs = await plex.getDvrs();
        if (dvrs.length === 0) {
          return 'no_live_tv';
        }
        await plex.refreshGuide(dvrs);
        this.logger.info('Asked Plex %s to reload its guide', server.name);
        return 'reloaded';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isPlexAuthError(err)) {
          this.logger.warn(
            'Plex %s refused the guide refresh (%s): check the Plex token for media source %s. Its guide stays as it was until the next guide write.',
            server.name,
            message,
            server.name,
          );
          return 'auth_failed';
        }
        if (attempt >= PlexGuideNotifier.Retries) {
          this.logger.error(
            err,
            "Couldn't tell Plex %s to refresh guide after %d tries. Its guide stays as it was until the next guide write. This is NOT related to playback issues.",
            server.name,
            attempt,
          );
          return 'failed';
        }
        if (this.#stopped) {
          // stop() came while this try was under way: no timer, no next try.
          return 'pending';
        }
        const delayMs = PlexGuideNotifier.retryDelayMs(attempt);
        this.logger.warn(
          "Couldn't tell Plex %s to refresh guide (%s); trying again in %d s",
          server.name,
          message,
          delayMs / 1000,
        );
        await this.#waitToRetry(delayMs);
        if (this.#stopped) {
          return 'pending';
        }
      }
    }
  }

  /** Waits `ms`, or until `stop()`. The timer never keeps the process alive. */
  #waitToRetry(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wait = {
        end: resolve,
        timer: setTimeout(() => {
          this.#retryWaits.delete(wait);
          resolve();
        }, ms),
      };
      wait.timer.unref();
      this.#retryWaits.add(wait);
    });
  }
}
