import {
  BaseErrorSchema,
  UpdateMediaSourceSettingsRequestSchema,
} from '@tunarr/types/api';
import { GlobalMediaSourceSettingsSchema } from '@tunarr/types/schemas';
import { rescheduleRescanJobs } from '../services/rescanSchedule.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.js';
import { registerSettingsAliases } from './settingsRoutes.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export const settingsApi: RouterPluginAsyncCallback = async (fastify) => {
  registerSettingsAliases(fastify, {
    '/settings/media-source': '/settings/media-source',
  });
  fastify.get(
    '/settings/media-source',
    {
      schema: {
        tags: ['Settings'],
        response: {
          200: GlobalMediaSourceSettingsSchema,
        },
      },
    },
    async (req, res) => {
      const settings = req.serverCtx.settings.globalMediaSourceSettings();
      return res.send(settings);
    },
  );

  fastify.put(
    '/settings/media-source',
    {
      schema: {
        tags: ['Settings'],
        body: UpdateMediaSourceSettingsRequestSchema,
        response: {
          200: GlobalMediaSourceSettingsSchema,
          400: BaseErrorSchema,
        },
      },
    },
    async (req, res) => {
      const current = req.serverCtx.settings.globalMediaSourceSettings();
      await req.serverCtx.settings.updateSettings('mediaSource', {
        ...current,
        ...req.body,
      });
      const settings = req.serverCtx.settings.globalMediaSourceSettings();
      // The scan and sync jobs are scheduled at startup; moving them to the
      // saved interval makes it take effect without a restart
      if (settings.rescanIntervalHours !== current.rescanIntervalHours) {
        rescheduleRescanJobs(settings.rescanIntervalHours);
      }
      return res.send(settings);
    },
  );
};
