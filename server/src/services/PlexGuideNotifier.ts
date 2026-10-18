import { MediaSourceDB } from '@/db/mediaSourceDB.js';
import { MediaSourceApiFactory } from '@/external/MediaSourceApiFactory.js';
import { InjectLogger } from '@/util/inject.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import { inject, injectable, LazyServiceIdentifier } from 'inversify';

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
 * An ask that fails (Plex restarting, a 503 while it runs maintenance) is
 * retried a few times before it is given up and logged.
 */
@injectable()
export class PlexGuideNotifier {
  static readonly DebounceMs = 10_000;
  static readonly Retries = 3;
  static readonly RetryDelayMs = 5_000;

  @InjectLogger() declare private readonly logger: Logger;

  #listening = false;
  #pending = false;
  #timer?: NodeJS.Timeout;
  #inFlight?: Promise<void>;
  #waiters: (() => void)[] = [];

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

  /** Resolves once no ask is pending or running (at once when there is none). */
  flush(): Promise<void> {
    if (!this.#pending && !this.#inFlight) {
      return Promise.resolve();
    }
    if (this.#pending && this.#timer && this.#listening) {
      // Don't make a caller wait out the debounce window.
      this.#schedule(0);
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #schedule(ms: number) {
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#fire();
    }, ms);
    this.#timer.unref?.();
  }

  #fire() {
    if (!this.#listening) {
      this.logger.debug(
        'Guide changed before the server listens; Plex will be asked once it does',
      );
      return;
    }
    if (this.#inFlight) {
      // Ask again when the running one is done, so Plex sees the newest file.
      this.#inFlight.finally(() => this.#schedule(0)).catch(() => {});
      return;
    }
    this.#pending = false;
    this.#inFlight = this.#notify()
      .catch((err) => this.logger.error(err, 'Plex guide notify failed'))
      .finally(() => {
        this.#inFlight = undefined;
        if (!this.#pending) {
          const waiters = this.#waiters;
          this.#waiters = [];
          for (const w of waiters) w();
        }
      });
  }

  async #notify() {
    const plexServers = await this.mediaSourceDB.findByType('plex');
    for (const plexServer of plexServers) {
      if (!plexServer.sendGuideUpdates) {
        continue;
      }
      const plex =
        await this.mediaSourceApiFactory.getPlexApiClientForMediaSource(
          plexServer,
        );
      for (let attempt = 1; attempt <= PlexGuideNotifier.Retries; attempt++) {
        try {
          const dvrs = await plex.getDvrs();
          if (dvrs.length === 0) {
            break;
          }
          await plex.refreshGuide(dvrs);
          this.logger.info(
            'Asked Plex %s to reload its guide',
            plexServer.name,
          );
          break;
        } catch (err) {
          if (attempt === PlexGuideNotifier.Retries) {
            this.logger.error(
              err,
              `Couldn't tell Plex ${plexServer.name} to refresh guide after ${attempt} tries. Its guide stays as it was until the next guide write. This is NOT related to playback issues.`,
            );
          } else {
            this.logger.warn(
              `Couldn't tell Plex ${plexServer.name} to refresh guide (%s); trying again in %d s`,
              err instanceof Error ? err.message : String(err),
              PlexGuideNotifier.RetryDelayMs / 1000,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, PlexGuideNotifier.RetryDelayMs),
            );
          }
        }
      }
    }
  }
}
