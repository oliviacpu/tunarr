import type { ChannelOrm } from '@/db/schema/Channel.js';
import type { BaseHlsSession } from '@/stream/hls/BaseHlsSession.js';
import { HlsPlaylistCreator } from '@/stream/hls/HlsPlaylistCreator.js';
import type { HlsSession } from '@/stream/hls/HlsSession.js';
import { VideoStream } from '@/stream/VideoStream.js';
import type { Result } from '@/types/result.js';
import { TruthyQueryParam } from '@/types/schemas.js';
import type { RouterPluginAsyncCallback } from '@/types/serverType.js';
import type { Maybe } from '@/types/util.js';
import { fileExists } from '@/util/fsUtil.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { makeLocalUrl } from '@/util/serverUtil.js';
import fastifyStatic from '@fastify/static';
import type { StreamConnectionDetails } from '@tunarr/types/api';
import { ChannelStreamModeSchema } from '@tunarr/types/schemas';
import dayjs from 'dayjs';
import type { FastifyReply } from 'fastify';
import { isArray, isNil, isNumber, isUndefined } from 'lodash-es';
import fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { TuneInTimer } from '../stream/TuneInTimer.ts';
import { TuneInConnection } from '../stream/TuneInConnection.ts';
import type { ConcatSession } from '../stream/ConcatSession.ts';
import { format } from 'node:util';
import { v4 } from 'uuid';
import z from 'zod/v4';
import { markSegmentsForCaptions } from '../stream/captions/ProgramCaptions.ts';
import { container } from '../container.ts';

// Inject X-TIMESTAMP-MAP after the WEBVTT header line so AVPlayer/IINA
// can sync subtitle cue timestamps to the video MPEG-TS PTS clock.
// The constant MPEGTS:0 is correct because HlsSubtitleOutputFormat applies
// the same -output_ts_offset as the video output, keeping cue timestamps
// aligned with the 90kHz PTS timeline starting at 0.
export function injectTimestampMap(vttContent: string): string {
  return vttContent.replace(
    /^(WEBVTT[^\n]*)(\r?\n)/,
    '$1$2X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n',
  );
}

export const streamApi: RouterPluginAsyncCallback = async (fastify) => {
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'StreamApi',
  });

  fastify.addHook('onRoute', (routeOpts) => {
    if (!routeOpts.config) {
      routeOpts.config = {};
    }
    routeOpts.config.authRequired = false;
  });

  fastify.addHook('onError', (req, _, error, done) => {
    logger.error(
      error,
      '%s %s',
      isArray(req.routeOptions.method)
        ? req.routeOptions.method.join(', ')
        : req.routeOptions.method,
      req.routeOptions.url,
    );
    done();
  });

  await fastify.register(fastifyStatic, {
    // TODO: Is this even necessary anymore?
    root: join(process.cwd(), 'streams'),
    prefix: '/streams/',
    schemaHide: true,
    decorateReply: true,
  });

  fastify.get(
    '/stream/channels/:id',
    {
      schema: {
        tags: ['Streaming'],
        params: z.object({
          id: z.coerce.number().or(z.uuid()),
        }),
        querystring: z.object({
          streamMode: ChannelStreamModeSchema.optional(),
          token: z.uuid().optional(),
          audioOnly: TruthyQueryParam.optional().default(false),
        }),
      },
    },
    async (req, res) => {
      const channel = await req.serverCtx.channelDB.getChannel(req.params.id);
      if (isNil(channel)) {
        return res.status(404).send('Channel not found.');
      }

      const mode = req.query.streamMode ?? channel.streamMode;

      const params = new URLSearchParams();
      params.set('mode', mode);

      switch (mode) {
        case 'hls':
        case 'hls_slower':
        case 'hls_direct':
        case 'hls_direct_v2':
          return res.redirect(
            `/stream/channels/${channel.uuid}.m3u8?${params.toString()}`,
          );
        case 'mpegts':
          return res.redirect(
            `/stream/channels/${channel.uuid}.ts?${params.toString()}`,
          );
      }
    },
  );

  /**
   * Returns a continuous, direct MPEGTS video stream for the given channel
   */
  fastify.get(
    '/stream/channels/:id.ts',
    {
      schema: {
        tags: ['Streaming'],
        description:
          'Returns a continuous, direct MPEGTS video stream for the given channel',
        params: z.object({
          id: z.coerce.number().or(z.uuid()),
        }),
        querystring: z.object({
          streamMode: ChannelStreamModeSchema.optional(),
          token: z.uuid().optional(),
          audioOnly: TruthyQueryParam.optional().default(false),
        }),
      },
      onError(_req, _res, err, done) {
        logger.error(err);
        done();
      },
    },
    async (req, res) => {
      const timer = new TuneInTimer();
      const token = req.query.token ?? v4();
      const who = {
        channel: req.params.id,
        token,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };
      let session: ConcatSession | undefined;
      let handedOff = false;
      const tuneIn = new TuneInConnection(
        res.raw,
        () => {
          timer.mark('first byte');
          logger.info(
            {
              ...who,
              sessionId: session?.instanceId,
              underlyingSessionId: session?.underlyingSessionId,
            },
            'Tune-in: %s',
            timer.summary(),
          );
        },
        (reason, bytes) => {
          logger.info(
            { ...who, sessionId: session?.instanceId, reason, bytes },
            'Stream closed after %d ms%s',
            timer.elapsedMs(),
            timer.has('first byte') ? '' : ' (no byte was ever sent)',
          );
          if (
            reason === 'startup timeout' &&
            session &&
            session.numConnections() === 0
          ) {
            void req.serverCtx.sessionManager
              .endSessionInBackground(session)
              .catch((error: unknown) =>
                logger.error(error, 'Could not retire timed-out session'),
              );
          }
        },
      );
      try {
        const channel = await tuneIn.wait(
          req.serverCtx.channelDB.getChannel(req.params.id),
        );
        if (isNil(channel)) return res.status(404).send('Channel not found.');
        who.channel = channel.number;
        const lineup = await tuneIn.wait(
          req.serverCtx.channelDB.loadLineup(channel.uuid),
        );
        const mode = req.query.streamMode ?? channel.streamMode;
        const acquisition = req.serverCtx.sessionManager
          .getOrCreateConcatSession(
            channel.uuid,
            token,
            { ip: req.ip, userAgent: req.headers['user-agent'] },
            { audioOnly: req.query.audioOnly, sessionType: `${mode}_concat` },
          )
          .then((result) => {
            if (result.isSuccess()) {
              session = result.get();
              tuneIn.adopt(session, token);
              if (
                tuneIn.signal.aborted &&
                tuneIn.timedOut &&
                session.numConnections() === 0
              ) {
                void req.serverCtx.sessionManager
                  .endSessionInBackground(session)
                  .catch((error: unknown) =>
                    logger.error(error, 'Could not retire timed-out session'),
                  );
              }
            }
            return result;
          });
        const sessionResult = await tuneIn.wait(acquisition);
        if (sessionResult.isFailure()) {
          logger.warn(
            { ...who, error: sessionResult.error },
            'Tune-in failed after %d ms, no byte was sent',
            timer.elapsedMs(),
          );
          return res
            .status(sessionResult.error.httpCode)
            .send('Unable to start session');
        }
        timer.mark('session');
        if (lineup.onDemandConfig) {
          await tuneIn.wait(
            req.serverCtx.onDemandChannelService.resumeChannel(channel.uuid),
          );
        }
        // The wrapper fetches HLS through this server: wait for output only after releasing the channel lock.
        const piped = await tuneIn.attach();
        handedOff = true;
        return res.header('Content-Type', 'video/mp2t').send(piped);
      } catch (error) {
        logger.warn(
          { ...who, error },
          'Tune-in failed after %d ms',
          timer.elapsedMs(),
        );
        if (res.raw.destroyed) return res;
        return res
          .status(tuneIn.timedOut ? 504 : 500)
          .send('Unable to start stream');
      } finally {
        if (!handedOff) tuneIn.close('startup failed');
      }
    },
  );

  /**
   * Initiates an audio only stream for the given channel
   */
  fastify.get(
    '/stream/channels/:id/radio.ts',
    {
      schema: {
        hide: true,
        params: z.object({
          id: z.coerce.number().or(z.string().uuid()),
        }),
        querystring: z.object({
          streamMode: ChannelStreamModeSchema.optional(),
          token: z.string().uuid().optional(),
        }),
      },
    },
    async (req, res) => {
      return res.redirect(
        makeLocalUrl(`/stream/channels/${req.params.id}.ts`, {
          audioOnly: true,
          ...req.query,
        }),
      );
    },
  );

  fastify.get(
    '/stream/channels/:id/:sessionType/:file',
    {
      schema: {
        hide: true,
        params: z.object({
          sessionType: ChannelStreamModeSchema.refine(
            (typ) => typ !== 'mpegts',
          ),
          id: z.uuid(),
          file: z.string(),
        }),
        querystring: z.object({
          captions: TruthyQueryParam.optional().default(false),
        }),
      },
      config: {
        disableRequestLogging: 'only-errors',
      },
    },
    async (req, res) => {
      let session: Maybe<BaseHlsSession>;
      switch (req.params.sessionType) {
        case 'hls':
        case 'hls_direct_v2':
          session = req.serverCtx.sessionManager.getHlsSession(
            req.params.id,
            req.params.sessionType,
          );
          break;
        case 'hls_slower':
          session = req.serverCtx.sessionManager.getHlsSlowerSession(
            req.params.id,
          );
          break;
        default:
          return res
            .status(400)
            .send(
              `Invalid sesssion type for fragment file serving: ${req.params.sessionType}`,
            );
      }

      // A stopping session holds its lock until ffmpeg exits, so requests to
      // it would block. Fail fast so the client re-tunes to its replacement.
      if (isUndefined(session) || session.stoppingOrStopped) {
        return res.status(404).send('No session found');
      }

      if (!session.isKnownConnection(req.ip)) {
        session.addConnection(req.ip, {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
      session.recordHeartbeat(req.ip);

      if (
        req.params.file === 'stream.m3u8' &&
        (req.params.sessionType === 'hls' ||
          req.params.sessionType === 'hls_direct_v2')
      ) {
        const playlistResult = await (session as HlsSession).trimPlaylist();
        if (playlistResult.isFailure()) {
          logger.error(playlistResult.error);
          return res.status(500).send('Error retrieving variant playlist');
        }
        const playlist = playlistResult.get();
        if (!playlist) {
          return res.status(404).send('Variant playlist not found');
        }
        return res
          .type('application/vnd.apple.mpegurl')
          .send(playlist.playlist);
      }

      if (
        req.params.file === 'subs.m3u8' &&
        (req.params.sessionType === 'hls' ||
          req.params.sessionType === 'hls_direct_v2')
      ) {
        const playlistResult = await (
          session as HlsSession
        ).trimSubtitlePlaylist();
        if (playlistResult.isFailure()) {
          logger.error(playlistResult.error);
          return res.status(500).send('Error retrieving subtitle playlist');
        }
        const playlist = playlistResult.get();
        if (!playlist) {
          return res.status(404).send('Subtitle playlist not found');
        }
        return res
          .type('application/vnd.apple.mpegurl')
          .send(playlist.playlist);
      }

      const filePath = resolve(session.workingDirectory, req.params.file);
      if (!filePath.startsWith(session.workingDirectory + sep)) {
        return res.status(400).send('Invalid file path');
      }

      // A request for a missing segment must not move this client's position.
      // Otherwise its next playlist is built around segments that are gone.
      if (!(await fileExists(filePath))) {
        return res.status(404).send('File not found');
      }

      session.onSegmentRequested(req.ip, req.params.file);

      if (req.params.file.endsWith('.vtt')) {
        const content = await fs.readFile(filePath, 'utf-8');
        return res.type('text/vtt').send(injectTimestampMap(content));
      }

      if (req.params.file.endsWith('.m3u8')) {
        const content = await fs.readFile(filePath);
        return res.type('application/vnd.apple.mpegurl').send(content);
      }

      // The HDHomeRun .ts stream's segments, with CEA-608 captions added
      if (
        req.query.captions &&
        req.params.sessionType === 'hls' &&
        req.params.file.endsWith('.ts')
      ) {
        const captioned = await (session as HlsSession)
          .captionedSegment(req.params.file)
          .catch((e: unknown) => {
            logger.warn(e, 'Could not caption segment %s', req.params.file);
            return undefined;
          });
        if (captioned) {
          return res.type('video/mp2t').send(captioned);
        }
      }

      return res.sendFile(req.params.file, session.workingDirectory);
    },
  );

  fastify.route({
    url: '/stream/channels/:id.m3u8',
    method: ['HEAD', 'GET'],
    config: {
      disableRequestLogging: 'only-errors',
    },
    schema: {
      tags: ['Streaming'],
      description:
        'Returns an m3u8 playlist for the given channel, for use in HLS',
      params: z.object({
        id: z.uuid().or(z.coerce.number()),
      }),
      querystring: z.object({
        mode: ChannelStreamModeSchema.optional(),
        variant: TruthyQueryParam.optional()
          .default(false)
          .describe(
            'For hls and hls_direct_v2, return the variant playlist instead of the master. The .ts wrapper uses this so ffmpeg reads only the muxed streams.',
          ),
        captions: TruthyQueryParam.optional()
          .default(false)
          .describe(
            'With variant, mark the segments so they are served with CEA-608 captions. The .ts wrapper uses this when HDHomeRun closed captions are on, the channel has subtitles enabled, and its transcode config outputs H.264.',
          ),
      }),
    },
    handler: async (req, res) => {
      const connectionDetails: StreamConnectionDetails = {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };

      let channel: Maybe<ChannelOrm>;
      let channelId: string;
      if (isNumber(req.params.id)) {
        channel = await req.serverCtx.channelDB.getChannel(req.params.id);
        if (isNil(channel)) {
          return res.status(404).send('Channel not found.');
        }
        channelId = channel.uuid;
      } else {
        channelId = req.params.id;
      }

      let mode = req.query.mode;
      if (isUndefined(mode)) {
        channel ??= await req.serverCtx.channelDB.getChannel(req.params.id);
        if (isNil(channel)) {
          return res.status(404).send('Channel not found.');
        }
        mode = channel.streamMode;
      }

      let sessionResult: Result<FastifyReply>;
      switch (mode) {
        case 'hls':
        case 'hls_direct_v2':
          sessionResult = await req.serverCtx.sessionManager
            .getOrCreateHlsSession(channelId, req.ip, connectionDetails, {
              streamMode: mode,
            })
            .then((result) =>
              result.mapAsync(async (session) => {
                session.recordHeartbeat(req.ip);

                if (req.query.variant) {
                  const variantResult = await session.trimPlaylist();
                  if (variantResult.isFailure()) {
                    throw new Error(
                      'Error retrieving HLS variant playlist for playback',
                      { cause: variantResult.error },
                    );
                  }

                  const variant = variantResult.get();
                  if (!variant) {
                    throw new Error(
                      format(
                        'No variant playlist found for channel %s. This could mean the stream is not ready.',
                        channelId,
                      ),
                    );
                  }

                  return res
                    .type('application/vnd.apple.mpegurl')
                    .send(
                      req.query.captions
                        ? markSegmentsForCaptions(variant.playlist)
                        : variant.playlist,
                    );
                }

                const masterResult = await session.getMasterPlaylist();

                if (masterResult.isFailure()) {
                  logger.error(masterResult.error);
                  throw new Error(
                    'Error retrieving HLS master playlist for playback',
                    { cause: masterResult.error },
                  );
                }

                const masterPlaylist = masterResult.get();

                if (!masterPlaylist) {
                  const fmtError = format(
                    'No master playlist found for channel %s at path %s. This could mean the stream is not ready.',
                    channelId,
                    session.masterPlaylistPath,
                  );
                  logger.error(fmtError);
                  throw new Error(fmtError);
                }

                return res
                  .type('application/vnd.apple.mpegurl')
                  .send(masterPlaylist);
              }),
            );

          break;
        case 'hls_slower':
          sessionResult = await req.serverCtx.sessionManager
            .getOrCreateHlsSlowerSession(
              channelId,
              req.ip,
              connectionDetails,
              {},
            )
            .then((result) =>
              result.mapAsync(async (session) => {
                session.recordHeartbeat(req.ip);
                const playlist = await fs.readFile(session.streamPath);
                return res.type('application/vnd.apple.mpegurl').send(playlist);
              }),
            );
          break;
        case 'hls_direct': {
          const ffmpegSettings = req.serverCtx.settings.ffmpegSettings();
          const playlist = await new HlsPlaylistCreator(
            req.serverCtx.streamProgramCalculator,
          ).createPlaylist(channelId, dayjs(), {
            protocol: req.protocol,
            host: req.host,
            channelIdOrNumber: channelId,
            streamMode: mode,
            outputFormat: ffmpegSettings.hlsDirectOutputFormat,
          });
          return res.type('application/vnd.apple.mpegurl').send(playlist);
        }
        case 'mpegts':
          return res.status(400).send();
      }

      if (sessionResult.isFailure()) {
        logger.error(sessionResult.error);
      }

      return sessionResult.getOrElse(() => {
        return res.status(500).send('Error starting or retrieving session');
      });
    },
  });

  /**
   * Returns a finite MPEG-TS stream for a single lineup item, identified by
   * the epoch ms timestamp when that item started playing (`t`).
   * Designed for native clients (tvOS, Android TV) using AVQueuePlayer /
   * ConcatenatingMediaSource for gapless, item-by-item playback.
   */
  fastify.get(
    '/stream/channels/:id/item-stream.ts',
    {
      schema: {
        tags: ['Native'],
        description:
          'Returns a finite MPEG-TS stream for the single lineup item that started at time t (epoch ms). Stream closes cleanly at EOF when the item ends.',
        params: z.object({
          id: z.uuid(),
        }),
        querystring: z.object({
          t: z.coerce.number().int(),
        }),
      },
    },
    async (req, res) => {
      const channel = await req.serverCtx.channelDB.getChannel(req.params.id);
      if (isNil(channel)) {
        return res.status(404).send('Channel not found.');
      }

      const videoStream = container.get(VideoStream);
      const itemStartedAtMs = req.query.t;

      // Use the current wall-clock time so the stream begins at the live
      // position (current seek offset) rather than replaying from the item's
      // beginning. `itemStartedAtMs` identifies which item the client expects;
      // if a different item is now playing, startStream will stream that one
      // and the client will detect the mismatch when the queue expires.
      const now = Date.now();

      const rawStreamResult = await videoStream.startStream(
        {
          channel: req.params.id,
          audioOnly: false,
          streamMode: 'mpegts',
          encoding: { mode: 'remux' },
        },
        now,
        false,
      );

      if (rawStreamResult.type === 'error') {
        logger.error(
          rawStreamResult.error ?? null,
          'Error starting item stream for channel %s at t=%d: %s',
          req.params.id,
          itemStartedAtMs,
          rawStreamResult.message,
        );
        return res
          .status(rawStreamResult.httpStatus)
          .send(rawStreamResult.message);
      }

      req.raw.on('close', () => {
        logger.debug(
          { channel: req.params.id, t: itemStartedAtMs },
          'Native item stream client disconnected, stopping stream.',
        );
        rawStreamResult.stop();
      });

      return res
        .header('Content-Type', 'video/mp2t')
        .send(rawStreamResult.stream);
    },
  );
};
