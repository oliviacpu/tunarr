# When settings take effect

Timing chips describe when saved settings are read. **Live** means Tunarr reads the setting without a restart; it does not interrupt work already running. **Next program** means a new program pipeline, which may already be preparing ahead of playback. **Next session** means the channel must stop streaming before it starts again; stop all viewers first. **Reload required** means reload the browser page. **Restart required** means restart the Tunarr server.

Browser preferences apply as they change. The server address is stored in this browser when you select Save, even if the server settings request fails; reload the page to use it. Server-managed controls apply after a successful save. Environment overrides still take precedence over saved settings.

| Setting or group | Applies | Details |
| --- | --- | --- |
| Browser preferences | Live | Changes apply in this browser as you make them. |
| Server address | Reload required | Reload this browser page after saving the server address so all API clients connect to the saved server. |
| Server port | Restart required | Restart Tunarr to listen on the saved port. |
| Base logging and log rotation | Live | Saving updates the base log level and rotation rules immediately. |
| Category log level | Live | Saving an explicit category log level updates that category immediately. |
| Inherited category log level | Restart required | Returning a category from an explicit level to Inherit requires restarting Tunarr, unless changing the base log level or rotation settings also rebuilds the loggers. |
| Backup configuration and schedules | Live | Saving replaces the backup schedules immediately. A backup already running keeps its original output options. |
| Search indexing | Restart required | Restart Tunarr to relaunch Meilisearch with the saved snapshot interval and memory limit. Environment overrides still take precedence. |
| Library scan interval | Live | Saving reschedules library scans and collection and custom-show syncs immediately. A scan already running continues. |
| FFmpeg and FFprobe executable paths | Next program | New probes and processes use the saved executable paths. Processes already running continue with their original binaries. |
| FFmpeg logging | Next program | New program FFmpeg processes use the saved logging destination and level. Processes already running keep their logging options. |
| HLS Direct output format | Next program | New HLS Direct playlists and program streams use the saved container format. A stream already running keeps its original format. |
| Video scaling, deinterlacing and tone mapping | Next program | The next program pipeline reads the saved scaling, deinterlace and tone-map settings. A program already transcoding keeps its pipeline. |
| HLS read-ahead thread limit | Next program | The next HLS program transcode reads the saved read-ahead thread limit. A transcode already running keeps its thread count. |
| HLS segments and startup buffering | Next session | New HLS sessions read the saved segment length and initial segment count. New MPEG-TS wrapper sessions read the startup burst. |
| FFmpeg transcode path | Next session | New sessions write to the saved directory. Existing sessions keep writing to their original directory until they end. |
| Embedded subtitle extraction | Live | Enabling starts an extraction run immediately. Disabling is checked before each queued program; an extraction already running can finish. |
| HDHomeRun closed captions | Next session | Caption delivery is fixed when an HLS session starts. Stop all viewers of the channel and tune in again to change it. |
| Caption alignment, appearance and test pattern | Next program | The next program pipeline reads the saved caption style and test pattern. A program already transcoding keeps its captions. |
| Audio language preferences | Next program | The next program pipeline selects audio using the saved language preferences. |
| Transcode configurations | Next session | Active HLS sessions retain their channel transcode configuration. Stop all viewers of the channel and tune in again to use an edited configuration. |
| Guide settings | Live | Saving reschedules guide refreshes and rebuilds the guide immediately using the saved settings. |
| HDHomeRun network discovery | Restart required | Restart Tunarr to start or stop HDHomeRun discovery advertising. |
| HDHomeRun tuner count | Live | New HDHomeRun discovery and device-information responses report the saved tuner count. Clients may need to refresh the device. |
| Proxy artwork | Live | New artwork requests use the saved flag. Images already loaded by a client may remain cached. |
| HDR tonemapping feature | Next program | The next program pipeline reads this flag. A pipeline already running keeps its tone-mapping behavior. |
| WebVTT sidecar subtitles | Next program | The next program pipeline reads this flag when preparing subtitle outputs. |
| XMLTV credit images | Live | Guide writers read this flag on each write. Regenerate the guide to update existing XMLTV output. |
| Search snapshot in backups | Live | New backup archives read this flag. A backup already running can keep its original snapshot behavior. |
| Disable Vulkan | Next program | The next NVIDIA program pipeline reads this flag. A pipeline already running is unchanged. |
| Disable VAAPI padding | Next program | The next VAAPI program pipeline reads this flag. A pipeline already running is unchanged. |
