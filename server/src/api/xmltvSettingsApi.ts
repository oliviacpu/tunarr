import { defaultXmlTvSettings } from '@/db/SettingsDB.js';
import { serverOptions } from '@/globals.js';
import { GlobalScheduler } from '@/services/Scheduler.js';
import { UpdateXmlTvTask } from '@/tasks/UpdateXmlTvTask.js';
import type { RouterPluginCallback } from '@/types/serverType.js';
import { LoggerFactory } from '@/util/logging/LoggerFactory.js';
import { xmlTvRefreshCrontab } from '@/util/schedulingUtil.js';
import { minimumXmlTvGuideHours } from '@tunarr/shared/util';
import { BaseErrorSchema } from '@tunarr/types/api';
import { XmlTvSettingsSchema } from '@tunarr/types/schemas';
import { isError, isUndefined } from 'lodash-es';
import { z } from 'zod/v4';

/**
 * Declared field by field rather than as `XmlTvSettingsSchema.partial()`.
 * `.partial()` wraps a field's `.default()` instead of removing it, so a key
 * the client omitted still arrived populated with that default — a PUT with an
 * empty body came through as the full default settings object. The handler
 * could not distinguish "omitted" from "sent" and reset everything it was not
 * given.
 *
 * `outputPath` is accepted but ignored: it is server-owned and deliberately
 * read-only in the UI.
 */
const UpdateXmlTvSettingsRequestSchema = z.object({
  programmingHours: z.number().optional(),
  refreshHours: z.number().optional(),
  refreshStartHour: z.number().int().min(0).max(23).optional(),
  outputPath: z.string().optional(),
  enableImageCache: z.boolean().optional(),
  useShowPoster: z.boolean().optional(),
  publicUrl: z.url().or(z.literal('')).optional(),
});

/**
 * Why a save would leave the guide empty before the next rebuild, or
 * undefined. Each scheduled rebuild writes `programmingHours` of guide and
 * nothing adds to it before the next one (`minimumXmlTvGuideHours`).
 */
function xmlTvRefreshProblem(settings: {
  refreshHours: number;
  programmingHours: number;
}): string | undefined {
  const minimum = minimumXmlTvGuideHours(settings.refreshHours);
  if (settings.programmingHours < minimum) {
    return (
      `Guide length is ${settings.programmingHours} hours, too short for a ` +
      `${settings.refreshHours}-hour refresh interval: the guide would run out ` +
      `before the next rebuild. It has to be at least ${minimum} hours, ` +
      `two hours longer than the time between rebuilds, since that wait is up to two hours ` +
      `longer on the night the clocks go back.`
    );
  }
  return;
}

// The schedule is built at startup; a save moves it to the new refresh hours
// and start hour, then rebuilds the guide once, now, as a save always has
async function rescheduleAndRebuild(settings: {
  refreshHours: number;
  refreshStartHour: number;
  programmingHours: number;
}) {
  const job = GlobalScheduler.getScheduledJob(UpdateXmlTvTask.ID);
  job.reschedule(xmlTvRefreshCrontab(settings));
  await job.runNow(false);
}

export const xmlTvSettingsRouter: RouterPluginCallback = (
  fastify,
  _opts,
  done,
) => {
  const logger = LoggerFactory.child({
    caller: import.meta,
    className: 'XmlTvSettingsRouter',
  });

  fastify.get(
    '/xmltv-settings',
    {
      schema: {
        tags: ['Settings'],
        response: {
          200: XmlTvSettingsSchema,
          500: z.string(),
        },
      },
    },
    async (req, res) => {
      try {
        return res.send(req.serverCtx.settings.xmlTvSettings());
      } catch (err) {
        logger.error(err);
        return res.status(500).send('error');
      }
    },
  );

  fastify.put(
    '/xmltv-settings',
    {
      schema: {
        tags: ['Settings'],
        body: UpdateXmlTvSettingsRequestSchema,
        response: {
          200: XmlTvSettingsSchema,
          400: BaseErrorSchema,
          500: BaseErrorSchema,
        },
      },
    },
    async (req, res) => {
      try {
        const settings = req.body;
        let xmltv = req.serverCtx.settings.xmlTvSettings();
        // The body is `XmlTvSettingsSchema.partial()`, so an omitted field
        // means "leave this alone". Defaulting an omitted field to a constant
        // instead silently reset settings the request never mentioned.
        // outputPath stays server-owned: it is deliberately read-only in the
        // UI, so it is not taken from the body even when one is sent.
        const refreshHours = isUndefined(settings.refreshHours)
          ? xmltv.refreshHours
          : Math.max(1, settings.refreshHours);
        const programmingHours =
          settings.programmingHours ?? xmltv.programmingHours;
        // Checked only when the request sets one of the two, so settings saved
        // before this check can still have their other fields changed (their
        // schedule is shortened to fit the guide; see xmlTvRefreshCrontab)
        if (
          !isUndefined(settings.refreshHours) ||
          !isUndefined(settings.programmingHours)
        ) {
          const problem = xmlTvRefreshProblem({
            refreshHours,
            programmingHours,
          });
          if (!isUndefined(problem)) {
            return res.status(400).send({ message: problem });
          }
        }
        await req.serverCtx.settings.updateSettings('xmltv', {
          refreshHours,
          refreshStartHour: settings.refreshStartHour ?? xmltv.refreshStartHour,
          enableImageCache: settings.enableImageCache ?? xmltv.enableImageCache,
          outputPath: xmltv.outputPath,
          programmingHours,
          useShowPoster: settings.useShowPoster ?? xmltv.useShowPoster,
          publicUrl: settings.publicUrl ?? xmltv.publicUrl,
        });
        xmltv = req.serverCtx.settings.xmlTvSettings();
        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'XMLTV settings updated',
          module: 'xmltv',
          detail: {
            action: 'update',
          },
          level: 'success',
        });
        await rescheduleAndRebuild(xmltv);
        return res.send(xmltv);
      } catch (err) {
        logger.error(err);
        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'Error updating XMLTV configuration',
          module: 'xmltv',
          detail: {
            action: 'update',
            error: isError(err) ? err.message : 'unknown',
          },
          level: 'error',
        });
        return res.status(500).send({ message: 'error' });
      }
    },
  );

  fastify.post(
    '/xmltv-settings',
    {
      schema: {
        tags: ['Settings'],
        response: {
          200: XmlTvSettingsSchema,
          500: z.string(),
        },
      },
    },
    async (req, res) => {
      try {
        await req.serverCtx.settings.updateSettings(
          'xmltv',
          defaultXmlTvSettings(serverOptions().databaseDirectory),
        );
        const xmltv = req.serverCtx.settings.xmlTvSettings();
        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'XMLTV settings reset',
          module: 'xmltv',
          detail: {
            action: 'reset',
          },
          level: 'warning',
        });

        await rescheduleAndRebuild(xmltv);
        return res.send(xmltv);
      } catch (err) {
        logger.error(err);
        req.serverCtx.eventService.push({
          type: 'settings-update',
          message: 'Error reseting XMLTV configuration',
          module: 'xmltv',
          detail: {
            action: 'reset',
            error: isError(err) ? err.message : 'unknown',
          },
          level: 'error',
        });
        return res.status(500).send('error');
      }
    },
  );

  done();
};
