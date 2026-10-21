# Settings API

Read a settings section with `GET /api/settings/{section}` and update it with
`PUT /api/settings/{section}`. The sections are `ffmpeg`, `xmltv`, `hdhr`,
`media-source`, `system` and `feature-flags`. A successful update returns the saved
section; feature flags also return their metadata and environment-override status.

PUT accepts partial objects. An omitted field is preserved, including fields in
nested objects such as `hdhrCaptionAppearance`, `logging.logRollConfig` and
`server.searchSettings`. Arrays replace the whole array, rather than merging by
index: send a complete language preference list or backup configuration list.
Validation and server errors use `{ "message": "..." }`.

For example, this changes only the server port and keeps search settings:

```http
PUT /api/settings/system
Content-Type: application/json

{ "server": { "port": 8001 } }
```

To clear optional log-rolling `schedule` or `maxFileSizeBytes`, or search
`maxIndexingMemory`, send `null` for that field. Logging category levels also use
`null` to return to the inherited level. Omission means preserve, not clear.
Disable backups with `backup: { configurations: [] }`.

The XMLTV `outputPath` remains server-owned and ignores a submitted value. System
response metadata, such as `dataDirectory` and `environmentLogLevel`, is read-only.
Media rescan intervals must be whole hours, at least one; saving a changed interval
reschedules scans and collection/custom-show syncs without a restart.

## Subtitle preference storage

`ffmpeg.subtitlePreferences` stores an ordered list of global subtitle defaults. Each row requires
`languageCode`, `filter`, `allowExternal` and `allowImageBased`. Language codes are known lowercase
three-letter ISO 639-2 codes; bibliographic aliases such as `ger` normalize to `deu`. Filters are
`none`, `forced`, `default` and `any`.

```http
PUT /api/settings/ffmpeg
Content-Type: application/json

{
  "subtitlePreferences": [
    { "languageCode": "eng", "filter": "any", "allowExternal": true, "allowImageBased": false }
  ]
}
```

Omitting this field preserves its saved value, including through the deprecated FFmpeg settings
alias. An explicit `[]` clears it. Old settings files load with `[]`; malformed saved rows stop
loading before defaults can replace the file. Settings file version 2 and FFmpeg config version 5
are unchanged.

Channel responses include `subtitlePreferenceMode: "inherit" | "custom"`. Channel writes may omit
the mode to preserve it on update. Creation derives an omitted mode from the supplied rows: a
nonempty custom list selects `custom`, otherwise `inherit`. Switching to inherit retains custom
rows. An omitted channel preference list preserves rows; an explicit `[]` clears them. Existing
channel rows retain the legacy wire key `langugeCode`; global rows use `languageCode`.

S5a introduces persistence and compatibility only. Stream-selection integration follows in S5b,
and global/channel controls and previews follow in S5c. Fixed output audio layouts stay per channel.

## Compatibility window

The following GET/PUT aliases remain for the release introducing the canonical
paths. They are deprecated in OpenAPI and can be removed in the following release.

| Alias | Canonical path |
| --- | --- |
| `/api/ffmpeg-settings` | `/api/settings/ffmpeg` |
| `/api/xmltv-settings` | `/api/settings/xmltv` |
| `/api/hdhr-settings` | `/api/settings/hdhr` |
| `/api/system/settings` | `/api/settings/system` |
| `/api/system/feature-flags` | `/api/settings/feature-flags` |

`/api/settings/media-source` already had the canonical path. The deprecated
`PUT /api/system/settings/backup` remains for the same compatibility window;
new clients send `{ "backup": { ... } }` to `/api/settings/system`.

The unused POST reset endpoints at `/api/ffmpeg-settings`, `/api/xmltv-settings`
and `/api/hdhr-settings` are removed. This is an explicit exception to the alias
window: the UI already stages defaults locally and saves them through PUT, so
“Restore defaults” remains an undoable edit until Save is pressed. API clients
that used POST reset must submit their desired defaults explicitly through PUT.
