import type { RouterPluginCallback } from '@/types/serverType.js';
import { makeWritable } from '@/util/index.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { sanitizeForExec } from '@/util/strings.js';
import {
  BaseErrorSchema,
  IdPathParamSchema,
  UpdateFfmpegSettingsRequestSchema,
} from '@tunarr/types/api';
import {
  FfmpegSettingsSchema,
  TranscodeConfigSchema,
} from '@tunarr/types/schemas';
import { isError, map } from 'lodash-es';
import { match, P } from 'ts-pattern';
import { z } from 'zod/v4';
import { transcodeConfigOrmToDto } from '../db/converters/transcodeConfigConverters.ts';
import { GlobalScheduler } from '../services/Scheduler.ts';
import { SubtitleExtractorTask } from '../tasks/SubtitleExtractorTask.ts';
import { TranscodeConfigNotFoundError } from '../types/errors.ts';
import { registerSettingsAliases } from './settingsRoutes.ts';

export const ffmpegSettingsRouter: RouterPluginCallback = (
  fastify,
  _opts,
  done,
) => {
  registerSettingsAliases(fastify, { '/ffmpeg-settings': '/settings/ffmpeg' });
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'FfmpegSettingsApi',
  });

  fastify.get(
    '/ffmpeg-settings',
    {
      schema: {
        tags: ['Settings'],
        response: {
          200: FfmpegSettingsSchema,
          500: BaseErrorSchema,
        },
      },
    },
    async (req, res) => {
      try {
        const ffmpeg = req.serverCtx.settings.ffmpegSettings();
        return res.send(makeWritable(ffmpeg));
      } catch (err) {
        logger.error(err);
        return res
          .status(500)
          .send({ message: 'Could not process FFmpeg settings' });
      }
    },
  );

  fastify.put(
    '/ffmpeg-settings',
    {
      schema: {
        tags: ['Settings'],
        body: UpdateFfmpegSettingsRequestSchema,
        response: {
          200: FfmpegSettingsSchema,
          400: BaseErrorSchema,
          500: BaseErrorSchema,
        },
      },
    },
    async (req, res) => {
      try {
        const currentSettings = req.serverCtx.settings.ffmpegSettings();
        const newSettings = {
          ...makeWritable(currentSettings),
          ...req.body,
          languagePreferences: {
            ...makeWritable(currentSettings.languagePreferences),
            ...req.body.languagePreferences,
          },
          hdhrCaptionAppearance: {
            ...currentSettings.hdhrCaptionAppearance,
            ...req.body.hdhrCaptionAppearance,
          },
        };
        newSettings.ffmpegExecutablePath = sanitizeForExec(
          newSettings.ffmpegExecutablePath,
        );
        newSettings.ffprobeExecutablePath = sanitizeForExec(
          newSettings.ffprobeExecutablePath,
        );

        await req.serverCtx.settings.updateSettings('ffmpeg', newSettings);
        const ffmpeg = req.serverCtx.settings.ffmpegSettings();

        if (
          !currentSettings.enableSubtitleExtraction &&
          req.body.enableSubtitleExtraction
        ) {
          GlobalScheduler.runScheduledJobNow(
            SubtitleExtractorTask.ID,
            true,
          ).catch((e) => {
            logger.error(
              e,
              'Error running SubtitleExtractorTask after settings change',
            );
          });
        }

        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'FFMPEG configuration updated.',
          module: 'ffmpeg',
          detail: {
            action: 'update',
          },
          level: 'info',
        });
        return res.send(makeWritable(ffmpeg));
      } catch (err) {
        logger.error(err);
        await res
          .status(500)
          .send({ message: 'Could not process FFmpeg settings' });
        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'Error updating FFMPEG configuration.',
          module: 'ffmpeg',
          detail: {
            action: 'update',
            error: isError(err) ? err.message : 'unknown',
          },
          level: 'error',
        });
      }
    },
  );

  fastify.get(
    '/transcode_configs',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        response: {
          200: z.array(TranscodeConfigSchema),
        },
      },
    },
    async (req, res) => {
      const configs = await req.serverCtx.transcodeConfigDB.getAll();
      const apiConfigs = map(configs, transcodeConfigOrmToDto);
      return res.send(apiConfigs);
    },
  );

  fastify.get(
    '/transcode_configs/:id',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: TranscodeConfigSchema,
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const config = await req.serverCtx.transcodeConfigDB.getById(
        req.params.id,
      );
      if (!config) {
        return res.status(404).send();
      }

      return res.send(transcodeConfigOrmToDto(config));
    },
  );

  fastify.post(
    '/transcode_configs/:id/copy',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        params: z.object({
          id: z.uuid(),
        }),
        response: {
          200: TranscodeConfigSchema,
          404: z.void(),
          500: z.void(),
        },
      },
    },
    async (req, res) => {
      const copyResult = await req.serverCtx.transcodeConfigDB.duplicateConfig(
        req.params.id,
      );

      if (copyResult.isFailure()) {
        logger.error(copyResult.error);
        return match(copyResult.error)
          .with(P.instanceOf(TranscodeConfigNotFoundError), () =>
            res.status(404).send(),
          )
          .with(P._, () => res.status(500).send())
          .exhaustive();
      }

      return res.send(transcodeConfigOrmToDto(copyResult.get()));
    },
  );

  fastify.post(
    '/transcode_configs',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        body: TranscodeConfigSchema.omit({
          id: true,
        }),
        response: {
          201: TranscodeConfigSchema,
        },
      },
    },
    async (req, res) => {
      const newConfig = await req.serverCtx.transcodeConfigDB.insertConfig(
        req.body,
      );
      return res.status(201).send(transcodeConfigOrmToDto(newConfig));
    },
  );

  fastify.put(
    '/transcode_configs/:id',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        body: TranscodeConfigSchema,
        params: IdPathParamSchema,
        response: {
          200: TranscodeConfigSchema,
        },
      },
    },
    async (req, res) => {
      await req.serverCtx.transcodeConfigDB.updateConfig(
        req.params.id,
        req.body,
      );
      return res.send(req.body);
    },
  );

  fastify.delete(
    '/transcode_configs/:id',
    {
      schema: {
        tags: ['Settings', 'Transcode Configs'],
        params: IdPathParamSchema,
        response: {
          200: z.void(),
          404: z.void(),
        },
      },
    },
    async (req, res) => {
      const config = await req.serverCtx.transcodeConfigDB.getById(
        req.params.id,
      );
      if (!config) {
        return res.status(404).send();
      }
      req.serverCtx.transcodeConfigDB.deleteConfig(req.params.id);
      return res.send();
    },
  );

  done();
};
