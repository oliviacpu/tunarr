import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { SettingsApplicationKey } from '@tunarr/types';

export const SettingsApplicationMessages = {
  browserPreferences: {
    title: msg`Browser preferences`,
    description: msg`Changes apply in this browser as you make them.`,
  },
  backendAddress: {
    title: msg`Server address`,
    description: msg`Reload this browser page after saving the server address so all API clients connect to the saved server.`,
  },
  serverPort: {
    title: msg`Server port`,
    description: msg`Restart Tunarr to listen on the saved port.`,
  },
  logging: {
    title: msg`Base logging and log rotation`,
    description: msg`Saving updates the base log level and rotation rules immediately.`,
  },
  logCategoryLevel: {
    title: msg`Category log level`,
    description: msg`Saving an explicit category log level updates that category immediately.`,
  },
  logCategoryInheritance: {
    title: msg`Inherited category log level`,
    description: msg`Returning a category from an explicit level to Inherit requires restarting Tunarr, unless changing the base log level or rotation settings also rebuilds the loggers.`,
  },
  backups: {
    title: msg`Backup configuration and schedules`,
    description: msg`Saving replaces the backup schedules immediately. A backup already running keeps its original output options.`,
  },
  search: {
    title: msg`Search indexing`,
    description: msg`Restart Tunarr to relaunch Meilisearch with the saved snapshot interval and memory limit. Environment overrides still take precedence.`,
  },
  scanner: {
    title: msg`Library scan interval`,
    description: msg`Saving reschedules library scans and collection and custom-show syncs immediately. A scan already running continues.`,
  },
  ffmpegBinaries: {
    title: msg`FFmpeg and FFprobe executable paths`,
    description: msg`New probes and processes use the saved executable paths. Processes already running continue with their original binaries.`,
  },
  ffmpegLogging: {
    title: msg`FFmpeg logging`,
    description: msg`New program FFmpeg processes use the saved logging destination and level. Processes already running keep their logging options.`,
  },
  hlsDirectOutput: {
    title: msg`HLS Direct output format`,
    description: msg`New HLS Direct playlists and program streams use the saved container format. A stream already running keeps its original format.`,
  },
  videoFilters: {
    title: msg`Video scaling, deinterlacing and tone mapping`,
    description: msg`The next program pipeline reads the saved scaling, deinterlace and tone-map settings. A program already transcoding keeps its pipeline.`,
  },
  readAhead: {
    title: msg`HLS read-ahead thread limit`,
    description: msg`The next HLS program transcode reads the saved read-ahead thread limit. A transcode already running keeps its thread count.`,
  },
  hlsSession: {
    title: msg`HLS segments and startup buffering`,
    description: msg`New HLS sessions read the saved segment length and initial segment count. New MPEG-TS wrapper sessions read the startup burst.`,
  },
  transcodeDirectory: {
    title: msg`FFmpeg transcode path`,
    description: msg`New sessions write to the saved directory. Existing sessions keep writing to their original directory until they end.`,
  },
  subtitleExtraction: {
    title: msg`Embedded subtitle extraction`,
    description: msg`Enabling starts an extraction run immediately. Disabling is checked before each queued program; an extraction already running can finish.`,
  },
  captionsEnabled: {
    title: msg`HDHomeRun closed captions`,
    description: msg`Caption delivery is fixed when an HLS session starts. Stop all viewers of the channel and tune in again to change it.`,
  },
  captionStyle: {
    title: msg`Caption alignment, appearance and test pattern`,
    description: msg`The next program pipeline reads the saved caption style and test pattern. A program already transcoding keeps its captions.`,
  },
  audioLanguages: {
    title: msg`Audio language preferences`,
    description: msg`The next program pipeline selects audio using the saved language preferences.`,
  },
  transcodeConfigs: {
    title: msg`Transcode configurations`,
    description: msg`Active HLS sessions retain their channel transcode configuration. Stop all viewers of the channel and tune in again to use an edited configuration.`,
  },
  guide: {
    title: msg`Guide settings`,
    description: msg`Saving reschedules guide refreshes and rebuilds the guide immediately using the saved settings.`,
  },
  tunerDiscovery: {
    title: msg`HDHomeRun network discovery`,
    description: msg`Restart Tunarr to start or stop HDHomeRun discovery advertising.`,
  },
  tunerCount: {
    title: msg`HDHomeRun tuner count`,
    description: msg`New HDHomeRun discovery and device-information responses report the saved tuner count. Clients may need to refresh the device.`,
  },
  'feature.proxyArtwork': {
    title: msg`Proxy artwork`,
    description: msg`New artwork requests use the saved flag. Images already loaded by a client may remain cached.`,
  },
  'feature.tonemapEnabled': {
    title: msg`HDR tonemapping feature`,
    description: msg`The next program pipeline reads this flag. A pipeline already running keeps its tone-mapping behavior.`,
  },
  'feature.webvttSidecarEnabled': {
    title: msg`WebVTT sidecar subtitles`,
    description: msg`The next program pipeline reads this flag when preparing subtitle outputs.`,
  },
  'feature.xmltvCreditImagesEnabled': {
    title: msg`XMLTV credit images`,
    description: msg`Guide writers read this flag on each write. Regenerate the guide to update existing XMLTV output.`,
  },
  'feature.disableSearchSnapshotInBackup': {
    title: msg`Search snapshot in backups`,
    description: msg`New backup archives read this flag. A backup already running can keep its original snapshot behavior.`,
  },
  'feature.disableVulkan': {
    title: msg`Disable Vulkan`,
    description: msg`The next NVIDIA program pipeline reads this flag. A pipeline already running is unchanged.`,
  },
  'feature.disableVaapiPad': {
    title: msg`Disable VAAPI padding`,
    description: msg`The next VAAPI program pipeline reads this flag. A pipeline already running is unchanged.`,
  },
} satisfies Record<
  SettingsApplicationKey,
  { title: MessageDescriptor; description: MessageDescriptor }
>;
