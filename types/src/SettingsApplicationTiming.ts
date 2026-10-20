import type { FfmpegSettings } from './FfmpegSettings.js';
import type { FeatureFlagKey } from './FeatureFlags.js';

export type SettingsApplicationWhen =
  | 'live'
  | 'next-session'
  | 'next-program'
  | 'reload'
  | 'restart';

export const SettingsApplicationTiming = {
  browserPreferences: {
    title: 'Browser preferences',
    when: 'live',
    description: 'Changes apply in this browser as you make them.',
  },
  backendAddress: {
    title: 'Server address',
    when: 'reload',
    description:
      'Reload this browser page after saving the server address so all API clients connect to the saved server.',
  },
  serverPort: {
    title: 'Server port',
    when: 'restart',
    description: 'Restart Tunarr to listen on the saved port.',
  },
  logging: {
    title: 'Base logging and log rotation',
    when: 'live',
    description:
      'Saving updates the base log level and rotation rules immediately.',
  },
  logCategoryLevel: {
    title: 'Category log level',
    when: 'live',
    description:
      'Saving an explicit category log level updates that category immediately.',
  },
  logCategoryInheritance: {
    title: 'Inherited category log level',
    when: 'restart',
    description:
      'Returning a category from an explicit level to Inherit requires restarting Tunarr, unless changing the base log level or rotation settings also rebuilds the loggers.',
  },
  backups: {
    title: 'Backup configuration and schedules',
    when: 'live',
    description:
      'Saving replaces the backup schedules immediately. A backup already running keeps its original output options.',
  },
  search: {
    title: 'Search indexing',
    when: 'restart',
    description:
      'Restart Tunarr to relaunch Meilisearch with the saved snapshot interval and memory limit. Environment overrides still take precedence.',
  },
  scanner: {
    title: 'Library scan interval',
    when: 'live',
    description:
      'Saving reschedules library scans and collection and custom-show syncs immediately. A scan already running continues.',
  },
  ffmpegBinaries: {
    title: 'FFmpeg and FFprobe executable paths',
    when: 'next-program',
    description:
      'New probes and processes use the saved executable paths. Processes already running continue with their original binaries.',
  },
  ffmpegLogging: {
    title: 'FFmpeg logging',
    when: 'next-program',
    description:
      'New program FFmpeg processes use the saved logging destination and level. Processes already running keep their logging options.',
  },
  hlsDirectOutput: {
    title: 'HLS Direct output format',
    when: 'next-program',
    description:
      'New HLS Direct playlists and program streams use the saved container format. A stream already running keeps its original format.',
  },
  videoFilters: {
    title: 'Video scaling, deinterlacing and tone mapping',
    when: 'next-program',
    description:
      'The next program pipeline reads the saved scaling, deinterlace and tone-map settings. A program already transcoding keeps its pipeline.',
  },
  readAhead: {
    title: 'HLS read-ahead thread limit',
    when: 'next-program',
    description:
      'The next HLS program transcode reads the saved read-ahead thread limit. A transcode already running keeps its thread count.',
  },
  hlsSession: {
    title: 'HLS segments and startup buffering',
    when: 'next-session',
    description:
      'New HLS sessions read the saved segment length and initial segment count. New MPEG-TS wrapper sessions read the startup burst.',
  },
  transcodeDirectory: {
    title: 'FFmpeg transcode path',
    when: 'next-session',
    description:
      'New sessions write to the saved directory. Existing sessions keep writing to their original directory until they end.',
  },
  subtitleExtraction: {
    title: 'Embedded subtitle extraction',
    when: 'live',
    description:
      'Enabling starts an extraction run immediately. Disabling is checked before each queued program; an extraction already running can finish.',
  },
  captionsEnabled: {
    title: 'HDHomeRun closed captions',
    when: 'next-session',
    description:
      'Caption delivery is fixed when an HLS session starts. Stop all viewers of the channel and tune in again to change it.',
  },
  captionStyle: {
    title: 'Caption alignment, appearance and test pattern',
    when: 'next-program',
    description:
      'The next program pipeline reads the saved caption style and test pattern. A program already transcoding keeps its captions.',
  },
  audioLanguages: {
    title: 'Audio language preferences',
    when: 'next-program',
    description:
      'The next program pipeline selects audio using the saved language preferences.',
  },
  transcodeConfigs: {
    title: 'Transcode configurations',
    when: 'next-session',
    description:
      'Active HLS sessions retain their channel transcode configuration. Stop all viewers of the channel and tune in again to use an edited configuration.',
  },
  guide: {
    title: 'Guide settings',
    when: 'live',
    description:
      'Saving reschedules guide refreshes and rebuilds the guide immediately using the saved settings.',
  },
  tunerDiscovery: {
    title: 'HDHomeRun network discovery',
    when: 'restart',
    description:
      'Restart Tunarr to start or stop HDHomeRun discovery advertising.',
  },
  tunerCount: {
    title: 'HDHomeRun tuner count',
    when: 'live',
    description:
      'New HDHomeRun discovery and device-information responses report the saved tuner count. Clients may need to refresh the device.',
  },
  'feature.proxyArtwork': {
    title: 'Proxy artwork',
    when: 'live',
    description:
      'New artwork requests use the saved flag. Images already loaded by a client may remain cached.',
  },
  'feature.tonemapEnabled': {
    title: 'HDR tonemapping feature',
    when: 'next-program',
    description:
      'The next program pipeline reads this flag. A pipeline already running keeps its tone-mapping behavior.',
  },
  'feature.webvttSidecarEnabled': {
    title: 'WebVTT sidecar subtitles',
    when: 'next-program',
    description:
      'The next program pipeline reads this flag when preparing subtitle outputs.',
  },
  'feature.xmltvCreditImagesEnabled': {
    title: 'XMLTV credit images',
    when: 'live',
    description:
      'Guide writers read this flag on each write. Regenerate the guide to update existing XMLTV output.',
  },
  'feature.disableSearchSnapshotInBackup': {
    title: 'Search snapshot in backups',
    when: 'live',
    description:
      'New backup archives read this flag. A backup already running can keep its original snapshot behavior.',
  },
  'feature.disableVulkan': {
    title: 'Disable Vulkan',
    when: 'next-program',
    description:
      'The next NVIDIA program pipeline reads this flag. A pipeline already running is unchanged.',
  },
  'feature.disableVaapiPad': {
    title: 'Disable VAAPI padding',
    when: 'next-program',
    description:
      'The next VAAPI program pipeline reads this flag. A pipeline already running is unchanged.',
  },
} as const satisfies Record<
  string,
  { title: string; when: SettingsApplicationWhen; description: string }
>;

export type SettingsApplicationKey = keyof typeof SettingsApplicationTiming;

export const FfmpegSettingsApplicationGroups = {
  ffmpegExecutablePath: 'ffmpegBinaries',
  ffprobeExecutablePath: 'ffmpegBinaries',
  enableLogging: 'ffmpegLogging',
  enableFileLogging: 'ffmpegLogging',
  logLevel: 'ffmpegLogging',
  languagePreferences: 'audioLanguages',
  transcodeDirectory: 'transcodeDirectory',
  scalingAlgorithm: 'videoFilters',
  deinterlaceFilter: 'videoFilters',
  tonemapAlgorithm: 'videoFilters',
  hlsDirectOutputFormat: 'hlsDirectOutput',
  hlsReadAheadMaxThreads: 'readAhead',
  hlsSegmentSeconds: 'hlsSession',
  hlsInitialSegmentCount: 'hlsSession',
  hlsTsInitialBurstSeconds: 'hlsSession',
  hdhrClosedCaptions: 'captionsEnabled',
  hdhrCaptionAlignment: 'captionStyle',
  hdhrCaptionAppearance: 'captionStyle',
  hdhrCaptionTestPattern: 'captionStyle',
  enableSubtitleExtraction: 'subtitleExtraction',
} as const satisfies Record<
  Exclude<keyof FfmpegSettings, 'configVersion'>,
  SettingsApplicationKey
>;

export const FeatureFlagsApplicationGroups = {
  proxyArtwork: 'feature.proxyArtwork',
  tonemapEnabled: 'feature.tonemapEnabled',
  webvttSidecarEnabled: 'feature.webvttSidecarEnabled',
  xmltvCreditImagesEnabled: 'feature.xmltvCreditImagesEnabled',
  disableSearchSnapshotInBackup: 'feature.disableSearchSnapshotInBackup',
  disableVulkan: 'feature.disableVulkan',
  disableVaapiPad: 'feature.disableVaapiPad',
} as const satisfies Record<FeatureFlagKey, SettingsApplicationKey>;
