import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { FfmpegTranscodeSession } from '@/ffmpeg/FfmpegTrancodeSession.js';
import type { ChannelConcatStreamMode } from '@tunarr/types/schemas';
import { isEmpty } from 'lodash-es';
import type { PassThrough } from 'node:stream';
import type { ConcatStreamFactory } from './ConcatStream.ts';
import { DirectStreamSession } from './DirectStreamSession.js';
import type { SessionOptions } from './Session.js';

export type ConcatSessionOptions = SessionOptions & {
  sessionType: ChannelConcatStreamMode;
  audioOnly: boolean;
};

export type ConcatSessionFactory = (
  channel: ChannelOrmWithTranscodeConfig,
  options: ConcatSessionOptions,
) => ConcatSession;

export class ConcatSession extends DirectStreamSession<ConcatSessionOptions> {
  #transcodeSession?: FfmpegTranscodeSession;
  #outputSink?: PassThrough;

  constructor(
    channel: ChannelOrmWithTranscodeConfig,
    options: ConcatSessionOptions,
    private concatStreamFactory: ConcatStreamFactory,
  ) {
    super(channel, options);
    this.on('removeConnection', () => {
      if (isEmpty(this.connections())) {
        this.scheduleCleanup();
      }
    });
  }

  isStale(): boolean {
    return isEmpty(this.connections());
  }

  get sessionType() {
    return this.sessionOptions.sessionType;
  }

  protected async initializeStream(): Promise<FfmpegTranscodeSession> {
    const concatStream = this.concatStreamFactory(
      this.channel,
      this.sessionOptions.sessionType,
    );
    this.#outputSink = concatStream.outputSink();
    this.#transcodeSession = await concatStream.createSession();

    this.#transcodeSession.on('error', (e) => this.emit('error', e));
    this.#transcodeSession.on('exit', () => this.emit('end'));

    return Promise.resolve(this.#transcodeSession);
  }

  protected override outputSink(): PassThrough | undefined {
    return this.#outputSink;
  }

  protected stopStream(): Promise<void> {
    this.#transcodeSession?.kill();
    return Promise.resolve(void 0);
  }
}
