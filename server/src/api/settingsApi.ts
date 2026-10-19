import { BaseErrorSchema } from '@tunarr/types/api';
import { GlobalMediaSourceSettingsSchema } from '@tunarr/types/schemas';
import {
  rescanIntervalProblem,
  rescheduleRescanJobs,
} from '../services/rescanSchedule.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const settingsApi: RouterPluginAsyncCallback = async (fastify) => {
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
        body: GlobalMediaSourceSettingsSchema,
        response: {
          200: GlobalMediaSourceSettingsSchema,
          400: BaseErrorSchema,
        },
      },
    },
    async (req, res) => {
      // Saved, an interval the scheduler can't run would stop the scans now
      // and break job scheduling at the next startup
      const problem = rescanIntervalProblem(req.body.rescanIntervalHours);
      if (problem !== undefined) {
        return res.status(400).send({ message: problem });
      }
      await req.serverCtx.settings.updateSettings('mediaSource', req.body);
      const settings = req.serverCtx.settings.globalMediaSourceSettings();
      // The scan and sync jobs are scheduled at startup; moving them to the
      // saved interval makes it take effect without a restart
      rescheduleRescanJobs(settings.rescanIntervalHours);
      return res.send(settings);
    },
  );
};
