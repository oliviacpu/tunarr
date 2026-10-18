import { defaultXmlTvSettings } from '@/db/SettingsDB.js';
import type { IChannelDB } from '@/db/interfaces/IChannelDB.js';
import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import { globalOptions } from '@/globals.js';
import { TVGuideService } from '@/services/TvGuideService.js';
import { KEYS } from '@/types/inject.js';
import { fileExists } from '@/util/fsUtil.js';
import { isNonEmptyString } from '@/util/index.js';
import { InjectLogger } from '@/util/inject.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import dayjs from 'dayjs';
import { inject, injectable } from 'inversify';
import z from 'zod';
import { EventService } from '../services/EventService.ts';
import { PlexGuideNotifier } from '../services/PlexGuideNotifier.ts';
import { GlobalScheduler } from '../services/Scheduler.ts';
import type { Maybe } from '../types/util.ts';
import { SubtitleExtractorTask } from './SubtitleExtractorTask.ts';
import { Task2 } from './Task.js';
import { taskDef } from './TaskRegistry.ts';

const UpdateXmlTvTaskRequest = z
  .object({
    channelId: z.string().optional(),
  })
  .optional();

export type UpdateXmlTvTaskRequest = z.infer<typeof UpdateXmlTvTaskRequest>;

@injectable()
@taskDef({
  description: 'Generates Tunarr guide data and writes an updated EPG',
  schema: UpdateXmlTvTaskRequest,
})
export class UpdateXmlTvTask extends Task2<typeof UpdateXmlTvTaskRequest> {
  public static ID = UpdateXmlTvTask.name;
  public ID = UpdateXmlTvTask.ID;
  schema = UpdateXmlTvTaskRequest;

  @InjectLogger() declare protected readonly logger: Logger;

  constructor(
    @inject(KEYS.SettingsDB) private settingsDB: ISettingsDB,
    @inject(TVGuideService) private guideService: TVGuideService,
    @inject(PlexGuideNotifier) private plexGuideNotifier: PlexGuideNotifier,
    @inject(EventService) private eventService: EventService,
    @inject(KEYS.ChannelDB) private channelDB: IChannelDB,
  ) {
    super();
    this.logger.setBindings({ task: UpdateXmlTvTask.ID });
  }

  get taskName() {
    return UpdateXmlTvTask.name;
  }

  protected runInternal(request: Maybe<UpdateXmlTvTaskRequest>): Promise<void> {
    return this.updateXmlTv(request?.channelId);
  }

  private async updateXmlTv(channelId?: string) {
    // Lets POST /api/xmltv/flush wait for a write a channel save started without awaiting it.
    this.plexGuideNotifier.writeStarted();
    try {
      await this.writeGuide(channelId);
    } finally {
      this.plexGuideNotifier.writeFinished();
    }
  }

  private async writeGuide(channelId?: string) {
    try {
      let xmltvSettings = this.settingsDB.xmlTvSettings();
      if (!(await fileExists(xmltvSettings.outputPath))) {
        this.logger.debug(
          'XMLTV settings missing at path %s. Regenerating path.',
          xmltvSettings.outputPath,
        );
        await this.settingsDB.updateSettings('xmltv', {
          ...xmltvSettings,
          outputPath: defaultXmlTvSettings(globalOptions().databaseDirectory)
            .outputPath,
        });
        // Re-read
        xmltvSettings = this.settingsDB.xmlTvSettings();
      }

      // Round start time down to the nearest hour so guide boundaries align
      // with the hour-granular requests made by the UI and other consumers.
      // Extend the duration by the fractional hour we went back so the guide
      // end time — and therefore coverage before the next scheduled run — is
      // identical to what it would have been without rounding.
      const now = dayjs();
      const startTime = now.startOf('hour');
      const extraDuration = dayjs.duration(now.diff(startTime));
      const guideDuration = dayjs
        .duration({ hours: xmltvSettings.programmingHours })
        .add(extraDuration);

      if (isNonEmptyString(channelId)) {
        // Force the rebuild: a targeted refresh is only requested when that
        // channel's programming actually changed, so the staleness guard in
        // buildChannelGuide would only be able to skip work we know is needed.
        await this.guideService.refreshGuide(
          guideDuration,
          channelId,
          true,
          true,
          startTime.valueOf(),
        );
      } else {
        await this.guideService.buildAllChannels(
          guideDuration,
          false,
          startTime.valueOf(),
        );
      }

      GlobalScheduler.getScheduledJob(SubtitleExtractorTask.ID)
        .runNow(true)
        .catch((err) => this.logger.error(err));

      this.logger.info('XMLTV Updated at %s', dayjs().format());

      // Notify native clients that the schedule has changed
      if (isNonEmptyString(channelId)) {
        this.eventService.push({
          type: 'channel_schedule_changed',
          level: 'info',
          channelId,
        });
      } else {
        const allChannels = await this.channelDB.getAllChannels();
        for (const channel of allChannels) {
          this.eventService.push({
            type: 'channel_schedule_changed',
            level: 'info',
            channelId: channel.uuid,
          });
        }
      }
    } catch (err) {
      this.logger.error(err, 'Unable to update TV guide');
      return;
    }

    // One ask per burst of writes, only once the server listens (PlexGuideNotifier).
    this.plexGuideNotifier.requestRefresh();
  }
}
