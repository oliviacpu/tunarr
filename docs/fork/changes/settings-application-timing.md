# Settings application timing (S4)

Settings now show a small timing chip for each coherent field group: Live, Next program, Next session, Reload required, or Restart required. Keyboard focus or hover shows the precise boundary, including active jobs and environment overrides. The shared `types/` registry drives both UI and the checked documentation table. Lingui messages make the chip explanations and accessible titles extractable, with source text checked against that registry. Typed maps cover every editable FFmpeg field and feature flag.

The browser server-address setting requires reloading the page so all API clients use the saved server; its timing is distinct from restarting Tunarr. This describes the current client lifecycle without changing it.

The mapping follows runtime reads rather than existing helper labels. In particular, HDHomeRun caption delivery is latched when an HLS session starts, so its chip and helper say Next session. Caption style still applies to the next program. Server port, discovery advertising and the Meilisearch launch settings require a restart. Saving scan, guide, base log/rotation and backup settings reschedules or updates them immediately without interrupting work in progress. Explicit category log levels apply live; returning a category to Inherit needs a restart unless a base/rotation change also rebuilds loggers. The category chips follow the selected value.

Runtime evidence: `SessionManager.ts` snapshots HLS options and caption delivery; `HlsSession.ts` and `HlsSlowerSession.ts` retain channel transcode configs; `FfmpegStreamFactory.ts` snapshots FFmpeg options for program pipelines; `SubtitleExtractorTask.ts` checks extraction between programs; `xmltvSettingsApi.ts`, `settingsApi.ts`, `Scheduler.ts` and `LoggerFactory.ts` update their live schedules or streams; `Server.ts` and `MeilisearchService.ts` read startup-only settings.

Design: S4 in the approved UI audit, approved in fork PR #85. No persistence or runtime application behavior is changed, and no global audio/subtitle-default model is added.
