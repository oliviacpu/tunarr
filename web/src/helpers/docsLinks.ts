import { ForkRepositoryUrl } from './forkLinks.ts';

// Link to the fork's checked-in docs until it has a published docs site.
const DocsSourceUrl = `${ForkRepositoryUrl}/blob/main/docs`;

export const DocsPages = {
  ffmpegLogging: 'configure/ffmpeg/index.md#logging',
  ffmpegTranscodePath: 'configure/ffmpeg/index.md#ffmpeg-transcode-path',
  ffmpegSubtitleExtraction: 'configure/ffmpeg/index.md#subtitle-extraction',
  transcodeConfigs: 'configure/ffmpeg/transcode_config.md',
  transcodeConfigGeneral:
    'configure/ffmpeg/transcode_config.md#general-settings',
  transcodeConfigAdvanced:
    'configure/ffmpeg/transcode_config.md#advanced-options',
  transcodeConfigErrors: 'configure/ffmpeg/transcode_config.md#errors',
  channelStreamMode: 'configure/channels/transcoding.md#stream-mode',
  channelWatermarks: 'configure/channels/watermarks.md',
  fillerSelection: 'configure/library/filler-selection.md',
  logLevels: 'configure/system/logging.md#log-levels',
  backups: 'configure/system/backup.md',
  search: 'misc/search/index.md',
} as const satisfies Record<string, string>;

export type DocsPage = keyof typeof DocsPages;

export function docsUrl(page: DocsPage): string {
  return `${DocsSourceUrl}/${DocsPages[page]}`;
}
