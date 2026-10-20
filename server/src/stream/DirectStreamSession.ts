import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import type { PassThrough, Readable } from 'node:stream';
import { caughtErrorToError } from '../util/index.ts';
import type { SessionOptions } from './Session.js';
import { Session } from './Session.js';
import { CountingPassThrough } from './TuneInTimer.ts';

/**
 * Base class for a shared stream session where all participants share
 * the same underlying {@link Readable} stream.
 */
export abstract class DirectStreamSession<
  TOpts extends SessionOptions = SessionOptions,
> extends Session<TOpts> {
  #stream?: Readable;

  protected constructor(channel: ChannelOrmWithTranscodeConfig, opts: TOpts) {
    super(channel, opts);
  }

  /**
   * End this shared session. This will stop the stream for all
   * participants.
   */
  protected stopInternal() {
    return new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        this.stopStream()
          .catch((e) => {
            this.logger.error(e, 'Error while cleaning up stream session');
            this.state = 'error';
            reject(caughtErrorToError(e));
          })
          .finally(() => {
            // Session.stop() marks the session stopped once this resolves.
            this.emit('stop');
            resolve(void 0);
          });
      });
    });
  }

  get rawStream() {
    return this.#stream;
  }

  protected abstract stopStream(): Promise<void>;

  protected async startInternal() {
    const start = performance.now();

    const streamInitResult = await this.initializeStream();

    const sink = this.outputSink();
    const output = streamInitResult.start(sink);
    this.#stream = output.pipe(
      new CountingPassThrough(() => {
        this.logger.debug(
          'Stream first output after %d ms',
          Math.round(performance.now() - start),
        );
      }),
    );

    return Promise.resolve(void 0);
  }

  protected abstract initializeStream(): Promise<FfmpegTranscodeSession>;

  // The stream the transcode's output is piped through, after initializeStream
  protected outputSink(): PassThrough | undefined {
    return;
  }
}

type StreamReadyErrorResult = {
  type: 'error';
  error?: Error;
};

type StreamReadySuccessResult = {
  type: 'success';
};

export type StreamReadyResult =
  | StreamReadySuccessResult
  | StreamReadyErrorResult;
