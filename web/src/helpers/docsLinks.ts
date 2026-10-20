// The user docs are built from docs/ in this repository and published at
// tunarr.com (see docs/CNAME and mkdocs.yml)
const DocsSiteUrl = 'https://tunarr.com';

/**
 * Doc pages the app links to, as paths on the docs site. A path ending in "/"
 * is a page; mkdocs serves docs/<path>index.md or docs/<path without the
 * slash>.md there. docsLinks.test.ts checks that each file exists and that
 * each anchor names one of its headings.
 */
export const DocsPages = {
  ffmpegLogging: 'configure/ffmpeg/#logging',
  ffmpegTranscodePath: 'configure/ffmpeg/#ffmpeg-transcode-path',
  ffmpegSubtitleExtraction: 'configure/ffmpeg/#subtitle-extraction',
  transcodeConfigs: 'configure/ffmpeg/transcode_config/',
  transcodeConfigGeneral: 'configure/ffmpeg/transcode_config/#general-settings',
  transcodeConfigAdvanced:
    'configure/ffmpeg/transcode_config/#advanced-options',
  transcodeConfigErrors: 'configure/ffmpeg/transcode_config/#errors',
  channelStreamMode: 'configure/channels/transcoding/#stream-mode',
  channelWatermarks: 'configure/channels/watermarks/',
  fillerSelection: 'configure/library/filler-selection/',
  logLevels: 'configure/system/logging/#log-levels',
  backups: 'configure/system/backup/',
} as const satisfies Record<string, string>;

export type DocsPage = keyof typeof DocsPages;

export function docsUrl(page: DocsPage): string {
  return `${DocsSiteUrl}/${DocsPages[page]}`;
}
