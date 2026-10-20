# About this fork

This is a personal fork of [chrisbenincasa/tunarr](https://github.com/chrisbenincasa/tunarr), built into a Docker image
for one self-hosted deployment. It follows upstream's `main` and adds the targeted fixes and features listed below.
Upstream's own documentation, `CLAUDE.md` and `AGENTS.md` still apply.

## Builds

- Images are built only for tags named `oliviacpu-…`, by date: `oliviacpu-2026.10.13`, with `.2` for a second one the same
  day. Pushes to `main` build nothing (`.github/workflows/fork-image.yml`). To release:
  `git tag oliviacpu-2026.10.13 && git push origin oliviacpu-2026.10.13`.
- Each build pushes `ghcr.io/oliviacpu/tunarr:<tag>`, `:sha-<commit>` and, when its tag is the newest `oliviacpu-` tag,
  `:latest`, for linux/amd64, and creates a GitHub Release for the tag. The deployment runs `:latest`, so pushing a tag
  releases it; an older tag's build finishing last can't move `:latest` back. Its notes list what's new since the previous `oliviacpu-` tag and
  every fork commit on top of upstream. To roll back, deploy an older release's `:<tag>` image.
- The version Tunarr reports is `<upstream version>-<tag>`, e.g. `2026.10.2-oliviacpu-2026.10.13`.
- Upstream updates come in with `git fetch upstream && git merge upstream/main`.
- The `Dockerfile` copies `.pnpmfile.cjs` next to the lockfile. Since upstream's TypeScript 7 upgrade the lockfile
  records the pnpmfile's checksum, so without it `pnpm install --frozen-lockfile` fails in the image build.
- **ffmpeg:** the image's `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` are jellyfin-ffmpeg (see below). The base image's
  ErsatzTV ffmpeg 7.1.1 stays at `/usr/local/bin/ffmpeg`. To fall back to it without a new image, set the FFmpeg paths
  to `/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe`. The settings page hides them in a container, so use the API
  (`PUT /api/settings/ffmpeg`) or `tunarr settings update`. To bump jellyfin-ffmpeg, change `jellyfin_ffmpeg_version` and
  `jellyfin_ffmpeg_sha256` in the `Dockerfile`. The digest is the release asset's:
  `gh api repos/jellyfin/jellyfin-ffmpeg/releases/tags/v<version> --jq '.assets[] | select(.name | test("portable_linux64-gpl")) | .digest'`.

## Changes in this fork

### Keep week-calendar days aligned inside a bounded viewport (2026-10-20, PR #157)

- **What you saw:** in the local seeded preview at phone width, week headers expanded the page to 1048px while the separately scrolling body clipped later days.
- **Cause:** headers and body used separate width/overflow rules, and their leading gutters differed by the divider width.
- **Fix:** put both rows and the hour gutter inside one native horizontal scroll viewport, share day sizing and gutter alignment, keep the time axis and divider visible while scrolling, and allow the toolbar to wrap. All seven days remain reachable; desktop columns fill the available width. The scroll region is named and keyboard focusable. Scheduling, date selection, navigation, zoom and palette behavior are unchanged.
- **Tests:** the new browser regression fails on the old 1048px document at a 390px viewport. GET-only synthetic programming starts on Tuesday with a 24-hour cycle; checks cover bounded page width, all seven header/column pairs before and after scrolling, keyboard scrolling with persistent hour labels, reachable Tuesday/Saturday programs and selecting a later day. Captures cover 390px/1440px in both schemes. A component regression preserves date callbacks and week navigation across zoom changes; existing calendar palette tests remain covered.
- **Upstream:** not sent; scoped correction to the existing web preview.

### Advance calendar preview timestamps for repeated cycles (2026-10-20, PR #156)

- **What you saw:** in the local seeded seven-hour calendar preview, start times repeated the first cycle and React emitted duplicate key warnings in Day and Week. A review regression also reproduced duplicate timestamps and incorrect phase after unsaved lineup edits changed its length. These were local fixture findings, not reported production incidents.
- **Cause:** the preview loop reused its first cycle timestamp, and saved channel duration could differ from the current editor lineup.
- **Fix:** memoize the current materialized lineup's duration, use it for the initial phase and advance the cycle timestamp whenever the index wraps. Empty or zero-length current lineups return no preview. No store synchronization is needed. Program order, existing first-partial/final-day clipping, server scheduling, API contracts and calendar layout stay unchanged.
- **Tests:** the original timestamp regressions and three stale-duration regressions fail before their fixes. All ten hook cases now pass, including appended/shortened lists and empty cycles. GET-only browser cases check seven-hour and stale saved-duration previews, distinct day labels and Day/Week health. Existing route-specific known issues remain unchanged. Types, changed-file lint, formatting and quick preflight pass.
- **Upstream:** not sent; bounded correction to the existing web preview.

### Settings tests follow the integrated loading and navigation behavior (2026-10-20, PR #154)

- **What you saw:** full CI exceeded the isolation test's one-second initial executable-field wait while system state was still loading. The combined browser sweep also waited for the transcode editor's retired breadcrumb name.
- **Cause:** the isolation helper retained Testing Library's default wait despite the neighboring FFmpeg harness already allowing ten seconds for initial fields, and the transcode test targeted an old navigation name plus its first link.
- **Fix:** T1 follow-up under the approved UI audit (PR #85). Give only the playback helper the existing bounded ten-second initial-field wait. Keep the unresolved optional-flags assertions intact. Target the current breadcrumbs' explicit Playback link and check its destination before exercising the unchanged unsaved-dialog and save assertions. No runtime code or global CI limits change.
- **Tests:** the failures were observed in full CI and the combined browser sweep. Focused settings suites and the real transcode browser file verify the corrected waits/locator; e2e typecheck, changed-file lint and formatting checks cover the test-only change.
- **Upstream:** not sent.

### Keep table preference updates outside React state updaters (2026-10-20, PR #155)

- **What you saw:** the combined browser route sweep caught a React warning when the channel Streaming tab updated table preferences.
- **Cause:** a functional state updater notified settings subscribers while React was rendering the subtitle table.
- **Fix:** resolve visibility, pagination and sorting callbacks against their latest pending values before queuing concrete React state and persisting preferences. Consecutive functional updates still compose, direct values still work, and selection/reset behavior remains unchanged. No API, schema or scheduling behavior changed.
- **Tests:** the StrictMode settings-subscriber regression reproduces the warning before the fix; all seven hook tests pass, covering composed/direct updates, persisted remount values and existing selection/reset behavior. The focused Streaming route and subtitle browser suite passed all six tests including seed. Web/E2E typechecks, changed-file lint, formatting and quick preflight pass.
- **Upstream:** not sent.

### Channel updates preserve omitted filler and subtitle relations (2026-10-20, PR #152)

- **What you saw:** a channel update that omitted optional filler attachments or subtitle preferences deleted the saved rows. The bulk stealth UI worked around this by fetching and resending a full channel.
- **Cause:** the repository deleted both relations unconditionally, while subtitle write validation rejected empty arrays and the editor serialized an intentional clear as omission.
- **Fix:** approved C7a from design PR #149. Omitted relations keep their exact rows; explicit empty arrays clear, and nonempty arrays replace, within the existing immediate transaction. Accept empty subtitle arrays on writes and skip empty inserts during both creation and update. The editor sends changed relations only and sends an explicit empty array for a deliberate clear. Existing start-time/on-demand behavior and the bulk stealth preservation workaround stay in place. C7b/C7c batching and S5 global defaults remain held.
- **Tests:** real SQLite repository regressions cover omissions, independent clears/replacements, retained relation IDs, rollback, start-time/on-demand preservation and creation with empty subtitles. Schema/editor/browser regressions cover empty and malformed writes, unrelated edits and clear/save/reload. Current and Latest OpenAPI document the same write change; generated client/routes are checked without rewriting historical specifications.
- **Upstream:** not sent.

### Lineup and calendar theme colours (2026-10-20, PR #151)

- **What you saw:** the lineup list, mid-roll headers and day/week previews used random program colours that differed from the guide.
- **Cause:** those surfaces kept their separate colour hook and omitted tabular numerals on time/count text.
- **Fix:** reuse the guide's existing eight-step ramp and resolved scheme for fills, text, hover colours and dividers. Episodes and custom-show entries follow their show or artist; movies and other videos follow their program. Flex gaps and redirects keep their semantic treatment. Lineup times/counts, calendar dates/times and guide remaining-time text use tabular numerals. Scheduling, grouping, titles, controls and the existing dark-yellow palette step are unchanged.
- **Tests:** 65 focused tests, web/E2E types, changed-file lint and quick preflight; three seeded browser tests with 16 inspected captures at 390px/1440px in both schemes. GET-only programming overrides exercise a full-day mixed/mid-roll lineup without saving fixture programming. Separate calendar timestamp and phone-overflow findings remain unimplemented.
- **Upstream:** not sent.

### Make guide minus reduce hours and plus add hours (2026-10-20, PR #150)

- **What you saw:** The guide controls were ordered minus / duration / plus, but minus increased the displayed hours and plus decreased them.
- **Cause:** Their handlers and accessible names followed zoom direction rather than the displayed duration.
- **Fix:** Connect minus to decreasing the duration and plus to increasing it. Name the controls “Show one hour less” and “Show one hour more”, retaining the one-hour minimum, eight-hour maximum and existing order. The existing date-navigation/reset tooltips are unchanged; these duration buttons had no individual tooltips.
- **Tests:** The two focused unit tests reject the old handler assignments and verify rendered/persisted hours, icon order, both limits and re-enabling plus after decreasing from eight hours. The existing guide browser case checks 3 → 2 → 3 and minus/duration/plus order at 390px and 1440px in both themes, with four captures. Web/e2e typechecks and quick preflight validate the scoped change.
- **Upstream:** Fork-only guide-controls follow-up under the audit plan (PR #85), explicitly requested by the user; no upstream submission.

### Preserve legacy API failure reasons (2026-10-20, PR #148)

- **What you saw:** channel updates and bulk actions could show a generic HTTP failure instead of the server's reason.
- **Cause:** the shared error helper read plain strings and `{ message }`, while older channel routes still return `{ error }`.
- **Fix:** accept a nonempty string in the legacy error field, prefer a nonempty canonical message when both exist, and ignore empty or malformed fields. Server response shapes and channel update behavior are unchanged.
- **Tests:** focused error-helper tests cover legacy failures, canonical precedence, and empty or malformed response bodies.
- **Upstream:** small client compatibility correction from the C7 follow-up inventory; no API change.

### Use shared dialog action labels (2026-10-20, PR #147)

- **What you saw:** Manage Libraries used a primary Close button even though each toggle saves immediately. Some dismissal buttons and delete tooltips defined the same localized action labels separately.
- **Cause:** Those sites predated the shared action vocabulary.
- **Fix:** Make Manage Libraries' Close outlined and add Close to `useActions`. Reuse shared Cancel/Close labels in existing dialogs and the selected-program drawer, and shared Delete labels in existing table tooltips. Keep descriptive accessible names, destructive styling, primary commit actions and operation-specific toasts. Disabled Delete section headings and the running trash job's Cancel remain separate.
- **Tests:** All 40 focused tests pass, covering immediate library toggles, non-committing Close, locale changes and affected consumers. The outlined-Close regression fails with the old contained variant. Web typecheck, changed-file lint and quick preflight pass. No locale catalogs or behavior/API/schema changes.
- **Upstream:** Fork-only D3 follow-up under the approved audit plan (PR #85); no upstream submission.

### Fork images identify their release commit (2026-10-20, PR #146)

- **What you saw:** the released image's OCI revision label identified the base image's commit instead of the Tunarr release commit.
- **Cause:** the fork image workflow set source and version labels but inherited the base image's revision label.
- **Fix:** explicitly set `org.opencontainers.image.revision` to the workflow's full release commit SHA. Image tags, newest-release promotion to `latest`, version strings and GitHub release behavior stay unchanged. Existing images are unchanged; the correction applies to future builds.
- **Tests:** a focused parsed-workflow assertion fails on the original workflow and passes with the revision label. Removing that single label produces the original parsed workflow exactly; formatting and changed-file lint checks pass. No release, image build or deployment was run.
- **Upstream:** not sent; fork-only workflow correction.

### Failed FFmpeg probes report a failure (2026-10-20, PR #136)

- **What you saw:** unavailable FFmpeg returned a successful capability response with empty encoder lists. Default tuner settings also shared one mutable object between settings instances.
- **Cause:** the API replaced failed probe results with empty arrays, and the default settings factory returned the exported tuner defaults by reference.
- **Fix:** approved S6/B6 audit follow-ups. Return a structured server error when a capability probe fails; keep successful results intact. The API reads the hardware probe's Result; existing capability callers keep their empty-list fallback. Create an independent tuner configuration for each settings file. S6 removes the obsolete reset route and its readonly cast separately.
- **Tests:** API success/failure cases, an actual executable failing its hardware probe while the capability fallback stays intact, and independent default-settings instances; regenerated API contracts add the FFmpeg error response while preserving P1's hidden management routes, with the public latest spec synchronized to the versioned spec.
- **Upstream:** not sent.

### Separate HLS field helpers on phones (2026-10-20, PR #144)

- **What you saw:** At 390px, the HLS segment-length helper overlapped the next field's label, and the segments-before-playback helper overlapped the start-up burst label.
- **Cause:** The field stack defined its column direction only from the `sm` breakpoint, so MUI did not apply its spacing at `xs`.
- **Fix:** Start the column direction at `xs`, preserving the existing row layout from `md`.
- **Tests:** The new geometry regression fails before the fix with a 9px helper/label overlap. It passes afterward at 390px and 1440px in light and dark themes, with viewport screenshots for all four combinations. The ten existing playback settings tests, web/e2e typechecks, scoped lint and quick preflight validate the change.
- **Upstream:** Fork-only mobile layout follow-up under the approved S2/D8 audit scope (PR #85); no upstream submission.

### E2E follow-up locators and fixture cleanup (2026-10-20, PR #143)

- **What you saw:** broad delete/tuner locators matched unintended controls, and saved channel/logging edits leaked into later specs expecting the seed baseline.
- **Cause:** older accessible names and fixture cleanup did not match the integrated settings/editor behavior.
- **Fix:** use the descriptive filler delete name and exact tuner label. Restore edited channel names, guide titles and watermarks in `finally`, preserving other current fields and omitting start-time/on-demand resets. General and timing tests establish their logging-category baseline and restore only their own values, using explicit null for originally absent values. The channel API does not clear omitted optional fields, so originally absent guide titles/watermarks return to the editor's equivalent blank/disabled state. Test-only T1 follow-up; no runtime or test-infrastructure changes.
- **Tests:** the five affected specs pass together with one worker (16 tests including seed); e2e typecheck, scoped lint and quick preflight pass.
- **Upstream:** not sent.

### Stream Selection Profile management stays internal (2026-10-20, PR #123)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue P1, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** generated API documentation and the web client exposed profile CRUD and CEL validation despite
  there being no profile editor in the UI.
- **Cause:** the routes had public OpenAPI schemas.
- **Fix:** mark the six routes internal with the existing Swagger `hide` metadata and regenerate the spec/client.
  The public Latest specification mirrors the regenerated development specification; historical specifications stay unchanged.
  Server routes, persistence, profile resolution and stream evaluation remain functional; a profile UI needs its
  own design.
- **Tests:** `streamSelectionApi.test.ts` checks that every route remains registered while runtime and public Latest OpenAPI omit them, then
  exercises profile CRUD and expression validation against a migrated database. Existing resolver/evaluator tests
  verify stream selection still works.
- **Upstream:** not sent.

### Settings share one API shape (2026-10-20, PR #121)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue S6, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** settings routes mixed `/ffmpeg-settings`, `/system/settings` and `/settings/media-source`, with
  different error bodies. Some partial writes reset omitted fields to defaults or replaced whole nested objects.
- **Cause:** each settings router had its own update schema, merge behavior and errors.
- **Fix:** canonical GET/PUT routes use `/api/settings/{ffmpeg,xmltv,hdhr,media-source,system,feature-flags}`.
  Update schemas have no implicit defaults; nested values are preserved when omitted, arrays replace whole lists,
  and documented optional system values can be cleared with null. Errors use `{message}`. The web and e2e fixture
  use canonical routes. Old GET/PUT routes remain deprecated aliases for one release; unused POST reset routes are
  removed explicitly. The UI still stages Restore defaults locally. The shared media-source schema now requires
  whole-hour rescan intervals of at least one; old files normalize legacy values without losing other settings.
- **Tests:** contracts for all six sections, legacy aliases, partial/invalid/nested writes, consistent errors,
  extraction and scheduling effects, removed resets, update-schema coverage and legacy settings-file reads.
- **Upstream:** not sent.

### Settings options and filler delete actions are localized (2026-10-20, PR #138)

- **What you saw:** several settings choices and feature descriptions bypassed translation, and filler delete buttons lacked an accessible name identifying their list.
- **Cause:** those surfaces still used plain strings or unnamed icon actions.
- **Fix:** stream mode, watermark position, error screen/audio choices and known feature names/descriptions use Lingui. Unknown flags keep the server's supplied copy so an older frontend can describe a newer flag. Filler delete buttons have localized, list-specific names. Stored values and API metadata are unchanged; catalogs are refreshed after integration.
- **Tests:** localized option/flag rendering, unknown-flag fallback and accessible filler deletion regressions.
- **Upstream:** not sent.

### Guide redirect names, mobile times and sliver dividers (2026-10-20, PR #137)

- **What you saw:** redirect cells displayed a channel UUID, mobile cells omitted their times and time left, and compact program dividers used one hard-coded shadow in both themes.
- **Cause:** the guide read the redirect ID instead of its supplied name, a viewport condition returned a boolean, and the compact divider bypassed the active palette.
- **Fix:** show the supplied channel name, render times at the existing width thresholds, and use the theme divider. Remove the empty, unreferenced controls file. The guide ramp, accent and paused styling stay the same.
- **Tests:** guide unit regressions and browser checks cover names, mobile times, both themed dividers and horizontal containment at 390px/1440px; typechecks, lint, quick preflight and the production bundle are recorded in the PR.
- **Upstream:** not sent.

### Missing detail entities use the existing not-found page (2026-10-20, PR #135)

- **What you saw:** missing smart collections, media sources/libraries and transcode configurations reached the error page; missing media details could render blank.
- **Cause:** detail loaders did not consistently translate missing lookups, while cached router matches could render before a fresh existence check finished.
- **Fix:** await the existing not-found helper in detail loaders, including media details. Missing responses use not-found UI; unexpected failures preserve the server message and retry controls. Detail components keep their query subscriptions without an immediate duplicate mount refetch. Remove only unreachable outer suspense loading branches, retaining lazy custom-show preview loading. No API or schema change.
- **Tests:** lookup success/400/404/500, deferred preview loading, cached revisits after 404/500, and one lookup per visit across all six detail branches; route sweeps, typechecks and the existing preflight/bundle procedure are recorded in the PR.
- **Upstream:** not sent.

### Channel edit tabs have addresses (2026-10-20, PR #134)

- **What you saw:** channel tabs shared one edit URL, history did not step through tabs, and Streaming also held watermark controls.
- **Cause:** local tab state replaced a query parameter instead of navigating between routes.
- **Fix:** Properties, Flex, Guide, Streaming and Watermark are child routes under one persistent edit form. Tabs and browser history preserve unsaved values. Legacy `?tab=epg` and `?tab=ffmpeg` links redirect to Guide and Streaming. Only tab paths for the same channel bypass the unsaved guard; leaving or changing channel still asks first. Watermark behavior is unchanged in its own tab.
- **Tests:** real-router and browser regressions cover all five routes, history, redirects, shared saves, field errors, persistence and Cancel/Proceed, plus both themes at 390px/1440px and existing subtitle editing.
- **Upstream:** not sent.

### Settings explain when saved values apply (2026-10-20, PR #133)

- **What you saw:** settings did not consistently explain whether saving affected current work, a later program/session, a browser reload or server startup.
- **Cause:** runtime read boundaries were spread across settings helpers and services rather than one checked mapping.
- **Fix:** a shared types registry drives Live, Next program, Next session, Reload required and Restart required chips, with extractable Lingui titles/tooltips and matching docs. Typed maps cover editable FFmpeg fields and feature flags. Browser server-address changes require reloading that browser page. HLS Direct reads its format for new playlists/program streams, including active viewers; a stream already running retains its format. Caption delivery remains session-bound and caption styling program-bound. Category logging distinguishes explicit live levels from inherited levels that require a restart unless base/rotation settings rebuild the logger. Existing persistence and runtime application behavior are unchanged; global channel defaults remain separate.
- **Tests:** registry snapshots, exhaustive field/flag mappings, exact documentation/message comparisons, keyboard tooltips and Spanish/Chinese rendering. The HLS Direct correction passes all 12 timing regressions, types/shared builds, web typecheck and quick preflight; earlier browser checks cover all task tabs at 390px/1440px in both themes.
- **Upstream:** not sent.

### Guide zoom buttons use minus, duration, plus order (2026-10-20, PR #132)

- **What you saw:** the plus magnifier appeared before the duration and the minus magnifier after it.
- **Cause:** the grouped controls retained their original ordering.
- **Fix:** put the minus magnifier on the left and the plus magnifier on the right, as requested. Zoom behavior and limits are unchanged.
- **Tests:** the guide regression checks button order, duration changes and the existing limits.
- **Upstream:** not sent.

### Detail headings and navigation follow the current task (2026-10-20, PR #131)

- **What you saw:** several detail/create pages skipped their document heading, the mobile overflow action had no accessible name, and Guide/Search/media destinations did not always select a navigation task.
- **Cause:** older page headers and prefix matching remained outside the shared page/navigation conventions.
- **Fix:** use PageHeader on library/source details and Welcome, retain a single h1 below Settings, and use a named overflow IconButton with menu state. Root selects Guide; Search and media details select Library. Transcode editor breadcrumbs include Settings and the canonical Playback destination after the task-tab regrouping. Section headings retain their correct peer/nested levels.
- **Tests:** generated-route navigation coverage, heading levels, explicit breadcrumbs and mobile menu behavior; detail-page browser captures, typechecks, lint and the production bundle are recorded in the PR.
- **Upstream:** not sent.

### UI audit tests wait for their actual asynchronous work (2026-10-20, PR #130)

- **What you saw:** cold-render timeouts, a pruning-floor assertion based on a short sleep, and browser fixture port collisions across worktrees.
- **Cause:** first-render assertions used a one-second wait, segment deletion was fire-and-forget, and fixtures hard-coded their ports.
- **Fix:** give asynchronous form mounts explicit waits, await pruning/save completion, and replace an inline import type. Keep the existing test limit and two-worker guidance for expensive language-picker tests. A validated `TUNARR_E2E_PORT_OFFSET` isolates parallel browser fixtures without sharing their data directories.
- **Tests:** affected component/HLS suites, default/offset/invalid-port regressions, and browser fixture startup with an offset.
- **Upstream:** not sent.

### Smart Collections support query creation and editing (2026-10-20, PR #129)

- **What you saw:** Create opened Search without explaining the next step, and Edit changed only a collection's name.
- **Cause:** Search had no collection-creation context and the edit dialog omitted the stored query.
- **Fix:** Create opens Search with an instruction and visible Save as collection action, then returns to the list. Edit loads/saves name, keywords and filter using the existing text and visual builders. Clearing a filter uses the existing API representation; invalid filters cannot save. Cancel and background refetches preserve unsaved edits.
- **Tests:** parsing, clearing and dirty-input unit regressions; browser create/edit, both builders, reload persistence, validation, Cancel/navigation and 390px/1440px light/dark layouts; typechecks, lint and bundle checks are recorded in the PR.
- **Upstream:** not sent.

### Help and bug-report links describe the running fork (2026-10-20, PR #128)

- **What you saw:** help opened upstream documentation and the error page prepared upstream reports for fork behavior.
- **Cause:** destinations were hard-coded to upstream.
- **Fix:** link help and Search syntax to checked-in fork documentation and prepare reports in the fork repository, retaining the existing environment/error fields. This fork has no separately published documentation site.
- **Tests:** documentation files/headings resolve and error-report links retain their prefilled fields while targeting the fork.
- **Upstream:** not sent.

### Library items show which channels use them (2026-10-20, PR #127)

- **What you saw:** filler lists, custom shows and smart collections gave no channel-specific usage or delete warning.
- **Cause:** lineup JSON and relational filler attachments had no shared reference view.
- **Fix:** three bulk usage endpoints scan saved slots/items, filler attachments and offline music, returning unique channels and one-based slot positions. A cached scan invalidates on relevant channel, lineup and attachment changes; superseded scans retry even if they fail. Table chips and single/bulk delete warnings share the data. Refreshing cached references shows loading, and errors show unavailable rather than zero; deletion stays available. No schema migration or persistent scheduling index.
- **Tests:** SQLite/lineup fixtures cover every reference kind, deduplication, invalidation and scan races; API tests cover all three endpoints and static-path precedence. Component and browser tests cover named warnings, refresh loading and deletion at 390px/1440px in both themes. Build/typecheck, lint and bundle results are recorded in the PR.
- **Upstream:** not sent.

### Retired settings leave persisted and generated contracts (2026-10-20, PR #126)

- **What you saw:** settings and API docs retained unused Plex streaming/XMLTV image-cache fields, and channel/lineup contracts exposed retired transcoding/dynamic-content fields.
- **Cause:** schemas and endpoints outlived their runtime consumers.
- **Fix:** settings-file version 2 strips the unused keys on the main-thread startup write while preserving active sections. Remove Plex settings endpoints/types, the XMLTV image-cache flag, channel transcoding wire field and dynamic-content schema/store field. Legacy lineup reads strip the retired key. The historical SQL channel column remains; this row adds no SQL migration.
- **Tests:** settings-file upgrade/reload, legacy lineup reads, affected schema/API tests and regenerated contract checks.
- **Upstream:** not sent.

### Missing settings controls use their existing persistence fields (2026-10-20, PR #124)

- **What you saw:** saved scaling/deinterlace choices, rolled-file retention, backup schedule controls and search-index settings had no complete UI.
- **Cause:** the settings forms exposed only part of the existing model.
- **Fix:** Playback exposes scaling/deinterlace; General exposes retention and backup temporary directories, cron expressions and per-configuration switches; Library exposes search snapshot intervals and optional indexing memory. An empty memory field restores the automatic limit. Validate active backup cron schedules with outputs before persistence or job replacement, preserving both on failure; disabled/output-free schedules remain editable. Scan/search forms share one navigation guard, and an empty required retention count blocks Save. No new persistence model or dependency.
- **Tests:** per-field save/reload roundtrips preserve unrelated settings; cron validation preserves scheduled jobs, optional memory clears, retention validation and combined dirty guards have regressions.
- **Upstream:** not sent.

### Legacy external source columns retire after transactional backfill (2026-10-20, PR #122)

- **What you saw:** external IDs kept source-name columns beside media-source UUIDs, and migration-time drops could precede the startup backfill.
- **Cause:** the source-ID transition retained both representations and relied on a later fixer.
- **Fix:** one registered migration resolves source-dependent IDs by source type and UUID/name, backfills null media-source IDs, then drops obsolete columns/indexes in the same transaction. Independent IDs may remain null. Unresolved/ambiguous sources stop with table/count diagnostics; uniqueness failures roll back. Converters and fixers use replacement IDs. Root program/grouping backfills, clip fallbacks and MikroORM history remain; three existing tables enter the Drizzle schema index. Freeze legacy transcode defaults in a migration-only helper while the runtime fixer uses the equivalent current factory. Startup synchronizes old migration history and stops after an incomplete upgrade.
- **Tests:** upgrade and MikroORM-only fixtures cover resolution, already-linked/independent IDs, rollback, retained clip fallbacks, root backfills, exact defaults and bootstrap failure. A separate migrated dev-fixture backup preserves counts and foreign-key integrity; final checks are recorded in the PR.
- **Upstream:** not sent.

### Settings tabs are grouped by task (2026-10-20, PR #118)

- **What you saw:** settings were organized by backend implementation rather than the task being configured.
- **Cause:** FFmpeg, captions, search and optional flags were grouped under their older pages.
- **Fix:** General, Playback, Captions & audio, Guide, Tuner, Library and Experimental each explain their purpose. Playback and captions retain independent core/flag saves under one page-level dirty guard. Optional flag/environment queries fail independently; cached forms and unsaved edits remain visible with retry warnings. Feature saves send only the active group's fields. Legacy settings/config bookmarks redirect to canonical task tabs; breadcrumbs, caption guidance, docs and route coverage match. The missing controls are recorded separately under S2; global channel defaults remain separate future work.
- **Tests:** routes/redirects, independent/cached query failures, shared dirty guards, active-group-only saves and canonical breadcrumb browser regressions.
- **Upstream:** not sent.

### Environment overrides and the settings CLI share one registry (2026-10-20, PR #117)

- **What you saw:** overrides were undocumented or bypassed the registry, logging/build names drifted, and the CLI updated only nested settings.
- **Cause:** runtime reads, build metadata, validation and docs evolved separately.
- **Fix:** centralize/document runtime reads and logger overrides, support `TUNARR_BUILD_SHA` while retaining `TUNARR_BUILD`, parse inlined booleans consistently and remove the unused chunk variable. The settings CLI validates `system` and `featureFlags` as well as nested settings while preserving internal file state. Status shows an explicitly selected, parsed set of safe overrides; credentials, paths and platform/build metadata are omitted.
- **Tests:** registry/docs/direct-read coverage, inlined boolean precedence, safe override filtering and atomic CLI validation; environment-sensitive suites, typechecks, lint and builds are recorded in the PR.
- **Upstream:** not sent.

### Select several channels, filler lists, custom shows or smart collections and act on them at once (2026-10-20, PR #109)

- **Design:** `plans/ui-primitives-and-settings-audit-2026-10-19.md`, issue C7.
- **What you saw:** every list deleted one row at a time, each with its own confirmation, and hiding several channels
  from the guide meant opening each channel's settings.
- **Cause:** the four list tables never turned on material-react-table's row selection, and there was no shared bulk
  action.
- **Fix:**
  - Channels, Filler Lists, Custom Shows and Smart Collections have a checkbox per row and a select-all in the header
    that selects the visible page. While rows are selected, the table's toolbar shows `BulkActionsToolbar`
    (`web/src/components/base/BulkActionsToolbar.tsx`): "N selected", an outlined red Delete and, on Channels only,
    "Hide from guide" and "Show in guide". Selection lives in component state only (`useSelectableTableSettings` in
    `web/src/hooks/useTableSettings.ts`), is keyed by id, and clears when an action finishes or the page or page size
    changes. MRT's own selection banner is off.
  - Delete opens the shared `DeleteConfirmationDialog` once: "Delete 3 channels?", the names (the first ten, then "and
    N more"), busy and kept open until every delete settles. There is no bulk endpoint, so the web app sends the
    existing per-item `DELETE` for each row with `Promise.allSettled` (`useBulkAction` / `useBulkDelete` in
    `web/src/hooks/useBulkAction.ts`). The toast is "Deleted" when all succeed, otherwise "1 of 2 deleted; could not
    delete Late Night: <reason>" (up to three names, then "and N more").
  - Hide from guide / Show in guide save only the selected channels whose stealth differs. Each is read with
    `GET /api/channels/:id` first and saved with `PUT` (`toStealthUpdateRequest` in
    `web/src/helpers/channelUpdateRequest.ts`), because the channel list leaves out filler lists and subtitle
    preferences and the update replaces both with what it carries: saving the list's copy would have detached every
    filler list. The update also leaves out `startTime` (keeps a server rebase) and `onDemand` (sending it resets an
    on-demand channel's position). The toast is "Saved" or "1 of 2 saved; could not save Cartoons: <reason>".
  - The Channels table's row actions (edit, menu) moved to the last column, as on the other three tables, so the
    checkbox is the first column.
  - Keyboard: in MRT 3.2.1, Space on the focused select-all checkbox did nothing, because the header cell's shortcut
    read the checkbox's value before it toggled and then cancelled the toggle. The select-all checkbox now keeps its
    key events, so Space selects and clears the page. Row checkboxes already worked.
  - User docs: `docs/configure/channels/index.md` ("Working with several channels") and
    `docs/configure/library/index.md` ("Deleting several at once").
- **Tests:** `BulkActionsToolbar.test.tsx` (count and plural, outlined error Delete, extra actions, busy, names list
  with "and N more"); `useTableSettings.test.ts` (selection keyed by id, cleared on page and page-size change, kept on
  a no-op update); `useBulkAction.test.ts` (`settleEach` order, one failure doesn't stop the rest, server message as
  reason); `channelUpdateRequest.test.ts` (stealth update keeps filler lists and subtitle preferences, leaves out
  startTime and onDemand). Per table, selecting rows and confirming deletes exactly those ids and clears the
  selection: `ChannelsPage.test.tsx`, `FillerListsPage.test.tsx`, `CustomShowsPage.test.tsx`,
  `SmartCollectionsTable.test.tsx`. Channels also covers Hide from guide (full channel saved, filler lists kept), Show
  in guide saving only hidden channels, and a partial stealth failure naming the channel. Custom Shows covers the
  dialog staying busy until the deletes settle and a partial delete failure naming the show. Filler Lists covers the
  labelled checkboxes working from the keyboard.
- **Upstream:** not sent.

### Entity editors share the settings form shell (2026-10-20)

- **What you saw:** channel, filler-list, custom-show and slot editors each managed their own save controls and dirty-state behavior. Slot Save stayed enabled without changes; library drafts lacked consistent navigation protection.
- **Cause:** separate form scaffolding mixed React Hook Form fields with program drafts held in the editor store.
- **Fix:** audit row C3. Reuse `SettingsForm` and `useSettingsMutation`, count program drafts and refreshed previews as unsaved changes, reset fields and drafts together, and preserve drafts when visiting Add Media. Channel tabs retain validation indicators. Creation and draft saves lock their fields while pending; Reset changes is disabled during a save. Settings-page behavior remains covered by the shared-shell tests.
- **Tests:** editor regression suites cover clean/dirty Save, validation, request payloads, failed saves, creation locks, tab navigation, draft reset and navigation protection. Shared-shell, mutation and guard suites cover their common behavior. Classic slot behavior is recorded in the infinite-schedules parity checklist.
- **Upstream:** not sent.

### Guide zoom controls sit around the duration (2026-10-20, PR #116)

- **What you saw:** the guide duration and its zoom controls were in separate groups, with Show Stealth between
  them on wide screens and unrelated controls between them when the header wrapped.
- **Cause:** the duration belonged to the start-time group while the zoom buttons belonged to navigation.
- **Fix:** the zoom controls and duration share one row that stays together when the header wraps.
  The group and both buttons have translated accessible names.
- **Tests:** `GuidePage.test.tsx` checks the control order, rendered guide range and persisted duration while zooming
  in and out, including the existing one-hour and eight-hour limits.
- **Upstream:** not sent.

### Inputs use readable mobile sizing (2026-10-20)

- **What you saw:** phones rendered form inputs at 14px, which can trigger Safari focus zoom, with floating labels scaled from that small base.
- **Cause:** inputs and picker fields inherited the desktop body type size at every viewport width.
- **Fix:** approved UI follow-up D8. The theme sets input text, input labels and MUI X picker input bases to 16px below the `sm` breakpoint and 14px from `sm` up. The viewport's zoom policy is unchanged. Guide refresh fields also stack with an explicit phone layout and flex gap so the next floating label clears the preceding help text (D2/C2 follow-up).
- **Tests:** browser coverage checks text fields, selects, labels and date/time picker bases at 390px and 1440px in both colour schemes, including page overflow and screenshots.
- **Upstream:** not sent.

### Deleting a channel, filler list or custom show asks the same question as everything else (2026-10-20)

- **What you saw:** four different delete confirmations. Media sources, smart collections, transcode configs and the
  Trash page used one dialog; channels, Filler Lists and Custom Shows each had their own copy with a different layout.
  The Filler Lists copy said "Deleting a Filler will remove all programming from the channel", which is wrong. Their
  Delete button was blue, not red, and Filler Lists and Custom Shows showed no message when the delete worked.
- **Cause:** the shared `DeleteConfirmationDialog` was added after the page-local ones and nobody went back for them.
- **Fix:** issue C5 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `DeleteConfirmationDialog` is the only delete dialog. The title names the thing ("Delete Filler List "Ad Breaks"?"),
    the body is one sentence on the consequence, Cancel is outlined and the confirm button is red and reads the verb
    (Delete, or "Empty trash"). It takes an optional `details` node under the body and an optional `busy` flag that
    disables both buttons, shows a spinner on the confirm button and stops the dialog being dismissed.
  - Filler Lists and Custom Shows use it, say "Deleted" on success and "Could not delete: <reason>" on failure, and
    their copy now describes what happens (the list or show is removed from every channel that uses it).
  - `ChannelDeleteDialog` is gone. It only deleted the channel and warned about its programming, so the channel menu
    now uses the shared dialog directly and shows the same "Deleted" and "Could not delete" messages.
- **Tests:** `DeleteConfirmationDialog.test.tsx` (title and consequence, details, outlined Cancel and red confirm,
  busy state, confirm then close in order). `CustomShowsPage.test.tsx`, `FillerListsPage.test.tsx` and
  `ChannelOptionsMenu.test.tsx` check that nothing is deleted until the dialog is confirmed, that Cancel deletes
  nothing, and that "Deleted" shows afterwards.
- **Upstream:** not sent.

### Settings pages get one form shell: one save bar, the unsaved guard, one way to report a save (2026-10-20)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C1, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** on the XMLTV page, Save stayed clickable while a save was in flight, so a second click sent a
  second save. "Restore defaults" filled in the defaults without counting them as a change: "Reset changes" did not
  appear to take them back, and leaving the page did not warn that they were unsaved. Each of the other settings pages
  laid out and enabled its save bar differently (section 3 of the plan lists them).
- **Cause:** every settings page wrote its own `<form>`, save bar, mutation callbacks and error toast. XMLTV disabled
  Save on React Hook Form's `isSubmitting`, which a save started with `mutate()` never holds, and its "Restore defaults"
  made the defaults the form's new saved values, behind a separate flag that enabled Save.
- **Fix:** issue C1 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - New `web/src/components/form/SettingsForm.tsx`: wraps the fields in the `<form>` and React Hook Form's
    `FormProvider`, and renders the save bar under them. "Restore defaults" is on the left when the page passes
    `onRestoreDefaults`. On the right, "Reset changes" shows while there are changes, and Save is enabled only when the
    form has changes, they are valid and no save is in flight; while one is, Save shows a spinner. The bar wraps on
    phones. It mounts `UnsavedNavigationAlert` with the form's dirty state and passes `exceptTargetPaths` through.
  - New `web/src/hooks/useSettingsMutation.ts`: wraps the generated client's mutation options. A save that works
    makes the saved values what the form compares against and puts them in every field the user has not changed
    since pressing Save. Fields changed while the save was in flight keep the user's value and stay unsaved. Then it
    toasts "Saved" and refetches the queries the page names. A save that fails toasts "Could not save settings" with
    the server's reason.
  - `SwitchFormController` and `SelectFormController` in `web/src/components/util/TypedController.tsx`, beside the
    numeric and checkbox controllers: a labelled switch or select with help text in one element. The select stores the
    chosen option's own value, so a number stays a number.
  - The XMLTV page is ported as the reference: its fields are unchanged, and the refresh start hour uses the new
    select. "Restore defaults" now counts as a change (Save, "Reset changes" and the unsaved guard all apply) and hides
    once the form holds the defaults. After a save the form shows what the server saved, and the reload of the
    settings that follows no longer resets the form when it brings back those same values.
  - `docs/dev/contributing.md` (Web, "Settings pages") says how a settings page uses the shell and what its save bar
    guarantees. The other settings pages move onto it in C2, the entity editors in C3.
- **Tests:** `SettingsForm.test.tsx` (Save disabled when clean, enabled when dirty and valid, disabled when invalid
  and while saving; "Reset changes" only with changes and puts the saved values back; "Restore defaults" only when
  offered; the unsaved guard follows the dirty state and gets the exempt paths). `useSettingsMutation.test.tsx` (a save
  leaves the form clean with the server's values and toasts "Saved", refetches the given queries, runs the page's own
  `onSuccess`; a field changed while the save is in flight keeps its value and stays unsaved; a refused save toasts
  the server's reason and keeps the changes). `TypedController.test.tsx` covers both new controllers.
  `XmlTvSettingsPage.test.tsx` adds "Restore defaults" (fills in the defaults but keeps the output path, can be undone,
  saves with Save), the start hour saved as a number, Save disabled while a save is in flight, a field changed during
  a save surviving the save and the reload after it, and saved settings that fail validation staying unsaveable after
  another change; the restore and in-flight tests fail on the old page. The e2e spec `e2e/tests/xmltvSettings.spec.ts` saves a start hour and reloads (nothing
  else moves), and checks that restored defaults can be undone, warn before leaving and save.
- **Upstream:** not sent.

### Every settings page saves the same way: one save bar, the unsaved guard, one schedule widget (2026-10-20, PR #112)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C2, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** each settings page laid out and enabled its save bar its own way. Scanner had Save only, so a
  change could not be undone and leaving the page did not warn. General and Features did not warn either. On General,
  Save turned off for an invalid server URL without saying why; saving a new server URL put the old one back in the
  field; clearing the log-roll interval to type a new one made the field vanish and unticked "Roll on schedule"; the
  "Every N / unit / time" inputs had no labels, and the time picker was cut off on a phone. A failed save on General or
  Scanner pointed at the console or the logs instead of giving the server's reason. The Features page left out one flag's type.
- **Cause:** every page wrote its own `<form>`, save bar, mutation callbacks and error toast, and the backup and log
  rolling schedules were two copies of one hand-built widget. General's save reset the form from the settings of the
  render that pressed Save, before the new server URL was stored. "Roll on schedule" was read from the interval
  itself, so any interval that was not positive also meant "off".
- **Fix:** issue C2 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - General, Transcoding (global FFmpeg settings), Scanner, Tuner and Features are now only their fields inside
    `SettingsForm`, saved through `useSettingsMutation`. Each page lost its own mutation, toasts, save bar and unsaved
    guard. Every page now has the same save bar ("Reset changes" while there are changes; Save only when there are
    valid changes and no save is in flight) and the unsaved guard. Tuner keeps "Restore defaults", now as a change that
    can be undone. A failed save says "Could not save settings:" and the server's reason (or the error's own message).
  - Each page loads its settings into the form once, and skips a reload that brings back what the form already holds,
    so a field changed while a save is in flight keeps its value.
  - The settings forms, the guide (XMLTV) page included, validate on `onTouched`: Save turns off as soon as a value
    stops being valid, and the field says why once you have left it. General's server URL field now shows its error.
  - General: the form fills in from the saved settings with the server URL as stored when the save returns, so a new
    URL stays in the field. "Roll on schedule" is its own field; unticking it hides the schedule and leaves it out of
    the save, ticking it again brings the schedule back (a cron schedule included), and with no schedule it starts
    daily at midnight. With log rolling off, its hidden fields no longer hold up Save and neither the schedule nor the
    size limit is sent; turning rolling back on with neither set starts from the defaults (daily at midnight, 50 MB).
    Turning backups off no longer leaves Save disabled by a hidden backup interval.
  - New `web/src/components/settings/general/ScheduleFields.tsx` replaces both schedule copies: a labelled interval
    ("Backup interval" / "Roll interval", required and at least 1), a labelled unit (hours or days; a unit only
    settings.json sets stays listed) and a labelled "Time of day" for daily schedules. It wraps on a phone. A cron
    schedule shows as text. The unguarded `currentBackupSchedule!` is gone. The archive format select has a label, and
    the backup folder row stacks on a phone.
  - Transcoding: the global form uses `SwitchFormController` and `SelectFormController`; the transcode-config table
    sits below the form, outside it. Features: the switches use `SwitchFormController`, a flag an environment variable
    sets is disabled, and the flag type comes from the API, so no flag is missing.
  - Removed: `useUpdateSystemSettings` and the Tuner page's `restoreTunarrDefaults` flag.
  - Docs: `docs/dev/contributing.md` "Settings pages" names the pages and the validation mode;
    `docs/configure/system/backup.md` and `logging.md` describe the schedule fields.
- **16px inputs on phones (decision for a theme issue, not changed here):** measured in the e2e fixture at 390px in
  Chromium: inputs, selects and pickers are 14px, so a floating label shrinks to 10.5px; forced to 16px the shrunk
  label is 12px, no settings page scrolls sideways, and the outlined notch scales with it. iOS Safari zooms into a
  focused field under 16px and stays zoomed (not testable here; it applies to text inputs and likely the pickers'
  editable sections, not MUI's select, which is a `div`). Recommendation: 16px for `MuiInputBase`, `MuiInputLabel` and
  the pickers' input below the `sm` breakpoint only, 14px from `sm` up; never `maximum-scale=1`, which blocks pinch
  zoom on Android.
- **Tests:** new `ScheduleFields.test.tsx` (labels, a cleared or 0 interval stays on screen and says why, unit names
  follow the interval and hours drop the time of day, the time is kept as milliseconds after midnight, a settings.json
  unit and a cron schedule). `LogRollForm.test.tsx` adds the cleared interval, ticking with no schedule and untick then
  tick. `GeneralSettingsForm.test.tsx` adds a saved server URL staying in the field (fails on the old form) and an
  unticked schedule saved as none. New `FeaturesSettingsPage.test.tsx`; Tuner adds "Restore defaults" (undo, then
  save); Scanner adds "Reset changes"; Transcoding adds a select and a switch. Existing page tests pass with two
  updates for the shell: Scanner asserts Save is disabled for an invalid interval instead of clicking it, and Tuner's
  reasonless failure toast carries the error's message. E2E: one round-trip spec per page (`generalSettings`,
  `transcodingSettings`, `scannerSettings`, `tunerSettings`, `featuresSettings`): load, change one field, save, reload,
  the field held and the server's settings moved by that field only. `logRollSettings.spec.ts` moved unchanged into
  `generalSettings.spec.ts`, because both save the whole system settings and Playwright runs files in parallel.
- **Upstream:** not sent.

### Media sources live at one address (2026-10-20)

- **What you saw:** media sources opened at both `/media_sources` and `/settings/sources`. The second copy sat inside
  the Settings layout with no matching tab (a MUI "invalid Tabs value" warning), a second page heading, and a loader
  that prefetched scanner settings it never used. The in-app links to the sources page (the library table, the
  channel programming picker and the connect-sources prompt) pointed at the Settings copy.
- **Cause:** `routes/settings/sources.tsx` rendered the same page as `routes/media_sources_/index.tsx`.
- **Fix:** the `/settings/sources` route is gone (no redirect; the page was never linked from the nav), and the three
  in-app links point at `/media_sources`. The page files moved to `pages/media_sources/MediaSourcesPage.tsx` and
  `pages/system/TasksPage.tsx` (the tasks page was routed under `/system` but lived in the settings folder); the
  components were renamed to match. The two `knownIssues.ts` entries for the Settings copy are gone.
- **Tests:** `router.test.tsx` checks that `/settings/sources` now renders the not-found page; the route is removed from
  `e2e/tests/routes.ts` so the coverage test matches the regenerated route tree.
- **Design:** `plans/ui-primitives-and-settings-audit-2026-10-19.md`, issue C6.
- **Upstream:** not sent.

### Transcode form phone layout and validation follow-ups (2026-10-20)

- **What you saw:** some transcode fields had no phone grid width, the heading and advanced control crowded each other, and invalid numeric text exposed Zod's raw NaN message. Documentation also described a VAAPI driver selector absent from the form.
- **Cause:** responsive layout declarations began at `sm`; the resolver used its default error text; documentation described a stored setting as an exposed control.
- **Fix:** C4 follow-ups. Stack related controls and give grid fields full width on phones, present a translated numeric validation message, correct the driver documentation, and remove the unused React devtools dependency. The pending-save Reset safeguard is covered by C3.
- **Tests:** invalid bitrate and thread inputs retain Save blocking and now show the readable error; transcode form/video regression suites and phone/desktop browser layout checks.
- **Upstream:** not sent.

### The transcode config page uses the settings form shell, and one form library is left (2026-10-20)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C4, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** on a transcode config page, Save was enabled with nothing changed and stayed enabled while a save
  was in flight. Leaving the page, reloading or closing the tab with unsaved changes did not warn. After creating
  a config the page stayed on "New transcode config", so saving again created a second config. A failed save said "See
  console log for details" instead of the server's reason. "Reset changes" after turning loudness normalization on or
  off left the select showing the new choice.
- **Cause:** the transcode config form was the only form on TanStack Form. It had its own save bar and mutation
  callbacks, no unsaved guard, kept the create mode after a create, and held the loudness normalization choice in
  local state beside the form.
- **Fix:** issue C4 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `TranscodeConfigSettingsForm` and its sections (video, advanced video, audio, error) are on React Hook Form inside
    `SettingsForm`, with the same fields, defaults, sections and "Show Advanced" toggle as before: the device path only
    for VA-API and QSV, the video preset only for software H.264 and HEVC, the hardware switches only with advanced
    settings and an accelerator, the loudness targets only with advanced settings and loudness normalization on. The
    preset list still runs to veryslow and a saved preset outside it is kept.
  - The form validates with `zodResolver(TranscodeConfigSchema)`, the schema the server checks the config against, so
    the form refuses what the server would.
  - `useTranscodeConfigForm` (replacing `useTranscodeConfigFormOptions`) saves through `useSettingsMutation`: a new
    config is POSTed without an id, then the page replaces itself with the new config's edit route; an existing one is
    PUT to its id. Both refetch the transcode config queries and toast "Saved" or "Could not save settings" with the
    server's reason. While a create is in flight the fields are locked (a disabled, `inert` fieldset), so nothing
    typed after Save is lost when the page moves to the new config.
  - `NumericFormControllerText` takes an opt-in `rawValue`: the field keeps what was typed and the resolver turns it
    into a number. The transcode form uses it for every number, so an empty field saves as 0, decimals (a 44.1 kHz
    sample rate) are kept, and text after the digits ("4000k") is refused rather than dropped. Other pages are
    unchanged.
  - The loudness normalization select follows the form, so "Reset changes" puts it back, and it has an accessible
    name.
  - `SelectFormController` options take `disabled`, for the audio formats FFmpeg lacks an encoder for.
  - Removed: `web/src/hooks/form.ts`, `web/src/components/form/BasicTextInput.tsx`, `BasicSelectInput.tsx`,
    `BasicCheckboxInput.tsx`, `BaseTranscodeConfigProps.ts`, and the `@tanstack/react-form` and
    `@tanstack/react-form-devtools` dependencies.
  - `docs/configure/ffmpeg/transcode_config.md` says when Save is available, that saving a new configuration opens it,
    and that leaving with unsaved changes asks first.
- **Tests:** `TranscodeConfigSettingsForm.test.tsx` keeps the New and Edit titles and adds: an empty name, a bitrate
  or thread count that is not a number, and a loudness target outside -70 to -5 LUFS cannot be saved (these fail
  without the schema resolver); typed numbers and a decimal loudness target are saved as numbers; a resolution picked
  as WxH is saved as its width and height; only the accelerators FFmpeg has are offered; the device path, video preset
  and hardware switches show only for the accelerators they apply to and are saved; a create POSTs without an id and
  opens the new config; an update PUTs to the config's id; the unsaved guard follows the dirty state through an edit,
  "Reset changes" and a save. `TranscodeConfigVideoSettingsForm.test.tsx` runs on React Hook Form and adds that an
  empty, missing or unknown preset shows as veryfast and is kept. `TypedController.test.tsx` covers a disabled select
  option. The e2e spec `e2e/tests/transcodeConfig.spec.ts` creates a config (it is saved once and opens as its edit
  page; this fails if the unsaved guard is not bypassed for that move) and edits one (leaving warns first, the save
  goes to the same config, and only the edited field changes).
- **Upstream:** not sent.

### Every top-level page opens with the same header, and headings follow one outline (2026-10-20, PR #101)

- **What you saw:** each page set its own title. Channels, Settings, System, Guide and Media Sources used h3; Fillers,
  Custom Shows, Smart Collections, Trash and the channel pages used h4; Library switched to h5 on phones. Search had no
  title at all, only its two inputs, and with no query it listed the whole library. Inside pages, sections were h5 or
  h6 and the Tasks heading was an h4. The top bar's "Tunarr" was the page's `h1`, and after the D1 type scale it read
  at body size.
- **Cause:** there was no shared header component, so every page picked a Typography variant by eye.
- **Fix:** issue D2 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - New `web/src/components/base/PageHeader.tsx`: optional breadcrumbs, the title as the page's only `h1`, an optional
    one-line description (body2, secondary colour, at most 72 characters wide) and actions on the right that wrap
    under the title on phones. It leaves `theme.spacing(2)` below itself.
  - Used by Channels, Guide (its date, zoom and paging controls are the header's actions), Library, Filler Lists,
    Custom Shows, Smart Collections, Trash, Media Sources, Search, the Settings and System layouts, and the channel
    summary, edit, programming, watch and new-channel pages.
  - Search has the title "Search" and, until a query is entered, the line "Type to search your libraries" in place
    of the results. `docs/misc/search/index.md` says so.
  - Section headings inside a page are h2 and groups inside a section h3: General (Web Settings, Server Settings,
    Logging, Backups), FFmpeg, Features, System Status, Debug, Tasks and Troubleshoot.
  - The top bar wordmark is no longer a heading and is set at 18px, weight 600.
- **Tests:** `PageHeader.test.tsx` (title is the `h1`; description, actions and breadcrumbs render when given and
  nothing extra when not). `SearchPage.test.tsx` (title, empty state with the inputs kept, results once there are
  keywords or a filter). `TrashPage.test.tsx` asserts the page has exactly one `h1`. The e2e spec
  `e2e/tests/pageHeadings.spec.ts` checks that every top-level page has exactly one `h1` with its title.
- **Upstream:** not sent.

### One word per action, and a toast that matches it (2026-10-20, PR #100)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue D3, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** the same action had several names. Saving said Save, Update or Submit; undoing said Reset, Reset
  Changes, Reset Options or Restore Default Settings. The toast after a save was "Settings Saved!", "Feature flags
  saved!", "Channel settings saved!", "Programs saved!" or "Successfully updated Media Source settings.". On slot pages
  and the custom show form the Reset button was as loud as Save (both `contained`).
- **Cause:** every site wrote its own label and message inline, and nothing said which buttons are primary.
- **Fix:** issue D3 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`. `web/src/strings/actions.ts` (the `useActions` and `useToasts` hooks) holds the
  labels (Save, Cancel, Delete, Reset changes, Restore defaults, Add) and toasts (Saved, Deleted,
  Changes reset, Defaults restored, Could not save, Could not save settings, Could not delete). Save-bar buttons use them; Update and
  Submit became Save, Reset Options and Reset became Reset changes, Restore Default Settings became Restore defaults.
  Success toasts say "Saved" or "Deleted". Failures open with "Could not save" (generic) or "Could not save settings" (settings
  pages only) or "Could not delete", then the server's reason after a colon. Reset buttons on slot pages and the custom show form are no longer `contained`, so
  Save is the one primary button.
- **Tests:** `web/src/strings/actions.test.tsx` (keys, no duplicate labels, reason formatting); the settings page tests
  and the general settings form test follow the new wording.
- **Upstream:** not sent.

### Guide programs are muted tints keyed by show, and only "now" is teal (2026-10-20, PR #103)

- **What you saw:** every program on the Guide had a loud random hue (pink, purple, orange, green), unrelated to the
  theme, and a show's hue changed on every reload. Nothing said whether a block was a program, a flex gap or a
  redirect: flex was a faint stripe and "No programming scheduled" was a grey block. The time header drew white
  lines, invisible on the white paper. In the dark scheme the only secondary colour, `#004b79`, was 1.7:1 on the
  paper, so the Guide's loading spinner barely showed. The lineup and slot-calendar colours used the light set under
  the `system` mode on a dark computer.
- **Cause:** `useRandomProgramBackgroundColor` picked from 100 OKLCH hues at lightness 0.8 and chroma 0.2, drawn
  from an auto-seeded generator at each page load, by summing the key's character codes. `colorHooks.ts` chose the
  light or dark set from `useColorScheme().mode === 'dark'`, which is `system` until a mode is picked, not the scheme
  on screen.
- **Fix:** issue D4 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - New `web/src/components/guide/guideColors.ts`, pure functions of the palette. `guideRamp(palette)` is 8 OKLCH
    steps 45° apart, starting half a step (22.5°) from the primary's hue so no program looks like the accent. Light:
    lightness 0.90, chroma 0.05, `#bbe6f7 #d1ddff #ebd5f6 #fbd1dd #fcd4c3 #ebddb9 #d0e6c5 #bbe9df` (text 12.3 to
    12.7:1). Dark: lightness 0.36, chroma 0.05, `#1c4351 #323c58 #473550 #53323c #533427 #483c1c #324328 #1b463e`
    (text 10.5 to 11.1:1). Hover is 0.04 darker in light and 0.04 lighter in dark.
  - `programColor(palette, key)` picks the step by 32-bit FNV-1a of the key. The key is the show (or artist) for
    episodes and tracks, the program for movies and other videos, and the wrapped program for custom-show entries, so
    a show keeps its colour across reloads.
  - `typeStyle(palette, type)` encodes the type without relying on colour. Movies, episodes, tracks and other videos
    keep their ramp colour and get their `ProgramTypeIcon` (14px) before the title in cells at least 64px wide.
    Cells from 24px show the title without it, so narrow cells keep their letters; slivers show neither. Flex gaps
    and "No programming scheduled" take the page background, `text.secondary` and a dashed divider outline.
    Redirects are the secondary colour at 16% over the paper with an arrow before the title. Only programs open the
    details dialog, so only they get the hand cursor.
  - The now-playing cell gets a 2px primary ring, and the time marker (now `TvGuideNowMarker.tsx`) keeps primary.
    Nothing else on the grid uses primary. The marker jumps instead of gliding when the system asks for reduced
    motion, and block and column width transitions stop too.
  - The guide reads palette values through `useActivePalette()` (`hooks/useTunarrTheme.ts`), the palette of the
    scheme on screen, because with CSS variables on `theme.palette` stays on the light scheme.
  - Header lines use the theme divider. Times on the grid use tabular numerals.
  - Dark secondary is `#5b8fb9` (4.6:1 on the paper), with dark label text (5.4:1), since white on it is only 3.5:1.
  - `colorHooks.ts` reads the resolved scheme (`useIsDarkMode`), so the lineup editor, mid-roll rows and slot
    calendars pick the dark set under `system` on a dark computer. Those views keep their random colours.
  - The tints are muted on purpose, so they are a grouping aid, not the identity channel. The dataviz palette
    validator fails them as chart marks: below its lightness band and chroma floor, and about 4 OKLab ΔE apart for
    neighbouring hues. Every block prints its title, neighbours are separated by a gap, and type has its own shape.
- **Tests:** `guideColors.test.ts`: 8 distinct steps per scheme; `text.primary` at 4.5:1 or more on every step and
  hover step; no step within 15° of the primary's hue; the same key gives the same step, with the FNV-1a values
  pinned; episodes of one show share a key and movies do not; flex and redirect backgrounds are not ramp steps, carry
  the dashed outline and the arrow, and keep their text at 4.5:1. `guideCellType` tells movies from episodes and
  classifies custom-show entries by the program they wrap. `TvGuideItem.test.tsx`: the ramp fill, the primary ring
  only on the now-playing cell, the dashed flex outline, and the hand cursor only on programs; at 100px a movie cell
  shows the movie icon and an episode cell the TV icon, a redirect the arrow and a flex gap none; a 40px cell shows
  its text without the icon, and a sliver neither.
  `TvGuideNowMarker.test.tsx`: the marker animates by default, does not under `prefers-reduced-motion`, and is
  primary. `colorHooks.test.tsx`: `system` on a dark OS picks the dark set (fails on the old code), and on a light OS
  the light set. `theme.test.ts` adds `secondary.contrastText` on `secondary.main` at 4.5:1 and a non-text list with
  `secondary.main` on the paper at 3:1; the contrast helpers moved to `web/src/test/contrast.ts`.
  `useTunarrTheme.test.ts`: under a CSS-variables theme, `useActivePalette()` returns the dark palette in dark mode
  and the light one in light mode (the first fails when it returns `theme.palette`).
- **Upstream:** not sent.

### Settings and the channel editor use people's words, and help fits in two lines (2026-10-20, PR #104)

- **What you saw:** the settings tabs were General, XMLTV, FFMPEG, Scanner, HDHR and Features, and the channel editor's
  third tab was EPG. Help under fields ran up to 464 characters, seven lines at the 72-character help width, and the
  same page spelled FFMPEG, ffmpeg and FFmpeg. Creating a transcode config opened a page titled
  `Edit Transcode Config: "New Config"`. The subtitle switch said "extaction". The help under Auto Deinterlace Video
  described watermarks. The backup folder help gave the server's run directory as the default, though an empty path
  saves to the data directory's `backups` folder. A tuner count of 0 was outlined in red with no message, because a
  field with help text dropped the default "must be >= 1" message.
- **Cause:** copy was written field by field as features landed, with no shared way to hold a longer explanation, so
  each one went into the help line. `NumericFormControllerText` printed `fieldError.message`, which is empty for a
  rule without its own message, when the field also had help.
- **Fix:** issue D5 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.

  - 85 help texts on the settings pages, the transcode config form, the media source dialogs and the channel editor
    tabs were rewritten: one sentence where possible, at most two lines, active voice, sentence case. Facts that
    change what you do stay in the visible line (units, defaults, "applies from the next program", "needs a
    restart").
  - Longer explanations moved behind an info icon (16 fields, new `web/src/components/base/HelpTooltip.tsx`, shown on
    hover, keyboard focus or tap) or a "Learn more" link to the matching `docs/configure/` page (12 fields, new
    `LearnMoreLink.tsx`). The links come from one table, `web/src/helpers/docsLinks.ts`.
  - Labels use the words people use. Routes are unchanged (`/settings/xmltv` still opens Guide, `?tab=epg` still
    opens the channel's Guide tab), and "XMLTV" stays where it names the file.

    | Where                                            | Before                                           | After                                                                       |
    | ------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
    | Settings tab                                     | XMLTV                                            | Guide                                                                       |
    | Settings tab                                     | FFMPEG                                           | Transcoding                                                                 |
    | Settings tab                                     | HDHR                                             | Tuner                                                                       |
    | Channel editor tab                               | EPG                                              | Guide                                                                       |
    | Guide                                            | Output Path                                      | XMLTV output path                                                           |
    | Guide                                            | EPG (Hours)                                      | Guide length (hours)                                                        |
    | Guide                                            | Refresh Timer (Hours)                            | Refresh interval (hours)                                                    |
    | Guide                                            | Refresh Timer Starts At                          | Refreshes start at                                                          |
    | Transcoding                                      | FFMPEG Log Method / FFMPEG Log Level             | FFmpeg logging / FFmpeg log level                                           |
    | Transcoding                                      | Enable embedded subtitle extraction              | Extract embedded subtitles                                                  |
    | Tuner                                            | Enable SSDP server (help: "\* Restart required") | Network discovery (help says what it announces and that it needs a restart) |
    | General                                          | Server Listen Port                               | Server port                                                                 |
    | General                                          | Tunarr Backend URL                               | Tunarr server URL                                                           |
    | General                                          | Output Path / Max Backups (backups)              | Backup folder / Backups to keep                                             |
    | Transcode config title on `/settings/ffmpeg/new` | Edit Transcode Config: "New Config"              | New transcode config                                                        |
    | Transcode config                                 | Audio Loudness Normalization                     | Loudness normalization                                                      |
    | Transcode config                                 | "Advanced Video Options" above the audio options | Advanced Audio Options                                                      |
    | Channel › Properties                             | Thumbnail URL                                    | Icon URL                                                                    |
    | Channel › Flex                                   | Filler List Cooldown (seconds)                   | Clip repeat cooldown (seconds)                                              |
    | Channel › Guide                                  | Placeholder Program Title                        | Guide title for flex                                                        |
    | Channel › Guide                                  | Min. Visible in Guide Duration Program (seconds) | Shortest program in the guide (seconds)                                     |
    | Channel › Streaming                              | Channel Stream Mode / Channel Transcode Config   | Stream mode / Transcode config                                              |
    | Channel › Streaming                              | Display Watermark on Leading Edge                | Show watermark at stream start                                              |
    | Breadcrumb                                       | FFmpeg Settings                                  | Transcoding settings                                                        |
    | Sidebar version                                  | FFMPEG:                                          | FFmpeg:                                                                     |

  - Other labels on these pages moved to sentence case without new words (for example "Tuner count", "Video preset",
    "Caption alignment"). The welcome page and sidebar say FFmpeg. Watermark size, margin and period labels and the
    category log level labels are now translatable.
  - The server's refusal of a too-short guide names the new fields: "Guide length is 12 hours, too short for a
    12-hour refresh interval…".
  - `NumericFormControllerText` shows the default validation message above the help text.
  - Docs that named the old tabs or fields say Settings > Guide, Settings > Transcoding and Settings > Tuner
    (`docs/configure/channels/epg.md` is titled Guide, and now says the guide URL is on Settings > Guide, not "HDHR /
    M3U"). `docs/configure/clients/index.md` says where network discovery and the tuner count are. Screenshots in the
    docs were not retaken.

- **Tests:** `SettingsLayout.test.tsx` (the six tab labels, on the old routes), `TranscodeConfigSettingsForm.test.tsx`
  (New title on create, Edit with the name otherwise), `channelTabLabels.test.tsx` (Guide and Streaming on the epg
  and ffmpeg tabs), `HelpTooltip.test.tsx` (opens on keyboard focus, keeps its own name and is described by the
  tooltip, clicking it beside a switch leaves the switch alone), `docsLinks.test.ts` (every link points at a page in
  `docs/` and every anchor at one of its headings, slugged the way mkdocs does), `TypedController.test.tsx` (a `min`
  rule's default message shows with help text; fails before the fix). The XMLTV, General, HDHR, FFmpeg, Scanner,
  log-roll, caption and preset tests, the e2e log-roll and subtitle specs, and the server's XMLTV settings test follow
  the new labels.
- **Upstream:** not sent.

### The nav highlights the right section on every page, and Settings and System pages have breadcrumbs (2026-10-20, PR #99)

- **What you saw:** the drawer highlighted an item only on its exact path. The scanner and features settings, the
  FFmpeg config editor, System tasks and troubleshoot, and every detail page (channel programming, filler edit, source
  pages) left the drawer with nothing selected. The mobile bottom bar used a different rule, so the two disagreed.
  Settings and System sub-pages had no breadcrumbs.
- **Cause:** `useNavItems` compared the last matched route's path to each item with `===`, and hidden child entries
  patched a few settings and system pages. `BottomNavBar` compared the first path segment.
- **Fix:** issue D6 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`. `navItemForPath` in
  `web/src/hooks/navMatch.ts` picks the visible item whose path is the longest segment-wise prefix of the current
  route; both navs use it. The Settings item now points at `/settings` (which redirects to General), and the hidden
  settings and system child entries were removed. `SettingsLayout` and `SystemLayout` render `Breadcrumbs` with an
  explicit `trail` built from their tab definitions (for example Settings › XMLTV, System › Tasks). The FFmpeg config
  pages keep their own trail.
- **Tests:** `navMatch.test.ts` maps every `fullPath` in `routeTree.gen.ts` to one top-level item and checks the
  settings, system, filler edit and time-slot-editor cases; `Breadcrumbs.test.tsx` covers the trail for a settings and
  a system page.
- **Upstream:** not sent.

### Every page has the same loading, error and not-found screens (2026-10-20, PR #102)

- **What you saw:** while a page loaded, Settings and System showed a progress bar and most other pages showed
  nothing until the data arrived. Spinners came in three kinds: a rotating arrow icon, MUI's circle, and a bar. A
  failed load showed the "Oops!" page with the error only inside the stack trace, and its one button reloaded the
  browser. An unknown address showed a bare "Not found!" link, a deleted filler list or custom show showed the error
  page instead, and a server error on a channel page showed "Not found!". On System › Troubleshoot, adjacent report
  sections were split by a doubled 2px line.
- **Cause:** the router had no `defaultPendingComponent`, `defaultErrorComponent` or `defaultNotFoundComponent`, so each
  page handled these itself or not at all. Pages that read with `useSuspenseQuery` kept `isPending`/`error` branches
  that could never run. The filler list and custom show loaders had `TODO handle not found`, and the channel loader
  turned every failure, a server error included, into "not found". The Troubleshoot sections are flat bordered Paper
  since the D1 theme, and each drew its own border plus MUI's divider line.
- **Fix:** issue D7 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `web/src/routerDefaults.ts`, spread into `createRouter`: a centred progress bar in place of the page
    (`PagePending`), shown after 300ms and kept for at least 300ms so it doesn't flash; the error page
    (`RouteErrorPage`), which now shows the server's message and a "Try again" button that clears the failed queries
    and reruns the route's loaders; and a "Not found" page with a link to Channels. They render inside the app shell
    (and inside the Settings and System tabs), so the per-route error component on `/settings` and the `Suspense`
    wrappers in the Settings and System layouts are gone.
  - One spinner: `components/base/LoadingIcon.tsx` is an icon-sized `CircularProgress` with a "Loading" label.
    `RotatingLoopIcon` is gone; its 15 uses and the page-level circles in the guide, the media grid and the redirect
    dialog use `LoadingIcon`. Spinners inside buttons and input adornments stay as they were.
  - Skeletons: the Channels, Filler Lists, Custom Shows, Smart Collections, Media Sources and Tasks routes show a
    `TableSkeleton` with the table's column count while they load. The channel summary's now-playing card has a
    card-shaped skeleton.
  - The unreachable loading and error branches are gone from the XMLTV, HDHR, FFmpeg and channel edit pages. General
    and Features read their settings with suspense queries that their route loaders prefetch, so the router's
    screens cover them.
  - The channel, filler list and custom show loaders throw `notFound()` when the server answers 404 or 400 for the
    id, and pass any other failure to the error page.
  - Troubleshoot's sections stack as one group with a single 1px line between them.
  - The e2e fixture finds ffmpeg and ffprobe through `TUNARR_TEST_FFMPEG` / `TUNARR_TEST_FFPROBE`, then the `PATH`,
    then `/usr/bin` (`e2e/fixture/ffmpeg.ts`), and sets them on the fixture server before it scans, so the sweep runs
    on macOS.
- **Tests:** `router.test.tsx` renders the app's route tree at `/does-not-exist` and gets the not-found page; a loader
  that throws gets the error page with its message, and "Try again" reruns the loader; a loader that throws
  `notFound()` gets the not-found page. `routeLoaders.test.ts` checks each entity loader throws `notFound()` on 404 and
  400 and passes a 500 on. `TableSkeleton.test.tsx`, `LoadingIcon.test.tsx`, `apiError.test.ts` (missing-entity check,
  error message), and `stackedAccordionSx.test.tsx` (the second and third of three stacked accordions have no top
  border; it fails without the style). The e2e `notFound.spec.ts` visits an unknown address and missing channel,
  filler list and custom show ids; the route sweep checks for the new not-found heading.
- **Upstream:** not sent.

### The web UI has a theme: IBM Plex Sans, a type scale, and colours that pass AA in both schemes (2026-10-19)

- **What you saw:** stock Material UI. No font was loaded, so Roboto's stack fell through to Helvetica or Arial.
  Page titles (h3) were 48px, button and tab labels were in capitals, and in the light scheme the teal links and
  button labels were 4.06:1 on white, below WCAG AA's 4.5:1. The warning orange was 2.2:1 and the info grey 2.6:1.
  The dark scheme set only its primary colour, on MUI's grey `#121212` page.
- **Cause:** `web/src/theme.ts` set six light palette colours and two dark ones and nothing else. `App.tsx` hard-coded
  the light page background.
- **Fix:** issue D1 of `plans/ui-primitives-and-settings-audit-2026-10-19.md` (section 2, "Design direction").
  - Font: IBM Plex Sans, bundled from `@fontsource-variable/ibm-plex-sans` (SIL Open Font License; noted in
    `docs/dev/contributing.md`) and imported in `main.tsx`. Scale: body 14px, body2 13, h1 28 down to h6 14 at weight
    600, subtitles 15 and 13, caption and overline 12, buttons 14 in sentence case. Help text under fields is 12.5px,
    secondary colour, at most 72 characters wide. Table cells use tabular numerals.
  - Light: primary `#00757c` (5.5:1 on white), page `#f5fafc` from the palette, paper white, a teal-grey divider.
    Warning darkens to `#a46100` and info to `#676e88` so both read as text. Dark: primary `#2fb7c0`, page `#10191c`,
    paper `#182328`, error `#e07b6c`, warning `#f0a330`, success `#4caf7d`, info `#94a6c4`.
  - Inputs and buttons have 6px corners, Paper and dialogs 10px. Paper is flat (elevation 0) with a 1px divider
    border, which includes the list tables. Surfaces that ask for an elevation (app bar, drawer, menus, dialogs) keep
    their shadow and get no border. Standard and filled Alerts draw no border.
  - Buttons default to outlined, so only an explicit `variant="contained"` is filled. Tabs are sentence case. Tooltips
    wait 400ms. `PaddedPaper` pads by `theme.spacing(2)`.
- **Tests:** `theme.test.ts` computes WCAG contrast for every colour used as text (body and secondary text, primary,
  error, warning, success, info) on the page and paper backgrounds in both schemes, and for contained button labels;
  the old primary and warning fail it. It also checks the font and the outlined button default.
  `PaddedPaper.test.tsx` checks the padding follows the theme's spacing.
- **Upstream:** not sent.

### Live TV's `stream.m3u8` keeps 15 minutes of segments (2026-10-19, PR #96)

- **What you saw:** nothing on screen yet. The cost grew with a session's age. `stream.m3u8` listed every segment since
  the session started (`hls_list_size 0` with `append_list`). ffmpeg rewrote all of it after each segment, and each
  program's ffmpeg read it back in when it started. `plans/hls-playlist-growth-2026-10-19.md` measured about 136 GB of
  playlist rewrites in a day of 2 s segments, and about 585 MB per program's ffmpeg after 24 hours on jellyfin-ffmpeg
  8.1.3, the image's. On FFmpeg 7.1.1 program starts slowed down quadratically: 8–11 s after 12 hours and 54–76 s after
  24, past the 30–60 s Tunarr transcodes ahead. Upstream's Docker image runs 7.1.1, so upstream is affected worst.
- **Cause:** `HlsOutputFormat` and `HlsDirectOutputFormat` wrote a constant `-hls_list_size 0`. The `hlsListSize` in
  `HlsSession`'s options was never read.
- **Fix:**
  - `HlsSession.getHlsOptions` asks for 15 minutes of segments, `ceil(900 / segment seconds)`: 450 at 2 s, and 225 at
    4 s and in HLS Direct v2 (`HlsPlaylistWindowSeconds` and `hlsPlaylistWindowSize` in `ffmpeg/builder/constants.ts`).
    Both formats write the options' list size.
  - A session that `TUNARR_SESSION_STALENESS_MS` keeps alive unread for more than 10 minutes gets a window of its
    staleness plus 5 minutes instead, so ffmpeg never drops a segment the reader hasn't seen.
  - `append_list` and `discont_start` stay. `delete_segments` stays off, so `HlsSession` still deletes segment files.
  - Since #84 the playlist reader keeps the session's history by segment number. The served playlists count segments
    and program changes from the session's start, as before.
  - Unchanged: the WebVTT `subs.m3u8`, whose segment muxer already keeps 20 entries and has its own trimmer;
    `hls_slower`, whose concat output lists a fixed 25 and deletes its own segments; and the troubleshooting stream, one
    program, still 0.
- **Tests:**
  - `HlsOutputFormat.test.ts`, `HlsDirectOutputFormat.test.ts`, `BasePipelineBuilder.test.ts`: `-hls_list_size` comes
    from the options and defaults to the window; `append_list` stays and `delete_segments` stays off. A concat
    (`hls_slower`) build still writes its own 25.
  - `HlsSession.test.ts`: the window for each mode, segment length and staleness, handed to each program's ffmpeg. A
    45-minute simulated session whose file is ffmpeg's 450-entry window, across 83 programs (each a new ffmpeg) with
    read-ahead bursts and short last segments, polled like a player while pruning runs. Every served playlist's
    `MEDIA-SEQUENCE` is its first segment, both sequences only go forward, and each segment's discontinuity number and
    program date-time are those of the whole session's playlist.
  - `HlsAppendWindow.local.test.ts` (real ffmpeg, `pnpm test:local`, skipped without ffmpeg): three programs append to
    one playlist with `-hls_list_size 5` and Tunarr's flags. The numbering continues across each restart,
    `MEDIA-SEQUENCE` is the first listed segment, and there is no `DISCONTINUITY-SEQUENCE`. One tag precedes each later
    program's first segment, none sits after the header, and a dropped entry's tag leaves with it. It passes on FFmpeg
    9.0.2, and the same flags wrote identical playlists on the image's 8.1.3 and 7.1.1. It belongs in the real-binary
    CI job (T28).
  - 13 of the 17 new unit tests fail with `main`'s source. The others pin the flags that stay and `hls_slower`'s output.
- **Measured** with stream-repro, `main` and this change side by side: 30 minutes, 2 s segments, eight clips of 15 to
  50 s, `--rewind 15`, and the report's playlist poller, now `repro.mjs --poll-playlist`:

  |                                                              | `main`                                                                         | This change                                |
  | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------ |
  | Capture                                                      | 914 segments, 55 program joins of one tag each, no findings                    | The same, joins at the same segments       |
  | Poller                                                       | 1,724 polls, 0 violations; `MEDIA-SEQUENCE` 0→894, discontinuity sequence 0→54 | 1,732 polls, 0 violations, the same ranges |
  | Rewind 15 segments                                           | Target found, no 404s                                                          | The same                                   |
  | `stream.m3u8`                                                | 943 entries (134 KB) at minute 30 and growing                                  | 450 entries (64 KB) from minute 15 on      |
  | Written to it, minutes 15–30                                 | 47 MB, more each minute                                                        | 30 MB, 2 MB a minute                       |
  | ffmpeg peak RSS (9.0.2), median per 10 minutes               | 130–133 MB                                                                     | 130–132 MB                                 |
  | Program start to first listed segment, after minute 20       | 2.84 s                                                                         | 2.83 s                                     |
  | Cold tune-in, "HLS session ready" (median of 5, interleaved) | 313 ms                                                                         | 314 ms                                     |

  - FFmpeg 9.0.2 keeps about 170 B per entry, so memory can't show here. The report's benchmark at the window's size,
    in the fork's image: jellyfin-ffmpeg 8.1.3 peaks at 54 MB (48 MB with an empty playlist, 585 MB at 24 hours
    before). FFmpeg 7.1.1 peaks at 70 MB (65 MB; 601 MB before), and its first segment comes 10–20 ms after an empty
    playlist's (54–76 s at 24 hours before). Each rewrite stays at 65 KB.
  - Also fixed in stream-repro: with `--rewind`, a long capture's analysis (one ffprobe per segment, about 2.5 minutes
    for 914) blocked the event loop past the server's keep-alive, and the rewind's first request failed with `fetch
failed`. It now rewinds before the analysis.

- **Upstream:** not sent. Upstream's playlist reader parses the whole file on every request, so the flag alone would
  break its served playlists (report section 3(a)). The ffmpeg side is worth an upstream issue once this has run for a
  while.

### The FFmpeg settings page shows while ffmpeg is probed or broken; failed saves say so (2026-10-19)

- **What you saw:** the FFmpeg settings page stayed blank while `/api/ffmpeg-info` was loading or after it failed, so
  the executable path that would fix a broken ffmpeg couldn't be reached. A failed save on the FFmpeg or HDHR settings
  page showed nothing.
- **Cause:** `FfmpegSettingsPage` returned an empty `<div>` until the ffmpeg probe succeeded, and the FFmpeg and HDHR
  save mutations had no `onError`.
- **Fix:** the form always renders. Above the paths, a skeleton stands in while ffmpeg is probed. A warning appears when
  the probe fails or finds no encoders (the server answers with empty lists when it can't run ffmpeg), and otherwise a
  line lists the hardware acceleration ffmpeg supports. A failed settings refetch shows an error alert instead of a
  blank page. Failed saves on both pages show `Could not save settings.` with the server's reason in a snackbar
  (`FfmpegSettingsPage.tsx`, `HdhrSettingsPage.tsx`).
- **Tests:** `FfmpegSettingsPage.test.tsx` (form shown while probing, warning on a failed or empty probe, hardware
  acceleration line, refused save) and `HdhrSettingsPage.test.tsx` (refused save, save failing without a reason).
- **Upstream:** not sent; upstream `main` has the same code.

### Resetting the HDHomeRun settings gives 2 tuners, and a tuner count below 1 is refused (2026-10-19, PR #93)

- **What you saw:** not reported from the deployment. The fork review of 2026-10-19 (B6) found that the settings
  page's "Restore Default Settings" and a fresh install give 2 tuners, but the server's reset (`POST
/api/hdhr-settings`) saved 1. Any number was accepted as the tuner count, so 0, -1 or 1.5 could be saved and
  reported to Plex as the device's `TunerCount`.
- **Cause:** the reset route wrote a hand-written `{ tunerCount: 1, autoDiscoveryEnabled: true }` instead of the
  schema's defaults, and `HdhrSettingsSchema.tunerCount` was a plain `z.number()`.
- **Fix:**
  - `hdhrSettingsApi.ts` resets to `HdhrSettingsSchema.parse({})`, so the reset and the page's defaults can't drift.
  - `tunerCount` is `z.number().int().min(1)` (`settingsSchemas.ts`), so `PUT /api/hdhr-settings` answers 400 for 0,
    a negative or a fraction. The OpenAPI spec now says `integer`, `minimum: 1`; the generated web client is
    unchanged.
  - The settings page checks `min: 1` on the field ("Tuner Count must be >= 1") instead of waiting for the 400.
  - A settings file saved before this can hold such a value, and a value the file schema refuses makes the server
    start on defaults for every setting. `SettingsDB.ts` reads an old one as a whole number of at least 1 (0 or
    -3 → 1, 2.5 → 2).
  - Tests: `hdhrSettingsApi.test.ts`, `SettingsDB.test.ts`, `HdhrSettingsPage.test.tsx`.
- **Upstream:** not sent; upstream `main` has the same code.

### A new scan interval takes effect when it's saved (2026-10-19)

- **What you saw:** a new **Rescan Interval (hours)** under Settings > Scanner saved, but scans kept the old timing
  until Tunarr restarted, and the page didn't say so.
- **Cause:** `ScheduleJobsStartupTask` reads `rescanIntervalHours` once, at startup, to schedule `ScanLibrariesTask`,
  `SyncCollectionsTask` and `SyncCustomShowsTask`. `PUT /api/settings/media-source` only wrote `settings.json`.
- **Fix:**
  - `services/rescanSchedule.ts` builds the three jobs' crontabs for the startup task, and `rescheduleRescanJobs`
    moves the jobs with `ScheduledTask.reschedule`, as the XMLTV settings save does. `settingsApi.ts` calls it after a
    save. A scan under way finishes; the next one follows the new interval.
  - The save refuses, with a 400, an interval that isn't a whole number of hours, 1 or more. node-schedule can't run
    `*/0` or `*/1.5`: a refused reschedule cancels the job yet still reports its old next run, and at startup such an
    interval threw while the jobs were being scheduled.
  - The Scanner page shows "Next scan: <time>" from `GET /api/tasks`, refreshes it after a save, and flags an interval
    under 1 before saving. `docs/configure/media_sources/index.md` has a new "Scheduled Scans" section.
- **Tests:** `settingsApi.test.ts` runs the real scheduler and jobs on a fixed clock: a save moves the next scan and
  syncs, and 0 or 1.5 hours is refused with the jobs left as they were. Also `ScheduleJobsStartupTask.test.ts` and
  `ScannerSettingsPage.test.tsx`.
- **Upstream:** not sent; upstream `main` has the same code.

### Empty Trash asks before it purges (2026-10-19, PR #89)

- **What you saw:** one click on **Empty Trash** started the purge. It can't be undone: trashed programs are deleted
  and the lineup slots that played them become flex.
- **Cause:** the button called the empty-trash mutation directly (`TrashPage.tsx`).
- **Fix:** the button opens the shared `DeleteConfirmationDialog`. It says all trashed items will be deleted and their
  lineup slots replaced with flex. Its red **Empty trash** button runs the mutation; Cancel does nothing. The dialog
  takes an optional `confirmLabel`, which defaults to "Delete". The progress bar is unchanged.
  `docs/configure/library/trash.md` mentions the confirmation.
- **Tests:** `TrashPage.test.tsx` (no purge before confirming, one after, then the progress bar; Cancel purges
  nothing); `DeleteConfirmationDialog.test.tsx` (the label).
- **Upstream:** not sent. Upstream's Trash page has the same button.

### General settings: Reset works on an invalid value, and the log level help names `TUNARR_LOG_LEVEL` (2026-10-19)

- **What you saw:** not reported from the deployment; found in the fork review (B5). The log level help told you to set
  `LOG_LEVEL`. "Reset Options" was disabled while a field held an invalid value, the one time you need it. With no
  log roll schedule saved, Reset left the schedule without its `type`, so the form stayed dirty and a schedule ticked
  after that was dropped on save. A bad log roll schedule increment was reported as "Max Backups".
- **Cause:** the server reads `TUNARR_LOG_LEVEL` (`server/src/util/env.ts`). The Reset button was disabled on
  `!isValid`. Reset filled the form from `getBaseFormValues`, while load and save used `getDefaultFormValues`, which
  also fills in the log roll schedule (with its `type`) and size. `LogRollForm` copied BackupForm's field name.
- **Fix:** `GeneralSettingsForm.tsx` has one `getDefaultFormValues` for load, a successful save and Reset; Reset is
  enabled whenever the form has changes; the help text names `TUNARR_LOG_LEVEL`. `LogRollForm.tsx` names the field
  "Roll Schedule Increment". Tests: `GeneralSettingsForm.test.tsx`, `LogRollForm.test.tsx`.
- **Upstream:** not sent; upstream `main` has the same code.

### The New Channel page shows its breadcrumbs, and Settings opens on General (2026-10-19, PR #90)

- **What you saw:** the New Channel page had an empty breadcrumb trail. Opening `/settings` showed the tab bar with no
  tab selected over an empty panel, and MUI warned that the Tabs value was invalid.
- **Cause:** `NewChannelPage.tsx` imported MUI's `Breadcrumbs` instead of the app's `components/Breadcrumbs.tsx`, which
  builds the trail from the URL. The settings layout route had no index child, so at `/settings` its tab value came
  out as `'/undefined'`.
- **Fix:** the page uses the app's `Breadcrumbs` and reads Channels › New (`useRouteName.ts` already named
  `/channels/new`). A new index route, `routes/settings/index.tsx`, redirects `/settings` to `/settings/general` in
  `beforeLoad`. The e2e sweep maps the new `/settings/` path and no longer expects the Tabs warning on `/settings`.
  The `/settings/sources` warning is a separate issue and stays listed.
- **Tests:** `NewChannelPage.test.tsx` finds the Channels link and New in the trail; `router.test.ts` loads the app's
  route tree at `/settings` and `/settings/` and lands on `/settings/general`. Both fail without the fix.
- **Upstream:** not sent. Both defects are in upstream's code.

### Reloading or closing a clean editor no longer asks "Leave site?" (2026-10-19, PR #91)

- **What you saw:** the browser's "Leave site?" dialog on reload or tab close with nothing changed, on every page that
  warns about unsaved changes: the channel editor, the programming page, both slot editors, and the FFmpeg, XMLTV
  and HDHR settings pages.
- **Cause:** `UnsavedNavigationAlert` called TanStack Router's `useBlocker` without `enableBeforeUnload`, which
  defaults to on. The browser-level handler in `@tanstack/history` reads only that option and never calls
  `shouldBlockFn`, so the dirty check guarded in-app navigation but not reload or close.
- **Fix:** `UnsavedNavigationAlert.tsx` passes `enableBeforeUnload: isDirty`, so the browser dialog follows the same
  dirty state as the in-app one. In-app blocking and `exceptTargetPaths` are unchanged.
- **Tests:** `UnsavedNavigationAlert.test.tsx` mocks `useBlocker`: the browser prompt is off for a clean form, on for
  a dirty one, and follows `isDirty` across re-renders; `shouldBlockFn` blocks only a dirty form and lets it reach an
  exempt path.

### The top bar's dark mode button works the first time on a light OS (2026-10-19)

- **What you saw:** until a mode was picked in settings, the first click on the top bar's moon icon did nothing on a
  computer set to light. A second click turned dark mode on.
- **Cause:** with no mode chosen, MUI's mode is `system`. `DarkModeButton` set `mode === 'light' ? 'dark' : 'light'`,
  so from `system` it always set `light`, which looked the same as a light OS.
- **Fix:** `nextColorMode(mode, resolved)` in `useTunarrTheme.ts` flips a chosen light or dark mode, and under
  `system` flips the scheme on screen (`useColorScheme().colorScheme`). The unused `theme.themePreference` store field
  is gone, with the load-time step that wrote it. `store/index.ts` drops the key from a stored theme on load, so it
  is not saved again.
- **Tests:** `useTunarrTheme.test.ts`: light to dark, dark to light, system on a light OS to dark, system on a dark OS
  to light. `DarkModeButton.test.tsx`: with the OS scheme stubbed, one click from `system` changes the scheme both
  ways (on the old code a light OS needed two). `store/index.test.ts`: a stored theme with `themePreference`, or from
  before it, hydrates without it, logs no error, and is written back without it.
- **Upstream:** not sent.

### Every channel form field marks its tab when it has an error (2026-10-19)

- **What you saw:** nothing yet. The channel editor puts a red dot on the tab (Properties, Flex, EPG, Streaming) that
  holds a field with an error. Its hand-written field lists left out `startTime`, `onDemand`, `transcodeConfigId`,
  `disableFillerOverlay`, `id` and `duration`. None of these has a validation rule today, so no dot is missing yet.
  A rule added to one of them later would leave Save disabled with no dot on any tab.
- **Fix:** `channelFieldTabs.ts` maps each field to its tab as a `Record<keyof SaveableChannel, EditChannelTabs>`, so
  a new channel field without a tab fails to compile. `EditChannelForm.tsx` marks tabs from it. `id` and `duration` are
  not inputs on any tab and go to Properties. Test: `channelFieldTabs.test.ts` checks the map against
  `SaveableChannelSchema.shape` and checks that an error marks the right tab.
- **Upstream:** not sent; upstream `main`'s field lists have the same gaps.

### Dead delete dialogs and settings hooks removed from the web app (2026-10-19, PR #86)

- **What you saw:** nothing; cleanup from the 2026-10-19 fork review.
- **Cause:**
  - The channels page had its own channel delete dialog, but its open state was only ever set back to empty, so it
    never opened. Deleting a channel goes through `ChannelOptionsMenu` and `ChannelDeleteDialog`.
  - The FFmpeg settings page had a transcode config delete mutation and confirmation dialog that nothing opened.
    `TranscodeConfigsTable` has its own. Its `restoreTunarrDefaults` flag was never set to true.
  - `usePlexStreamSettings` and `usePlexSettings` in `web/src/hooks/settingsHooks.ts` had no callers.
- **Fix:** all of the above removed (`ChannelsPage.tsx`, `FfmpegSettingsPage.tsx`, `settingsHooks.ts`). The FFmpeg
  page's Save and Reset Changes buttons now depend on `isDirty` alone, which is what they already did. No behaviour
  changes. Locale catalogs are left to the post-merge `lingui extract` job.
- **Tests:** none added; removal only. The web suite, `pnpm turbo typecheck` and `pnpm lint-changed` pass.
- **Upstream:** not sent; upstream `main` has the same dead code.

### The Live TV playlist reader keeps the session's history itself (2026-10-19, PR #84)

- **What you saw:** nothing yet. This prepares the fix for `stream.m3u8` growing for as long as a session runs
  (`plans/hls-playlist-growth-2026-10-19.md`, task T37). ffmpeg runs with `hls_list_size 0` and `append_list`, so with
  2 s segments it rewrites about 136 GB of playlist a day, and jellyfin-ffmpeg 8.1.3 holds about 585 MB per program
  after 24 hours. The fix (T38) keeps only 15 minutes of segments in the file. Today's reader can't read such a window.
- **Cause:** in a window, the first entry moves on with every rewrite. `MediaPlaylistReader` took a changed first entry
  for a rewritten file and parsed it again from the window's first entry. The report's probe (section 3(a)) showed
  program date-times late by the dropped duration and moving between polls, and a discontinuity sequence that stopped
  advancing.
- **Fix** (`MediaPlaylistReader.ts`, `MediaPlaylistIndex.ts`):
  - While `#EXT-X-MEDIA-SEQUENCE` is 0, the file lists the whole session (always so today) and the reader works as
    before. The served playlists are byte-identical.
  - Once it is above 0, the reader anchors on segment numbers. It reads the last 2 KiB of the file (the whole window
    when needed), finds the last segment it parsed, and appends only newer entries to its own history. A
    discontinuity tag counts only between a known entry and a new one. discont_start's header tag is still a header
    artifact.
  - A gap in the numbering (segments that left the window unread) is logged once and counted as one discontinuity,
    plus the target duration for each missing segment. A 15-minute window should make it unreachable.
  - A window with no complete entry, or whose last entry read is cut off, leaves the history as it is, and so does a
    failed read. A window that lists only older segments is parsed afresh, with a warning.
  - A filter that reaches segments the index discarded is clamped to the kept ones instead of parsing the file again
    (`HlsPlaylistMutator.trimIndex`'s `clampToKept`). A window can't rebuild their times, and their files are deleted.
    `HlsSession`'s filters never reach there.
- **Tests:**
  - `MediaPlaylistReader.test.ts`, a windowed oracle: for random sessions, after every change, the window ffmpeg
    writes with `hls_list_size` 5 to 40 (`MEDIA-SEQUENCE` = first entry, discont_start's tag only while it is 0, no
    `DISCONTINUITY-SEQUENCE`) is served exactly as `ReferenceHlsPlaylistTrim` trims the whole session's playlist, with
    and without `HlsSession`'s pruning (`testing/hls/FfmpegHlsPlaylist.ts` writes both).
  - Unit cases: a new ffmpeg whose window starts mid-program, tags at the window's head at session start and later, a
    gap with and without a tag, the clamp, failed reads (the first read of a window, and the read of a window parsed
    afresh), partial and empty windows, numbering that goes back, and a window read with no history.
  - `HlsSession.test.ts`: a request on a 20,000-segment session whose file is a 450-entry window reads under 8 KiB and
    serves the whole-playlist trim.
  - 31 of the 32 new tests fail on `main`. The other one pins today's behaviour: after a failed read, a file that lists
    the whole session is parsed whole again. The existing reader, mutator and session tests pass unchanged.
  - stream-repro, before and after (10 minutes, 2 s segments, eight clips of 15 to 50 s, `--rewind 15`, with a
    playlist poller): the same in both runs.
    - **Capture:** 306 segments from 20 programs, with no findings.
    - **Rewind:** found every segment it listed.
    - **Poller:** 274 requests, zero continuity violations. `MEDIA-SEQUENCE` went from 0 to 286 and the
      discontinuity sequence from 0 to 17, both only forward. No segment's program date-time or discontinuity
      changed between polls, and each segment started where the one before it ended.
    - **Latency:** median 1.85 ms before, 1.77 ms after.
- **Upstream:** not sent. Upstream's reader parses the whole file on every request.

### A repeated audio track is filtered once, not once per slot (2026-10-19, PR #81)

- **What you saw:** nothing on screen. The fork review of 2026-10-19 (task T32) found that with a channel audio track
  layout such as `eng, jpn`, a program with only English audio repeats its English track in the `jpn` slot, and ffmpeg
  ran the whole audio filter chain once per slot on identical input, loudnorm included.
- **Measured** before changing anything. Tunarr's own command, captured by stream-repro for `audioTracks: ["eng","jpn"]`,
  an English-only program and loudnorm `I=-24:LRA=7:TP=-2`, was run on 120 s of input without `-readrate`, against the
  same command with one chain and `asplit` (ffmpeg 9.0.2, a 14-core Mac, user CPU seconds, medians):

  | Output                      | One chain per slot | One chain + `asplit` | Saved          |
  | --------------------------- | ------------------ | -------------------- | -------------- |
  | 1080p x264, stereo AAC 192k | 63.37 / 61.91 s    | 58.92 / 59.00 s      | 7.0% / 4.7%    |
  | 1080p x264, 5.1 AC3 384k    | 48.62 s            | 40.90 s              | 7.7 s, **16%** |

  - The stereo row is two rounds of five runs. The audio path alone (`-vn`) shows the same saving with less noise:
    8.70 → 5.66 s stereo (4.8% of the whole process) and 16.99 → 8.93 s for 5.1.
  - A second loudnorm costs as much as the first. loudnorm resamples to 192 kHz internally, so the cost grows with
    the channel count.
  - With 5.1 the repeated loudnorm also held back the whole transcode. The filter graph runs in one thread, so the
    run took 16.9 s of wall time instead of 8.6 s.

- **Cause:** `ComplexFilter` built one chain per output track:
  `[0:1]aresample=async=1,apad,loudnorm=…,aresample=48000[a0];[0:1]aresample=async=1,apad,loudnorm=…[a1]`.
- **Fix:** `ComplexFilter.ts` builds one chain per source stream. Slots that repeat a source share its chain, split
  after the filters: `[0:1]aresample=async=1,apad,loudnorm=…,aresample=48000,asplit=2[a0][a1]`.
  - Volume, loudnorm and the gap-music fades run once per source.
  - Labels, `-map`s and `-metadata:s:a:N language=` tags stay in slot order.
  - A single track, and a layout whose slots all use different streams, build the same command as before.
- **Verified** with stream-repro before and after, using layout `eng, jpn` on English-only clips with loudnorm on (the
  new `--transcode-setting` option turns it on):

  | Mode            | Before                              | After                    |
  | --------------- | ----------------------------------- | ------------------------ |
  | HLS, stereo     | 12/12 segments `[eng 2ch, jpn 2ch]` | 13/13 segments, the same |
  | HLS, 5.1 AC3    | 9/9 segments `[eng 6ch, jpn 6ch]`   | 9/9 segments, the same   |
  | MPEG-TS         | the whole capture `[eng, jpn]`      | the same                 |
  | HDHomeRun `.ts` | the whole capture `[eng, jpn]`      | the same                 |

  - Audio timestamps at the program join are identical before and after.
  - The `.ts` capture flags a one-packet audio overlap at the join, before and after. A second one appears when the
    tune-in seek puts the next program one video frame later. That depends on the tune-in time, not on this change.

- **Tests:** `BasePipelineBuilder.test.ts`:
  - a repeated source with volume, padding, loudnorm and both fades gives one chain with one `loudnorm`, the fades
    after it, then `asplit=2[a0][a1]`, with maps `[a0] [a1]` and tags `eng`, `jpn`;
  - three slots whose first and third share a source split only those two, and keep the output order;
  - distinct sources with loudnorm give exactly the graph from before;
  - with the audio copied, a repeated source is mapped twice.
  - The first two fail without the fix.
- **Upstream:** not sent.

### MPEG-TS states no longer inherit an earlier HLS session's output format (2026-10-19)

- **What you saw:** not reported from the deployment. The `videoPreset wiring` tests in `FfmpegStreamFactory.test.ts`
  failed under `--sequence.shuffle` (seeds 4 and 7): an MPEG-TS session run after an HLS Direct v2 one was built as
  passthrough.
- **Cause:** `FfmpegState` defaulted `outputFormat` and `outputLocation` to the shared `MpegTsOutputFormat` and
  `StdoutOutputLocation` objects, and its constructor deep-merges the caller's fields into them. So each HLS or HLS
  Direct v2 session rewrote `MpegTsOutputFormat` as its own format. A later program stream given `MpegTsOutputFormat`
  (an MPEG-TS channel, HLS Direct with mpegts output, the debug stream API) got the HLS muxer writing into that
  session's directory, or a passthrough copy. Plex's `.ts` of an HLS channel was not affected: its wrapper and concat
  pipelines always write MPEG-TS.
- **Fix:** `FfmpegState.ts` starts each state from its own copy of the two defaults. Tests: `FfmpegState.test.ts`, and
  factory tests that run an HLS or HLS Direct v2 session, then an MPEG-TS one.
- **Upstream:** not sent; upstream `main` has the same code.

### batch publication lookups and clean stale temporary files (2026-10-19)

- **Change:** Lists existing artwork once per publish, removes stale temporary files, and uses the shared public URL origin helper. HTTP fixtures are isolated from network access.

### expose memory tuning and index library pagination (2026-10-19)

- **Change:** Adds opt-in SQLite cache, mmap and warmup controls, preserving existing cache defaults. Migration 0056 indexes library pagination after EXPLAIN showed a temporary sort. Adds an explicit-transaction policy check.
- **Tests:** covered by the local completion candidate; this branch is independently checked in CI.
- **Upstream:** not submitted; personal fork.

Newest first. Each one is its own commit with a test, so it could be sent upstream later on its own
(`git cherry-pick <commit>` onto a branch from `upstream/main`).

### Subtitle text decoding and discovery reliability (2026-10-19)

- **What changed:** subtitle downloads and extraction preserve legacy-encoded text, local subtitle discovery accepts filename extension case variations, and stream details retain stored embedded SDH flags.
- **Fix:** media-source subtitle requests read bytes and share BOM-aware UTF-8/Windows-1252 decoding. Local subtitle matching and extracted-file reads use the same decoding path.
- **Validation:** targeted decoding, request, discovery, extraction and stream-details tests cover these paths.
- **Upstream:** not sent; personal fork change, stacked on caption-boundary PR #65.

### Pipeline output-rate review correction (2026-10-19)

- **Fix:** playback parameters retain the source-based target; the selected pipeline applies its actual deinterlacer once. Caption renditions use the final pipeline rate, preventing doubled field-rate targets.
- **Validation:** calculator, caption cadence and software/QSV/VAAPI/NVIDIA pipeline unit regressions.

### Playback session completion and bounded HLS read-ahead (2026-10-19)

- **What changed:** HLS and transport-stream sessions share their caption decision, subtitle planning returns one cohesive result, and read-ahead encoding has a configurable thread limit. Playback uses the final pipeline output rate for captions.
- **Fix:** session types carry explicit caption capability; the factory keeps subtitle conversion, burn-in and caption fallback together. HLS session buffering, playlist mutation and transcode-speed monitoring use the candidate's completed playback lifecycle handling.
- **Validation:** targeted playback and session regressions, source-based typechecks, and freshly generated API/client contracts on this branch.
- **Review round 2 (follow-up to #77, after it merged):**
  - Caption refusals warn once per kind (`CaptionRefusalKind` from `insertCaptions`), not once per reason text, which named a byte offset or a continuity counter and so warned on every segment.
  - Decomposed (NFD) subtitle text is composed to NFC before CEA-608 encoding and the 10% unrepresentable-cue check, so `café` keeps its accent and is not burned in for it.
  - A `.ts` stream that inherits captions off from a running HLS session logs that, instead of blaming its H.264 video.
  - The slow-transcode warning names read-ahead threads only when read-ahead raised the count.
  - The missing-drawtext warning is given again after switching ffmpeg back, and its warn-once state resets between tests.
  - `SessionManager.sessionCaptionsEnabled` takes a `ChannelStreamMode`.
  - A captioned external subtitle file is read and decoded once per program (`decodeSubtitleFile` returns the text and ffmpeg's charset).
  - Docs: the Read-ahead Thread Limit row in the FFmpeg settings table, and when subtitles that can't become captions are burned in even with the WebVTT sidecar flag on.
  - Kept: the `captionsEnabled ?? hdhrCaptionsEnabled(...)` fallbacks in `HlsSession` and `ConcatStream`. `SessionManager` always supplies the decision, but the ConcatStream and HlsSession suites build streams without it and test the rule through the fallback.
- **Upstream:** not sent; personal fork integration stacked on the pipeline-output-rate and subtitle-text-reliability PRs.

### Narrow gap-music lookup and deleted-list cleanup (2026-10-19)

- **What changed:** gap-music selection reads only the program fields it needs, avoiding full filler-list program materialization. Deleting a list clears its channel gap-music references.
- **Fix:** `FillerListDB.getGapMusicPrograms` selects track identity, playback eligibility and artist display fields; `GapMusicPicker` uses that result. List deletion removes `offline.musicListId` while preserving other offline settings.
- **Validation:** database tests check the selected fields and deleted-list cleanup; stream-program regressions use the narrower database contract.
- **Upstream:** not sent; personal fork change.

<!-- Entry format:
### Short title (YYYY-MM-DD, commit)
- **What you saw:** the symptom.
- **Cause:** what in the code produced it.
- **Fix:** what changed, with the files.
- **Upstream:** not sent / issue or PR link.
-->

### A stuck or garbled scan worker no longer blocks the scan queue (2026-10-19)

- **What you saw:** nothing yet. The fork review of 2026-10-19 (`plans/fork-review-2026-10-19.md`, section 9) found
  ways a scan worker could leave every later scan and custom show sync waiting until restart, with nothing in the log.
- **Cause:**
  - `WorkerScanJobRunner` logged and ignored a worker message that failed validation. If that was the job's
    `scan-done` or `scan-failed`, the job never ended, and the coordinator's one-at-a-time queue waited on it
    forever. Nothing limited how long a job could run.
  - Worker messages carried no protocol version, so nothing caught a worker and main thread that disagree on the
    messages (a bundle replaced on disk while the server runs, with a protocol change in it, say).
  - `TunarrSubprocessService` set the worker's role only when the caller passed no `workerData`. A worker started
    with `workerData` came up as a pool worker, which says it started and then ignores the scan it is sent.
  - After a job, the runner removed its `error` listener. An error as the worker exited reached only the process's
    uncaught exception handler, which writes to `console.error`, not the log file.
  - A scan or sync that was already queued was logged at error as "Could not acquire lock". The nightly collection
    sync does this routinely.
- **Fix:**
  - **Malformed messages** (`WorkerScanJobRunner.ts`): a message from the job's worker that fails validation stops
    the worker, and the job fails with the validation error once the worker has exited. The coordinator then
    releases its lock as for any failed job. The wait means the next job can't start while the old worker may still
    hold the database's write lock. A malformed progress update or event is still only logged, since neither ends a
    job. A job canceled meanwhile still ends as canceled.
  - **Workers that can't be stopped:** Node's `terminate()` only takes effect once a thread returns to JavaScript, so
    a thread stuck in native code (a long SQLite statement, a hung mount) never reports that it exited. Once a
    worker has been told to stop (malformed message, time limit, or a cancel it ignored), its job ends at most
    `exitGraceMs` (5 s; 10 s after a graceful stop) later regardless, and the error is logged.
  - **Protocol version** (`types/worker_schemas.ts`): `ScanWorkerProtocolVersion` (1) goes to the worker in
    `workerData`, and the scan worker sends its own in its `started` event. Bump it when the scan worker messages
    change incompatibly. A worker whose version differs, or that sends none (a pool worker), fails to start. Every
    later worker would run the same code, so scans stay on the main thread until restart, logged once at error.
    The worker also logs a warning when the main thread's version differs from its own.
  - **Role** (`TunarrSubprocessService.ts`): `workerStartData` keeps the caller's `workerData` and always sets the
    role and version. `start-worker` reads both through the `WorkerStartData` schema.
  - **Late errors:** each scan worker has an `error` listener for its whole life. While it starts or runs a job, the
    error fails that, as before. At any other time it is logged at error through Tunarr's logger.
  - **Job time limit:** `TUNARR_SCAN_JOB_TIMEOUT_MINUTES` (default unset: no limit). A job in a worker that runs
    longer is logged, its worker terminated (its open transaction rolls back), and the job fails once the worker
    has exited. Scans on the main thread aren't limited. The limit is logged at startup. A value that isn't a whole
    number of minutes (`90s`, `0.5`) is ignored with a warning, and one past what a timer can wait (35,791 minutes) is
    capped. Documented in `docs/getting-started/run.md`.
  - **Already queued** (`MediaSourceScanCoordinator.ts`): logged at info as "Not queuing … it is already queued or
    running".
- **Tests:**
  - `WorkerScanJobRunner.test.ts`:
    - Malformed messages: a malformed `scan-done` or `scan-failed` fails the job, but only after the worker has
      exited. A worker that can't be stopped fails it anyway. A canceled job still ends as canceled. Malformed
      progress or events don't fail the job. With the real coordinator, the library's lock is released and its next
      scan runs.
    - Protocol version: a worker that starts with another version, or none, runs the job on the main thread. After
      one mismatch, no more workers start.
    - Errors: an error after the job is logged. One during the job fails it and isn't logged twice.
    - Stuck workers: a canceled job whose worker can't be stopped still ends.
    - Time limit: with a 50 ms limit, a job that never ends is terminated and fails, also when its worker can't be
      stopped. A job that ends in time isn't touched. Without a limit, a long job runs to the end.
    - `scanJobTimeoutMs` reads whole minutes and logs them. It is quiet when unset or 0, warns on negative, `90s`,
      `0.5` and non-numbers, and caps at the longest timer delay.
  - `ScanWorkerRoundTrip.test.ts`: a worker started with its own `workerData` still starts as a scan worker and
    runs the job.
  - `TunarrSubprocessService.test.ts`: `workerStartData` keeps the caller's data and options and sets role and
    version; `WorkerStartData` reads a missing or unknown role as `pool`.
  - `ScanWorker.test.ts`: `started` carries the version; a different main-thread version is logged.
  - `MediaSourceScanCoordinator.test.ts`: an already-queued sync is logged at info, not error.
  - Each new test fails with its fix reverted.
- **Upstream:** not sent.

### A program's captions end where the next item starts, and each segment names its own program's language (2026-10-19)

- **What you saw:** found in code review, not on the deployment.
  - When a program's video stopped before its scheduled end (ffmpeg exited early, or the file is shorter than its
    recorded duration) and the next item had no captions of its own (flex time, an error screen, filler without
    subtitles), that item carried the rest of the earlier program's dialogue, up to the earlier program's scheduled end.
  - A captioned HLS segment's PMT named the language of the newest program's captions, so a client still fetching one
    program's last segments after the next one started got the next program's language on them. The `.ts` stream for
    HDHomeRun clients was not affected: `CaptionLanguageStream` relabels its PMT with the first language preference.
- **Cause:**
  - `HlsSession.transcode` advances `transcodedUntil` by the program's planned length before ffmpeg runs, and
    `addCaptions` lays the program's captions out over that planned length. The next program starts where the last
    segment's video ended (`getPtsOffset`), which is inside the earlier window when ffmpeg stopped early. Only a
    program with captions added an entry to the caption timeline, so for an item without any, `captionEntryAt` found
    the earlier program's entry and `captionPairs` sent its schedule.
  - `captionedSegment` took the language from `#captionTimeline.at(-1)`, the newest entry, whichever program the
    segment belonged to.
- **Fix:**
  - At every program start, with captions or without, `HlsSession.endCaptionsAt` cuts each timeline entry's window at
    the new program's start PTS (on the 33-bit clock). Only frames from the new start on change, and those belong to
    the new program, so a program keeps its own frames' captions. A captioned next program's frames resolve to its own
    entry as before. A program whose video ends a frame short of its plan counts as cut too, which only adds the
    erase below.
  - Where a window was cut, the first two frames within a second after the cut that no program's captions cover carry
    Erase Displayed Memory instead of padding, so a caption showing when the program stopped doesn't stay up over the
    next item.
  - When the last segment can't be read (ffmpeg left it empty), the next program starts again at `SessionStartPts`,
    under programs that already played. Those that start inside its planned span are emptied, so none of their
    captions go out over it. A program it won't reach keeps its captions for the segments viewers are still fetching.
  - An entry cut to nothing leaves the timeline, so a run of programs that fail at once can't push out a program whose
    segments are still being served.
  - `insertCaptions` (`MpegTsCaptionInserter.ts`) can take the language as a function of the segment's frames, asked
    after `pairsForFrames`. `captionedSegment` passes one that looks up the entry for the segment's first frame
    (`captionLanguage`), and falls back to the first language preference only when no entry covers it.
  - Still open: when the item after an early stop has captions of its own, a caption the stopped program left on
    screen stays up until that item's first caption replaces it, as before. Erasing there would mean adding an erase
    to the start of the next program's schedule in `Cea608Encoder`.
- **Tests:** `HlsSession.test.ts`, "captionedSegment > across programs", with programs run through the session's own
  loop:
  - The first program has a line every 2 s for 30 s and its video ends 10 s in; the next has no captions. A segment
    4 s into the first keeps its captions. The next item's first two frames erase the screen and the rest are padding.
    A segment 12 s after the first program started is padding only.
  - After the clock goes back, a segment inside an earlier program's window is padding only. When the program the
    clock went back to is planned short of that earlier program, the earlier one keeps its captions.
  - After ten programs that each fail at once, the first program's segment still has its caption.
  - A program in `jpn` whose video ends early, then one in `eng`: the first one's last segment has `jpn` in its ISO
    639 and caption service descriptors, the next one's `eng`. A segment past every program's window gets the first
    language preference.
  - Five of these fail on the old code. The sixth (the earlier program kept) passes there, and fails if the clock
    check empties every later program. Taking out the erase, the clock check or the pruning fails its own test.
    `MpegTsCaptionInserter.test.ts`: the language function gets the frames' PTS in presentation order. The other
    caption tests and the golden snapshot are unchanged.
- **Upstream:** not sent.

### Search key replacement and backup guidance (2026-10-19)

- **Cause:** replacing a missing or invalid key wrote directly to the destination, read failures were treated as missing keys, and reused files could retain broad permissions.
- **Fix:** publish a generated key through a private temporary file and atomic rename; preserve existing keys on read/publication failure; tighten reused key files to owner-only permissions on the main thread. Workers only read existing valid keys.
- **Backups:** the built-in archive omits `meilisearch-master-key`; keep a private copy separately and restore it before startup.
- **Tests:** `searchMasterKey.test.ts` covers generation/reuse, permissions, worker refusal, rename failure and read failure. Native `MeilisearchService.local.test.ts` covers restart authentication and retained indexed data when a key is regenerated.
- **Upstream:** not sent. This is hardening for the search authentication change in this personal fork.

### ffmpeg's and ffprobe's logs no longer carry media-server tokens (2026-10-19)

- **What you saw:** found in a review of the fork's logging on 2026-10-19, not on screen. ffmpeg prints its input URL
  on stderr (`Input #0, … from 'http://…?X-Plex-Token=…'`, and again when it can't open it), so
  a failed transcode's error dump put the media server's token in Tunarr's log, in the `ffmpeg-error-log-*.log` file it
  writes and on the console. A failed ffprobe or subtitle extraction did the same. This is upstream's code; the fork
  hadn't changed it.
- **Cause:**
  - `FfmpegProcess` redacted only its args line, and only `X-Plex-Token=` and the `X-Emby-Token: ` header form. It
    missed Emby's `?X-Emby-Token=` query form (Emby stream URLs) and `api_key=`. With ffmpeg logging on, stderr went
    to `process.stderr` raw, and on a failed run its last 25 KiB went to the log at error level, to the error-log file
    and to `process.stderr`, all unredacted. A failed spawn logged the arguments too, through the error's `spawnargs`.
  - `ChildProcessHelper.getStdout`, which runs ffprobe and the subtitle extraction, logged the command line at debug.
    `execFile`'s error holds the command line and stderr in its message and `cmd`, and `SubtitleExtractorTask` logs it
    at warn. `FfmpegInfo.probeFile` logged the path and ffprobe's raw output, whose `format.filename` is the URL, when
    the output didn't parse.
  - The redaction regexes had three copies (`FfmpegProcess`, `HttpStreamSource.redact`, twice in
    `TroubleshootService`), each with a different set of keys.
- **Fix:**
  - `server/src/util/redactSecrets.ts`: `redactSecrets` covers `X-Plex-Token` and `X-Emby-Token` in query (`=`) and
    header (`: `) form, also quoted, `api_key` and `ApiKey`, a bare `token` query parameter and the
    `MediaBrowser … Token="…"` header, ignoring case as the servers do. A value runs to the next delimiter, so an odd
    character can't leave part of it showing. `RedactSecretsStream` applies it to a stream and holds back the
    unfinished last line, so a token split across two reads is still caught. A line over 64 KiB, which ffmpeg doesn't
    write, is passed on up to that point with ` [line truncated]` and the rest of it dropped, so a token the cut splits
    can't leak. `redactErrorSecrets` cleans an error's message, stack, `cmd` and `spawnargs`.
  - `FfmpegProcess` pipes stderr through `RedactSecretsStream` before the console and the 25 KiB tail read it, so the
    error-level dump, the error-log file and the console copy are redacted. The dump adds the stream's held line, so a
    last line ffmpeg hadn't finished when it exited isn't lost. Its args line and spawn errors use the shared function.
  - `ChildProcessHelper.getStdout` redacts its debug line and the error it rejects with; `FfmpegInfo.probeFile` its
    warning.
  - `HttpStreamSource.redact` and the troubleshoot report (stream path, ffmpeg args and the ffmpeg log it returns) call
    `redactSecrets`.
  - Not covered: ffmpeg's own report file (`FFREPORT`, written when `enableFileLogging` is on; off by default) starts
    with the command line, and ffmpeg writes it itself.
- **Tests:**
  - `redactSecrets.test.ts`: each key form, mixed case, several in one text, real ffmpeg stderr lines, a value with odd
    characters, and text without secrets unchanged. For the stream: a key and a value each split across chunks, a
    multi-byte character split across chunks, finished lines passed on at once, the held line read before the end,
    and overlong lines cut inside a long value and between a header key and its value.
  - `FfmpegProcess.test.ts`: a shell stand-in for ffmpeg prints its input URL (one line split inside the key across
    two writes, and a last line with no line break) and exits 1 while a background process keeps its stderr open. The
    error-level log, the error-log file and everything written to `process.stderr` have `REDACTED` and never the
    token, and the dump has the last line; so do the args lines and the `error` event's `cmd`. Spawning a missing
    binary logs `spawnargs` redacted.
  - `ChildProcessHelper.test.ts` and `ffmpegInfo.test.ts`: a failing stand-in ffprobe's error and debug line, and the
    warning for output that doesn't parse, are redacted. `types.test.ts`: `ApiKey=` and a lowercase `x-emby-token=`.
  - All of these fail on the old code. The kill test from the `.ts` wrapper fix passes unchanged.
- **Upstream:** not sent. It's upstream's code, so it could go upstream as a plain bug fix.

### expose saved encoder presets with accessible labels (2026-10-19)

- **Change:** Saved slow, slower and veryslow presets now appear in the editor, select labels are associated with their controls, and the unused Soundtrack field is removed in favor of Gap music.

### Merged completion: playback, subtitles, controls and runtime checks (2026-10-19)

- **What changed:** the completion work spans PRs #62–#77 (bounded Plex guide notifications,
  scan-worker protocol/watchdog handling, guide refreshes across midnight, caption boundaries and language,
  and FFmpeg secret redaction). All implementation PRs were independently reviewed and merged; the completion record links their merge commits.
- **Playback:** the selected pipeline filters determine the emitted frame rate and caption cadence;
  software, NVIDIA, VAAPI and QSV command-construction regressions cover normal and software-fallback paths.
  A caption eligibility decision is shared by a channel's HLS session and its transport-stream wrapper.
- **Subtitles and controls:** downloaded legacy-encoded subtitles retain accents, burn-in/conversion receives
  a detected Windows-1252 override, embedded SDH flags come from the stored track, and slow/slower/veryslow
  presets are selectable with accessible labels. Now-playing text is constrained by picture width as well as height.
- **Throughput and background work:** configurable read-ahead and SQLite tuning limits, x265 thread pools,
  average frame-rate selection for variable-rate files, case-insensitive subtitle discovery, per-library
  scanner notices, parallel gap asset resolution, a narrow gap-track query, cleanup of deleted gap-music
  references, queued custom-show responses and batched artwork discovery.
- **Database:** migration `0056_program_library_pagination` adds `(library_id, uuid)` for
  library paging. A seeded query plan used a temporary sort before the index and an ordered
  covering index afterward; the migrated-database regression checks that plan.
- **Operations:** search keys are replaced atomically with private permissions; backup instructions name the
  separate key file. Missing drawtext and audio-language fallback have explicit diagnostics. API generation
  retains its temporary database through server initialization; generated contracts are refreshed. Release
  creation is rerunnable. The runtime-tests Docker target checks real binaries and the packaged scan worker;
  PR, nightly and manual validation build that target without publishing.
- **Readability and redaction follow-up:** subtitle planning returns one result, custom-show syncs
  expose queue acceptance separately from completion, and caption-capable sessions share an explicit
  contract. Query and header redaction use separate boundaries so punctuation cannot leave credential
  suffixes visible. Synthetic regression fixtures cover process errors and saved logs; this does not
  establish that any real credential was exposed. The logging fix was independently reviewed and merged in PR #66; its addressed review thread is resolved.
- **Evidence and limits:** see `plans/fork-completion-2026-10-19.md` for historical candidate results and head-specific CI. Final source head `1e615493` passed Build CI (3,706 tests passed, 2 skipped) and native Linux runtime validation (39 passed, 60 GPU cases skipped; 14 packaged-worker checks). The completion record links the exact runs and distinguishes earlier subset evidence.
  Hardware command tests do not establish GPU playback support. Client verification and a deployment soak
  remain pending. No image is published or deployed by this integration work.
- **Upstream:** not submitted; this is personal-fork completion work.

### An HEVC or MPEG-2 channel's .ts stream no longer offers an empty caption track (2026-10-19)

- **What you saw:** found in code review, not on the deployment. With closed captions for HDHomeRun clients on, a
  channel with subtitles on whose transcode config outputs HEVC or MPEG-2 video had its subtitles burned in, as it
  should since the H.264 check below, but its `.ts` stream still offered Plex a caption track that never showed
  anything. Every segment was read and parsed before being refused, with only a debug line to show for it, and the
  log said "closed captions need H.264" at info once for every program.
- **Cause:** two copies of the rule. `FfmpegStreamFactory.captionsOn` checked the output video format, but
  `ConcatStream.captioned` did not. That getter decides whether the `.ts` wrapper asks for captioned segments
  (`captions=true`) and relabels the PMT through `CaptionLanguageStream`. So `HlsSession.captionedSegment` parsed each
  segment in full before `insertCaptions` refused it as not H.264. Meanwhile `CaptionLanguageStream` added the
  caption-service descriptor to the HEVC (0x24) or MPEG-2 (0x02) video entry, which advertised captions. The info
  line repeated because the factory is made per program (`ProgramStream`).
- **Fix:**
  - `stream/captions/hdhrCaptionsEnabled.ts` holds the rule. `hdhrCaptionsEnabled` needs the switch, the HLS stream
    mode, the channel's subtitles and H.264 output. `hdhrCaptionsWanted` is the same without the format.
    `captionsOn` and `ConcatStream.captioned` both call it. The wrapper turns its concat mode into the HLS session's
    mode with `ConcatStreamModeToChildMode` and reads the format from the channel's transcode config.
  - An HEVC or MPEG-2 channel's wrapper asks for plain segments and keeps ffmpeg's own PMT, as with the switch off.
  - The info line moved from `captionsOn` to `ConcatStream.createSession`, so it is logged once each time the `.ts`
    stream starts. It names the channel number, the transcode config and its format. The factory no longer logs it.
  - `insertCaptions` still refuses video that isn't H.264, as a fail-safe.
  - `docs/configure/ffmpeg/index.md` (Requirements) describes the whole channel, not only the transcode. The API
    description of the `captions` playlist parameter (`streamApi.ts`) names the H.264 requirement, and the OpenAPI
    document and web client were regenerated.
  - The two sides still read their inputs at different times: the wrapper when its stream starts, the transcode
    partly per program. A change made while a channel plays can still split them until both restart (a known
    risk, not changed here).
- **Tests:** new `hdhrCaptionsEnabled.test.ts` covers each input. In `ConcatStream.test.ts`, for HEVC and MPEG-2 with
  the switch and subtitles on, the playlist URL has no `captions` flag and there is no output sink. The info line is
  logged once per wrapper, and not at all when captions weren't asked for or the channel is H.264. The H.264 tests
  are unchanged apart from the fixture's format. In `FfmpegStreamFactory.test.ts`, an HEVC or MPEG-2 channel logs no
  info line about captions over two programs. The wrapper, log and factory tests fail on the old code.
- **Upstream:** not sent.

### validate packaged binaries and make fork releases rerunnable (2026-10-19)

- **Change:** Requires real-binary and packaged-worker tests before the final image is assembled, adds PR/nightly/manual native Linux validation, repairs temporary paths in API generation, restores the upstream latest spec, and updates existing release notes on reruns. Release serialization remains in place.

### Captions keep the accented letters of Windows-1252 subtitle files (2026-10-19)

- **What you saw:** nothing reported; found in the 2026-10-19 fork review. A subtitle file saved in Windows-1252 or
  Latin-1, as older rips often are, lost its accented letters in the closed captions: `café` came out as `caf` and
  `niño` as `nio`. A UTF-16 file gave no captions.
- **Cause:** `loadProgramCaptions` (`ProgramCaptions.ts`) read every subtitle file as UTF-8. A Windows-1252 accented
  letter is one byte that isn't valid UTF-8, so it became U+FFFD, and the CEA-608 encoder drops characters it has no
  code for. A UTF-16 file decoded as UTF-8 has no timing line the parser can read.
- **Fix:** `server/src/stream/captions/decodeSubtitleText.ts` turns the file's bytes into text, and
  `loadProgramCaptions` uses it. It is the only place Tunarr reads a subtitle file's text for captions.
  - A byte order mark (UTF-8, UTF-16 LE or BE) decides. Otherwise UTF-8 when the bytes are valid UTF-8, or when they
    hold at least as many valid non-ASCII characters as broken sequences, so one stray byte in a UTF-8 file doesn't
    turn every `é` into `Ã©`. Otherwise Windows-1252.
  - Windows-1252's 0x80-0x9f (`’ – “ ” … €`) comes from a table, not `TextDecoder('windows-1252')`: Node 22.20.0
    decodes those bytes with it as Latin-1 control codes, which the encoder would drop.
  - Burn-in is unchanged. ffmpeg's subtitle decoder reads byte order marks but, without a `charenc`, leaves out every
    line that isn't valid UTF-8. Decoding a Windows-1252 SRT with ffmpeg 9.0.2 drops its accented lines with
    `Invalid UTF-8 in decoded subtitles text`, and the `subtitles` filter (jellyfin-ffmpeg's too) skips a line its
    decoder rejects. Such lines were never burned in either.
  - Not covered: a subtitle Tunarr downloads from the media server (when it can't read the file) arrives as text the
    HTTP client has already decoded as UTF-8, so a Windows-1252 file the server sends as is is cached without its
    accented letters.
- **Tests:** `decodeSubtitleText.test.ts`: UTF-8 with and without a byte order mark, UTF-16 LE and BE with one,
  Windows-1252 `café` and `niño`, its punctuation at 0x80-0x9f, plain ASCII, a UTF-8 file with a stray byte or a
  cut-off last character, a Windows-1252 file holding one valid UTF-8 pair, an empty file, and every byte of the code
  page. In `ProgramCaptions.test.ts`, a Windows-1252 SRT gives `café`, `niño` and `It’s` in its cues and `é` and
  `ñ` in the 608 stream, and a UTF-16 SRT gives its cue; both fail on the old code. The golden snapshot is unchanged.
- **Upstream:** not sent (the closed captions are this fork's).

### Merged upstream main as of 2026-10-18

- **What came in:** 25 upstream commits, up to `b09a7e06`.
  - #2288: the subtitle playlist keeps its `#EXT-X-DISCONTINUITY` markers and discontinuity sequence when trimmed.
  - #2324: subtitle burn-in paths are escaped for both of ffmpeg's parsers (the fork already did this; see below).
  - #2232: an index on `program_grouping` (media source, library, external key), migration `0053_real_raza`. A later
    upstream commit registers it in `DirectMigrationProvider`, which #2232 left out.
  - Tone mapping with `tonemap` and `tonemap_opencl` passes the peak as a multiple of 100-nit reference white
    (`peak=10`, not `peak=1000`), so the CPU curve is no longer normalized for 100,000 nits.
  - #2327: `tonemap_opencl` returns VAAPI frames when a download follows. #2322: VAAPI MPEG-2 output uses
    `mpeg2_vaapi`.
  - #2308: saving a channel sends `startTime` only when it was changed, so a save no longer undoes a rebase
    (`UpdateChannelRequest`).
  - #2294: artwork ignores a `cachePath` whose file is missing. #2304: the OtherVideo NFO parser reads `uniqueid` as
    a list. #2319: `gcd` no longer loops on zero.
  - #2338: the Node.js version is gone from the sidebar and `/api/version`. #2332: the library scan spinner stops
    when a scan finishes. #2331: copy to clipboard works over plain HTTP and in dialogs. Three log roll form fixes, with
    an e2e test.
  - TypeScript 7.0.2: `tsc` is now the Go compiler, so every `tsgo` script runs `tsc` and
    `@typescript/native-preview` is gone. `.pnpmfile.cjs` gives the tools that still need the JS compiler API
    TypeScript 5.9.3.
  - #2318: a Docker compose setup for testing on GPU hardware. #2325: CI uses `actions/checkout` v7. #2333, #2334:
    web tests and docs. Two plans.
- **Conflicts:**
  - `HlsPlaylistMutator.ts`: only the comment above `parseSubtitlePlaylist` conflicted, beside the fork's
    `selectSegments`. #2288 changes the subtitle playlist path, which the fork never changed: it still reads the
    whole subtitle playlist, unlike the media playlists that `MediaPlaylistIndex` reads incrementally. So #2288's
    code and its tests came in unchanged.
  - `SubtitleFilter.ts`: the fork's version stays. It passes the path as the named `filename` option, escaped with
    `escapeFilterOptionValue`, where #2324 escapes a positional path and its `=` too. #2324's `SubtitleFilter.test.ts`
    cases now expect `subtitles=filename=...` with `=` left as is, and their paths are in the round-trip list in
    `escapeFilterValue.test.ts`. Its real-ffmpeg test, `SubtitleFilter.local.test.ts`, typed its subtitle source with
    the wrong `StreamSource`, which the fork's local-test typecheck caught; it now uses the input builder's.
  - `TonemapFilter.ts`: the fork's curve choice and HDR10 side data strip, with upstream's `toFfmpegTonemapPeak`. The
    fork's own curve tests expect `peak=10`. `tonemapx` passes no peak, so it is unchanged.
  - `BasicChannelRepository.ts`: both sides' imports. `server/package.json`: both typecheck scripts run `tsc`, and
    the fork's local-test typecheck and bench scripts stay. `stream-repro/scripts/repro.mjs`: both sides' options.
  - The OpenAPI document was regenerated.
- **Migrations:** upstream's `0053_real_raza` keeps its number. The fork's two were regenerated after it with
  `drizzle-kit generate`, one at a time, with the same SQL:
  - `0053_flawless_donald_blake.sql` → `0054_flawless_donald_blake.sql` (`channel.audio_tracks`)
  - `0054_serious_rattler.sql` → `0055_serious_rattler.sql` (`channel.captions`)
  - They keep the registry keys they were released with, `migration1792160617` and `migration1792181517`.
    `resolve-migrations` would have joined them into one new migration under a new key. A database that already
    ran them would then hold two names the build doesn't know, and startup would stop with
    `DatabaseSchemaTooNewError`. With the keys kept, such a database runs only `0053_real_raza` (key
    `migration1791321608`, which sorts before them).
- **Tests:** new in `DBAccess.test.ts`: a database with the fork's two keys and without upstream's migration and
  index runs only `0053_real_raza`, gets the index, and keeps both columns. With a changed key it fails with
  `DatabaseSchemaTooNewError`. `pnpm drizzle-kit check` passes and `drizzle-kit generate` finds no schema changes.

### Caption housekeeping: dead code removed, one channel-caption merge for server and web (2026-10-18)

- **What you saw:** nothing; cleanup from the 2026-10-18 captions review (`plans/closed-captions-review-2026-10-18.md`).
- **Cause:**
  - `exactFrameRate` in `ProgramCaptions.ts` was only called by its own tests. The output frame rate comes from
    `ffmpeg/outputFrameRate.ts`.
  - `HlsSession.addCaptions` passed no keyframe interval for HLS Direct v2, a branch that never ran:
    `FfmpegStreamFactory` only builds captions for transcoded video, and HLS Direct v2 copies it.
  - The channel page (`web/src/helpers/channelCaptions.ts`) had its own copy of the server's merge of a channel's
    caption settings over the global ones.
- **Fix:**
  - `exactFrameRate` and its tests are gone. `addCaptions` always passes the segment length as the keyframe interval,
    with a comment that copied video never gets captions.
  - `shared/src/util/channelCaptions.ts` (`@tunarr/shared/util`) holds the merge (`channelCaptionLook`), whether a
    channel has its own look (`channelHasOwnCaptionLook`) and what is saved (`normalizeChannelCaptions`). The server's
    `channelCaptionAppearance` flattens the merged look into the encoder's appearance, and the test pattern rule stays
    on the server. The web keeps `changedCaptionAppearance` for its form.
  - The two copies behaved the same: a field the channel leaves undefined keeps the global value, and its alignment
    falls back to the global one. Nothing changes on screen.
- **Tests:** the merge, own-look and saved-form tests from both sides are in `shared/src/util/channelCaptions.test.ts`,
  plus one case: a setting turned off (`upperCase: false`) still counts as the channel's own. The server keeps tests
  for the flattened look and the test pattern, the web for `changedCaptionAppearance`. `ChannelCaptionsField.test.tsx`
  and the `HlsSession.test.ts` caption tests pass unchanged, and the golden snapshot is unchanged.

### Caption work is timed in the log, per segment and per program (2026-10-18)

- **What you saw:** nothing. A review of the closed captions found two synchronous steps on hot paths that nothing
  measured, so there was no way to tell whether either needs a cache.
- **Cause:**
  - Each request for a captioned `.ts` segment (`/stream/channels/:id/hls/:file?captions=1`) reads the segment and runs
    `insertCaptions`, a full MPEG-TS parse and rewrite, inside the request handler, once per viewer per segment, with
    no cache.
  - At each program start, `FfmpegStreamFactory.loadCaptions` reads and parses the subtitle file (the fallback over
    the program's tracks may read several), and `HlsSession.addCaptions` builds the program's whole caption schedule
    with `buildCaptionSchedule`. Both run before ffmpeg is spawned, so a viewer tuning in waits for them.
- **Fix:** timings in the log, to get numbers before deciding on a per-segment cache or a deferred schedule build.
  - `HlsSession.captionedSegment` logs one **debug** line per captioned segment: the file name, bytes in, frames
    captioned, read ms and rewrite ms.
  - The session adds up its rewrites and, when it stops, logs one **info** line:
    `Captioned N segments: mean X ms, max Y ms`. A session that captioned nothing logs no line. Segments that could
    not be captioned are not counted.
  - `HlsSession.addCaptions` logs at **debug** the cue count, the program's start PTS and length, and the schedule
    build ms.
  - `FfmpegStreamFactory.loadCaptions` logs at **debug** the subtitle file's name (not its path), the read and parse
    ms, and the program's cue count.
- **Tests:** in `HlsSession.test.ts`, a captioned segment logs one debug line with its 60 frames and non-negative
  times; two captioned segments give a summary of 2 with a max equal to the slower one; a session that captioned
  nothing, or only a segment it could not caption, logs no summary; the schedule line has the cue count. In
  `FfmpegStreamFactory.test.ts`, reading a track logs its file name and the one cue in the program. On the test's
  synthetic 60-frame, 45 KB segment, a rewrite took about 2 ms the first time and 0.7 ms the second, and the read
  0.2 ms. Real segments are much larger.
- **Upstream:** not sent.

### The real-ffmpeg caption test runs again, and the typecheck now covers it (2026-10-18)

- **What you saw:** with ffmpeg installed, `pnpm test:local CaptionInsertion` failed all ten tests with
  "options.pairsForFrames is not a function", while CI stayed green.
- **Cause:**
  - `insertCaptions` replaced its per-frame `pairForPts` option with `pairsForFrames`, which gets a segment's frame PTS
    list at once, but `CaptionInsertion.local.test.ts` still passed the old one.
  - The `*.local.test.ts` tests need real binaries, so `pnpm test` skips them, and the typecheck
    (`tsconfig.build.json`) leaves out every test, so nothing reported it.
  - Three other local tests had type errors of the same kind: a `SearchParser` built without its `MediaSourceDB`, a
    `Buffer` passed as an `expect` message, and two helpers nothing calls.
- **Fix:**
  - The caption test builds each segment's pairs the way `HlsSession.captionPairs` does for one program:
    `pairsForFrames` over the schedule, with each frame's PTS as its time in milliseconds. The language test sends
    padding on every frame. The assertions are unchanged.
  - The Meilisearch, NVIDIA and QSV local tests and `testing/ffmpeg/FfmpegIntegrationHelper.ts` compile again.
  - The server's `pnpm typecheck`, which CI runs, also checks the local tests (`tsconfig.local-test.json`, script
    `typecheck:local-tests`, about 3 s). `pnpm build` compiles the same files as before.
  - The other tests are still not typechecked; between them they have about 650 type errors.
- **Tests:** `pnpm test:local` with Homebrew's ffmpeg 9.0.2 and Meilisearch: the ten caption tests, the two session
  start tests, the Meilisearch test and seven of the eight software pipeline tests pass. The software subtitle burn-in
  test fails because that ffmpeg has no `subtitles` filter (no libass). The VAAPI, QSV and NVIDIA tests skip on a Mac.
  With `pairForPts` put back, `pnpm typecheck` fails with TS2353.

### The .ts stream only carries a caption track on channels with subtitles on (2026-10-18)

- **What you saw:** nothing on screen. With **Closed captions for HDHomeRun clients** on, every HLS channel's `.ts`
  stream was captioned, including channels with subtitles off, which never have a caption to show. Each of their
  segments went through the caption rewrite for padding alone, on the shared server's CPU.
- **Cause:** `ConcatStream.captioned` checked only the stream mode (`hls_concat`) and the global switch. So the
  `.ts` wrapper asked for the HLS playlist with `captions=true` on every HLS channel, the playlist marked every
  segment, and `/stream/channels/:id/hls/:file?captions=1` ran each one through `HlsSession.captionedSegment` and the
  TS rewriter. The wrapper's output also went through `CaptionLanguageStream`. The transcode side already skipped
  these channels: `FfmpegStreamFactory.captionsOn` requires `channel.subtitlesEnabled`.
- **Fix:** `ConcatStream.captioned` also requires `channel.subtitlesEnabled`, the same gate the transcode uses. The
  `captions=true` playlist flag and the `CaptionLanguageStream` sink both follow it. A channel with subtitles off gets
  plain segments and ffmpeg's own PMT, as with the global switch off. The setting is read at tune-in, as before.
- **Tests:** new `ConcatStream.test.ts`. With captions on and the channel's subtitles off (or never set), the playlist
  URL has no `captions` flag and there is no output sink; both subtitles-off cases fail on the old code. With
  subtitles on, the URL has `captions=true` and the sink is a `CaptionLanguageStream`. With the global switch off, or
  in the MPEG-TS stream mode, no channel is captioned.
- **Upstream:** not sent.

### Closed captions only for H.264 output; other formats keep burned-in subtitles (2026-10-18)

- **What you saw:** found in code review, not on the deployment. With closed captions for HDHomeRun clients on, a
  channel whose transcode config outputs HEVC or MPEG-2 video would show Plex neither its full text subtitles burned in
  nor captions. The only trace was a debug line, `Serving segment ... without captions`.
- **Cause:** `FfmpegStreamFactory.captionsOn` checked the setting, the HLS stream mode and the channel's subtitles, but
  not the output video format. So the program's full text subtitles went to the WebVTT sidecar instead of being burned
  in, and `insertCaptions` then refused every segment, since it only writes CEA-608 into H.264 (stream type 0x1b).
- **Fix:** `captionsOn` is false unless the transcode config's video format is H.264, and logs once per program (at
  info) that the program gets its subtitles as with captions off. It's worked out once in `createStreamSession` and
  passed to `buildTranscodeInputs`, before the frame rate is pinned and captions are loaded. So with HEVC or MPEG-2
  output, full text subtitles are burned in, there's no "No captions for this program" notice or test pattern, and the
  frame rate isn't pinned for captions. Normalize Frame Rate still pins it.
- **Tests:** `FfmpegStreamFactory.test.ts`, under "HDHomeRun closed captions", for HEVC and MPEG-2 output: full text
  subtitles are burned in with no captions, no notice, no test pattern, a standard rate stays unpinned, and Normalize
  Frame Rate still pins it; H.264 output still sends captions and pins the rate. The first four fail on the old code.
- **Upstream:** not sent.

### Gap music shows its artist and title on the offline picture (2026-10-18)

- **What you saw:** during a gap the offline picture played gap music, but nothing on screen said what was playing.
- **Cause:** nothing drew text on the offline picture. The track's artist and title never left the database.
- **Fix:**
  - `StreamProgramCalculator.pickGapMusic` puts the picked track's artist on the offline item. It comes from the
    track's artist grouping, which `getFillerPrograms` already loads, or else the track's `artistName`.
  - `ProgramStream.resolveNowPlaying` builds the line with `nowPlayingLine` (`ffmpeg/nowPlayingText.ts`): "♪ Artist —
    Title" on one line, NFC-composed, cut with "..." past 32 ems. Widths come from the font's own glyph advances
    (`ffmpeg/fontMetrics.ts`, a small cmap/hmtx reader).
  - No line is drawn when the font lacks one of the characters, when the track's stream didn't resolve (a silent gap),
    or when the channel's new `offline.showNowPlaying` is false. It's on by default; the checkbox is **Show the artist
    and title** under Gap music.
  - The font is M+ Rounded 1c Bold (OFL, 3.5 MB, `server/src/resources/fonts`). It covers Latin, Greek, Cyrillic, kana
    and about 5,000 kanji, which matters because drawtext uses one font with no fallback.
  - `loadNowPlayingFont` copies the font to `<data dir>/fonts`, because the packaged binary keeps its resources in its
    snapshot, which ffmpeg can't read. That folder is outside `cache/`, which backups include. The font is copied again
    if it goes missing, and the bundle script copies `resources/fonts` into `dist`.
  - `FfmpegStreamFactory.createOfflineSession` adds `NowPlayingTextFilter` (drawtext) as the picture input's first
    filter, when ffmpeg has `drawtext` (`FfmpegInfo.hasFilter`). It runs on the software frame at the picture's own
    size, before every pipeline's scale or GPU upload. On CUDA, QSV and VAAPI it also comes before the loop filter, so
    the text is drawn once.
  - The line is sized and placed from the picture's height: `fontsize=h/30`, centred 94.6% of the way down, cream text
    on a `black@0.6` box. That sits below the lettering on the cards but past the 95% title-safe line. The text is
    escaped for both of ffmpeg's parsers (`escapeDrawtextValue`) and drawn with `expansion=none`.
- **Tests:**
  - `fontMetrics.test.ts`: a format 4 map, and the bundled font's format 12 map.
  - `nowPlayingText.test.ts`: line format, whitespace, combining accents, missing glyphs, cutting to width, the font
    copy.
  - `NowPlayingTextFilter.test.ts`: escaping, the filter, and drawtext first in the software, NVIDIA, VAAPI and QSV
    pipelines.
  - `FfmpegStreamFactory.test.ts`: drawn first; not drawn without drawtext.
  - `ProgramStream.test.ts`: the font is copied, and copied again; nothing drawn when turned off or over a silent gap.
  - `StreamProgramCalculator.test.ts`: the artist from the grouping, else the column.
- **Checked** with ffmpeg 8.1.3 on 1920×1080 channel cards scaled to 720p. Quotes, colons, commas, brackets,
  semicolons, `%` and backslashes draw literally, Japanese titles draw, and the strip's centre measured at 94.6% of the
  height.
- **Upstream:** not sent.

### The guide rebuild hours carry on past midnight, so the guide no longer runs out (2026-10-19)

- **What you saw:** nothing on the deployment yet; the fork review of 2026-10-19 found it. With a start hour other than
  00:00 (fork PR #50, "The guide's full rebuild can run at a chosen hour" below), the scheduled rebuilds stopped at
  midnight: every 4 hours from 12:00 rebuilt at 12:00, 16:00 and 20:00, then not until 12:00 the next day, and every
  6 hours from 23:00 rebuilt once a day. Each rebuild writes EPG (Hours) of guide (12 by default), so Plex would show
  an empty guide for hours every day.
- **Cause:**
  - `hoursFromCrontab` listed the hours from the start hour up to 23 and stopped there, on purpose, and its test
    locked in "every 6 hours from 23 runs once a day".
  - Nothing adds to the guide between rebuilds: `UpdateXmlTvTask` writes `programmingHours` from the rebuild, and
    `TvGuideService.getChannelLineup` only logs a warning when asked past the end.
  - Nothing stopped a refresh timer the guide can't last either, which runs out the same way at any start hour.
- **Fix:**
  - `hoursFromCrontab` (`util/schedulingUtil.ts`) lists `(start + k × interval) mod 24` for each k with
    `k × interval` under 24, sorted. Every 4 hours from 12 is 0, 4, 8, 12, 16 and 20; every 6 hours from 23 is 5, 11,
    17 and 23. From 00:00, and with 24 hours or more, the hours are the same as before.
  - An interval that doesn't divide 24 starts again at the start hour each day, so the day's one short gap comes just
    before it: every 5 hours from 4 is 0, 4, 9, 14 and 19. Counting on until the hours repeat would land on every hour
    that steps of the interval reach (every 5 hours would run every hour) and change the hours from 00:00.
  - Daylight saving time is node-schedule's (cron-parser 4.9): on the day the clocks go forward, an hour that doesn't
    exist (02:00 in the US) runs at 03:00, once even when 03:00 is listed too; on the day they go back, a repeated
    hour runs once, so a one-hour rollback adds an hour of real time. Kept as it is: no run is lost, and
    the guide length rule below covers the longer wait.
  - The rule, in `@tunarr/shared/util` (`xmlTvRefresh.ts`) for the server and the settings page: the time between
    rebuilds is the timer rounded, from 1 to 24 hours (a longer timer rebuilds once a day), and EPG (Hours) has to be
    at least two hours longer than it, covering two-hour seasonal rollbacks.
  - `PUT /api/xmltv-settings` refuses a shorter guide with a 400 and the reason, when the request sets the timer or
    EPG (Hours). Settings saved before the check can still have their other fields changed.
  - Those settings are rebuilt often enough anyway: `xmlTvRefreshCrontab` shortens the interval to two hours less than
    the guide (a 24 hour timer with a 12-hour guide rebuilds every 10 hours), and startup logs a warning saying so.
  - Settings > XMLTV flags the timer on the field (also when EPG (Hours) is lowered under it, and when the page opens
    on settings saved before the check) and shows the server's reason if a save is refused. A value that isn't a
    number is left to the numeric check. The start hour field is now **Refresh Timer Starts At**, since it's no longer
    always the day's first rebuild.
  - `NumericFormController` spread the caller's rules over the merged `validate`, so a field with its own `validate`
    lost the "should be numeric" check. The merged one now goes last, with the caller's checks first so their
    messages are unchanged.
  - On upgrade, a start hour other than 00:00 with a timer under 24 hours rebuilds around the clock, so more often
    than before: every 6 hours from 18:00 was once a day and is now four times. For once a day, set 24.
  - `docs/configure/channels/epg.md` describes the hours, the guide length rule, daylight saving time and the upgrade.
- **Tests:**
  - `schedulingUtil.test.ts`: every 6 hours from 23 is `0 0 5,11,17,23 * * *`; every 4 hours from 12 carries on to 0,
    4 and 8; for every start hour 0-23 and interval 1-24 no gap is longer than the interval, the start hour is in the
    list, and there are no more runs than the interval needs; from 00:00 the same runs as `*/N`; start hour 2 in
    Central time on 2026-11-01 (02:00 once, a 5-hour wait for a 4-hour timer) and 2027-03-14 (03:00 instead, no
    longer wait); the crontab is shortened for a guide too short for its timer.
  - `xmlTvRefresh.test.ts` (shared): the interval, the minimum guide, the shortened interval, and that the schedule is
    shortened exactly when the API would refuse.
  - `xmltvSettingsApi.test.ts`: a timer the guide can't last, a guide too short for the saved timer, and both at once
    are refused and nothing is saved or rescheduled; a guide two hours longer is saved; a 48 hour timer with a 26-hour
    guide is saved; old settings can have their start hour changed and are rescheduled every 10 hours.
  - `ScheduleJobsStartupTask.test.ts`: old settings are scheduled every 10 hours, with one warning.
  - `XmlTvSettingsPage.test.tsx`: the field is flagged and Save disabled, also on opening old settings; a longer guide
    clears it and both are sent; two hours longer is fine; an empty guide isn't compared; a non-number is still flagged
    as one; a refused save shows the server's reason.
  - `TypedController.test.tsx`: with its own `validate`, a field still checks for a number, runs the caller's check,
    and shows the caller's message when both fail. The first fails on the old code.
  - 12 server and 6 web tests fail on the old code.
- **Upstream:** not sent (the start hour is fork-only).

### XMLTV review follow-up

Guide coverage now conservatively allows two-hour seasonal clock rollbacks,
including Antarctica/Troll. Existing guides shorter than three hours use three
hours at runtime, without changing the saved setting, so the hourly scheduling
floor can cover them. Shared rules, API/UI messages, and regressions agree.

### The guide's full rebuild can run at a chosen hour (2026-10-18)

- **What you saw:** the scheduled full guide rebuild could only run at midnight and every refresh interval after it
  (00:00, 04:00, 08:00… local), so on a deployment where a full rebuild pauses Live TV there was no way to move it to a
  quiet hour such as 03:00.
- **Cause:** `hoursCrontab(refreshHours)` gave `0 0 */N * * *`, which always counts from hour 0, and the schedule was
  built only at startup, so changing the refresh timer took effect at the next restart.
- **Fix:**
  - New XMLTV setting `refreshStartHour` (0-23, default 0, so nothing changes until it's set). The rebuild runs at that
    hour and every `refreshHours` after it until midnight: `hoursFromCrontab` in `util/schedulingUtil.ts` lists the
    hours (`0 0 3,7,11,15,19,23 * * *` for 4 hours from 3, `0 0 3 * * *` for 24 hours from 3); from 0 it runs at the
    same hours as before.
  - **Fixed on 2026-10-19** ("The guide rebuild hours carry on past midnight", above): stopping at midnight left the
    guide empty for hours each day with a start hour other than 0 (every 6 hours from 23 ran once a day). The hours
    now carry on around the clock (5, 11, 17 and 23), and EPG (Hours) has to be at least an hour longer than the time
    between rebuilds. The field is now **Refresh Timer Starts At**.
  - `PUT /api/xmltv-settings` takes it, keeping the stored value when it is left out; a save (and a reset) moves the
    scheduled task to the new hours (`ScheduledTask.reschedule`) before the rebuild a save already ran, so neither
    waits for a restart and no extra rebuild runs.
  - Settings > XMLTV gets a **First Refresh of the Day** field.
- **Tests:** `schedulingUtil.test.ts` (crontabs for 24/3, 4/3, 1/0, 6/23 and their next runs in Central time; from 0
  the same runs as the old crontab), `xmltvSettingsApi.test.ts` (kept on a partial update, refused outside 0-23,
  reschedule before the one rebuild), `ScheduleJobsStartupTask.test.ts` (startup uses it) and
  `ScheduledTask.test.ts` (reschedule, kept by `runNow`).

### A guide refresh no longer freezes Tunarr on a cold disk (2026-10-18)

- **What you saw:** at the four-hourly guide refresh Tunarr stopped answering: 8 to 54 s on most refreshes, and 219 s
  at 21:00 UTC on 2026-10-18, when the dashboard couldn't reach Tunarr from 21:00:22 to 21:03:21. A viewer's Live TV
  stream ended during it. Guide writes after a channel save took 0.4 to 2 s.
- **Cause:**
  - A refresh re-renders every channel, so it fetches every program in the window: 811 programs for the 72-hour guide
    on the deployment, with their credits, credit headshots, artwork, genres and tags (`getGuideProgramsByIds`).
  - better-sqlite3 runs each query synchronously, and the fetch yielded only between its queries of 200 programs.
  - The main connection's page cache empties whenever another connection writes (the hourly library scans), and the
    shared server's file cache had dropped the database. So the pages came from the disk: about 6,000 of them, 400 to
    2,500 per query (counted with `sqlite3 .stats` on a copy of the deployment's database, cold).
  - At that disk's 30 ms per random read under load (IO pressure 22 to 40% all day), that is 12 to 76 s per query
    with nothing else served in between, about 180 s in all.
  - The same refresh on a warm copy takes 0.3 s (fetch 90 ms), so the cost is all disk waits.
- **Fix:**
  - Before a guide fetch, `getGuideProgramsByIds` reads `db.db` and `db.db-wal` into the file cache front to back
    with `readIntoFileCache` (the startup fix below), on the libuv thread pool, so the event loop keeps running and
    the queries after it find every page in memory (`db/databaseFileWarmer.ts`). On the deployment that read took 1.6 s
    for 148 MB. Unlike the startup read it has no 512 MiB cap, since the queries can read any page.
  - A read that finished within the last 10 minutes is trusted, so a burst of channel saves reads once, and callers
    asking during a read share it. A failed read only means slower queries.
  - Guide queries take 50 programs instead of 200 (`GuideFetchBatchSize`). Should the file cache drop the database
    anyway, the longest blocking query reads 1,300 pages instead of 2,500, and most read 100 to 250.
  - The XMLTV output is unchanged.
- **Numbers**, on a copy of the deployment's database (7 channels, 72 hours), 3 full refreshes each, a probe
  requesting `/api/version` back to back:
  - Before: refresh 304 to 334 ms, longest probe wait 44 to 50 ms, longest fetch query 23 to 28 ms.
  - After: refresh 348 to 392 ms, longest probe wait 29 to 43 ms, longest fetch query 9 to 12 ms.
  - The XMLTV matched byte for byte apart from the last programmes of the window, which depend on the minute the
    refresh ran.
- **Tests:**
  - `databaseFileWarmer.test.ts`: the provider's files are read; callers share a read in progress; a read within the
    cooldown is skipped and the next one after it runs; a failed read and a missing database path never throw; the
    real read is asked for every byte (fails with the startup cap); the event loop keeps turning while 16 MB are read.
  - `BasicProgramRepository.test.ts`: the file is read before the first query when asked, not otherwise or with
    nothing to fetch; 120 programs take 3 queries, with event loop turns between them. The first and last fail on the
    old code.
  - `TvGuideService.test.ts`: a full build and a channel save both ask for the read.
- **Upstream:** not sent.

### The Plex guide ask stops on a refused token, backs off, and can't hold up other servers or a flush (2026-10-19)

- **What you saw:** nothing yet. A review of `PlexGuideNotifier` (`plans/fork-review-2026-10-19.md`, section 11)
  found five ways it could misbehave.
- **Cause:**
  - A 401 or 403 from Plex was retried like a 503, so a token that can't work got three tries and three log lines.
    The Plex client also reported a refused token on `GET /livetv/dvrs` as a generic failure, and the reload's as
    a raw `AxiosError`, so the notifier couldn't tell it apart. A media source with no token was retried too.
  - The wait between tries was a fixed 5 s, so a restarting Plex got all three tries within ten seconds.
  - If making the client for one Plex server threw, the whole ask ended and every server after it was skipped.
    Servers were also asked one after another, so one that didn't answer held up the rest for minutes.
  - `flush()` had no time limit. A Plex that never answered held `POST /api/xmltv/flush` for up to about six minutes
    per server (60 s request timeout × 2 calls × 3 tries).
  - The retry wait was a plain `setTimeout`. It kept the process alive, and nothing cancelled it at shutdown.
- **Fix:**
  - The Plex client's `getDvrs` and `refreshGuide` both reject with an error classified by the base client's
    `requestErrorResult`: 401/403 is `auth_error`, and 404 stays `not_found`. `getDvrs` logs its failure at debug,
    since its one caller reports it. The notifier's `isPlexAuthError` checks only for `auth_error`. That server's
    ask stops at once with a warning to check its Plex token. A media source with no token gets the same warning
    without a try.
  - Each wait is three times the last: 5 s, then 15 s (`retryDelayMs`, capped at 45 s). There are still three tries.
  - Every server is asked at the same time, each with its own retry wait. Any failure is logged with the server's
    name and leaves the others alone.
    Server names are log arguments, not part of the format string.
  - `flush()` answers after 30 s at the latest (`FlushTimeoutMs`) with `{ done, servers: [{ name, outcome }] }` and
    logs what was still left. The outcomes are `reloaded`, `no_live_tv`, `auth_failed`, `failed` and `pending`.
    `POST /api/xmltv/flush` returns that answer: 200 when everything finished, as before, and 202 when it stopped
    waiting. The OpenAPI document and the web client were regenerated.
  - The retry timer is unref'd. `stop()`, called from the server's graceful shutdown, clears the debounce and retry
    timers and ends a retry wait without another try. It also answers a waiting flush with `done: false` and keeps
    later requests from scheduling anything.
  - `docs/configure/clients/plex.md` documents the ask, the retries and the flush route.
- **Tests:** each new one fails on the old code.
  - `PlexGuideNotifier.test.ts`: a 401 or 403 from either call gets no retry and one warning, and the next server
    is asked at once.
  - Two failures then a success, with the waits growing (5 s, then 15 s), plus the wait formula itself.
  - One server's client lookup throws, has no token, or never answers, and the other server is still asked at once.
  - A flush with a server that never answers resolves after 30 s, naming it `pending` and the other `reloaded`. One
    that runs out before any server is reached logs "an ask under way". The route's status is 200 or 202.
  - After `stop()`, a waiting retry never fires and no timer is left. The retry timer was unref'd. A try that fails
    after `stop()` starts no retry timer.
  - `PlexApiClient.test.ts`: `getDvrs` rejects with `auth_error` on 401 and 403 without an error line;
    `refreshGuide` rejects with `auth_error` on 401 and 403, and `generic_request_error` on 503.

### Plex is asked to reload the guide once per change, and only when it can download it (2026-10-18)

- **What you saw:** Plex showed yesterday's lineup, or half of today's, for hours after a change. After every
  Tunarr restart Plex logged `failed to download XMLTV data at …/api/xmltv.xml` (connection refused). After the
  nightly schedule post, which saves six channels in nine seconds, Plex ran one guide reload (0.4 s after the first
  write) and ignored the next six asks, so it showed the first channel's new lineup and the others' old ones until
  the next scheduled write, hours later. Twice Plex logged `malformed data detected in XMLTV file` after a download.
- **Cause:** `UpdateXmlTvTask` asked Plex (`POST /livetv/dvrs/<id>/reloadGuide`) at the end of every run. The startup
  run happens before the HTTP server listens (`App.start()` awaits the startup tasks, then `runServer()`), so Plex's
  download of the guide was refused and nothing asked again. A channel save runs the task for that channel, so a
  burst of saves is a burst of asks, and Plex drops asks while a reload runs. `XmlTvWriter` wrote the guide in place
  with `writeFile`, and `/api/xmltv.xml` serves the same path, so a download during a write got a truncated file.
- **Fix:** `PlexGuideNotifier` (singleton) takes the asks: a request made before `markListening()` (called by
  `App.start()` after `runServer()`) waits for it; requests within 10 s collapse into one ask after the last; a failed
  ask is retried 3 times, 5 s apart, then logged once (since 2026-10-19: 5 s then 15 s, a refused token isn't
  retried, and a flush answers within 30 s; see above). `POST /api/xmltv/flush` resolves when no guide write is under way (the task reports
  its start and end; a channel save starts one without awaiting it) and no ask is pending or running, for a script
  that saved several channels and wants to check Plex's guide. `XmlTvWriter` writes
  `<outputPath>.<pid>.tmp` and renames it over the guide. The Plex client doc no longer says a guide refresh ends
  playing streams (it doesn't; a channel-map change does).
- **Tests:** `PlexGuideNotifier.test.ts` (debounce, waits for listening, retry and give-up, skip without
  `sendGuideUpdates`, flush); `XmlTvWriter.test.ts`: the write leaves no temp file beside the guide.

### A tune-in's timing is in Tunarr's log (2026-10-18)

- **What you saw:** nothing. How long a tune-in took (and whether it failed before a byte was sent) could only be
  read off Plex's logs, which show the tuner's side and only at INFO on a lucky day.
- **Fix:** the `/stream/channels/<id>.ts` route logs `Tune-in: session N ms, first byte N ms` with the channel,
  token, client address and user agent when the first byte goes out, and `Stream closed after N s, N MB sent` when
  the request closes (with `(no byte was ever sent)` for a stream that closed before any byte), and `Tune-in failed
after N ms, no byte was sent: <reason>` when no session could be started. `BaseHlsSession` logs `HLS session
ready after N ms (N segments on disk)` at info, and `FfmpegProcess` logs when a process writing to stdout (the
  `.ts` wrapper) sent its first output. `TuneInTimer` holds the marks; `CountingPassThrough` counts the bytes inside
  the stream so the response's own piping is untouched.
- **Tests:** `TuneInTimer.test.ts`: marks, rounding, summary; the counting stream counts and reports the first chunk
  once.

### The .ts wrapper exits when its session ends, instead of 15 s later by SIGKILL (2026-10-18)

- **What you saw:** `channel-N-concat still running after SIGTERM. Sending SIGKILL` at nearly every session end
  (89 times in 57 hours on the deployment), so each ended stream kept an ffmpeg and its pipe for 15 more seconds.
- **Cause:** when the last client leaves, nothing reads the wrapper's stdout any more; ffmpeg fills the pipe and
  blocks in `write()`. It handles SIGTERM only between writes, so the signal waited for the SIGKILL timer in
  `FfmpegProcess.kill()`.
- **Fix:** `kill()` unpipes and resumes the child's stdout after sending SIGTERM, so the pending write completes
  into nowhere and ffmpeg exits on the SIGTERM. The 15 s SIGKILL stays as the backstop.
- **Tests:** `FfmpegProcess.test.ts`: a shell stand-in that writes 64 KB blocks for ever and acts on SIGTERM only
  between writes, piped to a reader that never drains, exits within seconds of `kill()` with code 0 (on the old code
  it is SIGKILLed after 15 s).

### Plex shows "2 Sci-Fi", not "2 2 Sci-Fi" (2026-10-18)

- **What you saw:** every channel in Plex's guide carried its number twice.
- **Cause:** Plex titles a channel `<number> <first display-name>`, and the first `display-name` was already
  `<number> <name>`.
- **Fix:** `XmlTvWriter.makeXmlTvChannel` writes the name first (Plex uses the first), then `<number> <name>`, the
  number, and the name again last (Jellyfin's XMLTV reader keeps the last). Channel ids are unchanged, so a guide
  reload is enough; no channel-map change (which would end playing streams).
- **Tests:** `XmlTvWriter.test.ts`: the display-names of a written channel come in that order.

### Console log times carry their real offset (2026-10-18)

- **What you saw:** `2026-10-18T09:50:49.131Z` in the console log for an event that happened at 14:50:49 UTC: the
  time was local (TZ=America/Chicago) but ended in `Z`, so every reading against Plex's UTC log was 5 hours off.
- **Cause:** `getPrettyStreamOpts` used `SYS:yyyy-mm-dd'T'HH:MM:ss.l'Z'`: the system zone with a literal `Z`.
- **Fix:** `SYS:yyyy-mm-dd HH:MM:ss.l o`, local time with its offset (`-05:00`).
- **Tests:** `LoggerFactory.test.ts`: the pretty-stream time format has no literal `Z` and prints an offset.

### Forced subtitles inside a video file are read as forced (2026-10-18)

- **What you saw:** on a channel whose subtitle selection burns in forced English subtitles under English audio, an
  English-dubbed anime's "Signs & Songs" track was never burned in, and its captions came from that sparse track
  (about 25 lines an episode) instead of "Full" (about 240).
- **Cause:** `ProgramMinter.mintVersions` never copied a stream's forced flag (`//TODO: forced`), so every embedded
  subtitle stream was stored as not forced. Its `program_subtitles` row, minted from the same scan, had the flag, but
  stream selection reads the stream rows: a forced-only rule found nothing, and the caption fallback (full text tracks
  only) took the forced track first. On the deployment, no stream row of any kind was forced, while 381 embedded
  subtitle rows were.
- **Fix:**
  - `ProgramMinter` copies the flag (`forced: stream.forced ?? false`), for Plex, Jellyfin, Emby and local sources.
  - A startup fixer, `BackfillSubtitleForcedFlagFixer`, marks forced each embedded subtitle stream whose subtitle row
    (same program, same stream index) is forced, so existing programs heal without a rescan. It changes nothing on a
    second run.
  - Checked and unchanged: burn-in reads the extracted copy of the chosen stream (named by its stream index), never the
    video file's first subtitle track, and image subtitles are overlaid by their own stream index.
  - `stream-repro` gains `--run-task NAME`, to run a task such as `SubtitleExtractorTask` before the capture.
- **Evidence:** `stream-repro --mode hdhr` on a clip with the same tracks as the anime (two PGS tracks, then text
  "Signs & Songs" default and forced, then text "Full"), a forced-English subtitle preference and extraction run first.
  Before: nothing burned in, and the captions were the 2 sign cues in 40 s. After: the sign burned in from the text
  track's extracted copy, and the captions were the 13 "Full" cues.
- **Tests:** `ProgramMinter.test.ts` (the flag on each stream; fails on the old code) and
  `BackfillSubtitleForcedFlagFixer.test.ts` (only matching embedded rows change; a sidecar, another program and an
  audio stream with the same index don't; a second run changes nothing).
- **Upstream:** not sent.

### Tuning in no longer puts the rest of a loading caption on screen (2026-10-18)

- **What you saw:** right after tuning in to a captioned channel, the end of a caption flashed up on its own ("ng the
  soup" for "Are you eating the soup?"), sometimes for seconds, before the captions settled.
- **Cause:** a player that starts reading partway into the stream can only decode from the next keyframe. Plex logs
  `non-existing PPS 0 referenced` and `no frame!` for the frames before it, and FFmpeg's H.264 decoder only hands
  over caption data for frames it decodes. Tunarr's transcodes put a keyframe at every segment start (and libx264
  one more on the frame before). FFmpeg's caption decoder, which Plex's comes from, starts in roll-up mode
  (`ccaption_dec.c`: `ctx->mode = CCMODE_ROLLUP`). So when a pop-on caption was still loading into hidden memory at
  that keyframe, the rest of its characters were drawn on screen at once. Tunarr loads each caption just before its
  start frame, so in dialogue a load spanned a keyframe at about a third of them.
- **Fix:** `buildCaptionSchedule` takes `keyframeIntervalMs` and loads each pop-on caption between two keyframes: in
  the latest stretch before its start frame that holds the whole load, else from the next keyframe, showing it up to
  300 ms late (`MaxKeyframeDelayMs`). Only when even that isn't enough does it load across one, as before. `HlsSession`
  passes the segment length for transcoded sessions; HLS Direct v2 copies the video, whose keyframes aren't known.
  Paint-on and roll-up are unchanged: they draw text as it arrives.
  - Whole episodes of back-to-back sitcom dialogue (two subtitle files, about 30 cues a minute), 2 s segments,
    counting a keyframe as bad when a decoder starting there shows text the continuous decoder doesn't:
    - 29.97 fps: 27-34% of keyframes before, 1.5-1.8% after; 3-4% of captions later, median 133 ms, at most 267 ms.
    - 23.976 fps: 35-40% before, 6.1-6.5% after; 4-7% later, median 167-209 ms, at most 292 ms.
    - 59.94 fps: 12-17% before, none after; no caption moves.
    - 1 s segments: about 5% (29.97) to 18% (23.976) after, as fewer loads fit between keyframes, and one late
      caption can make the next late too (up to 0.6 s). 15 fps: 60% before, 35% after, since a two-line caption
      needs more than 2 s of frames.
  - End to end with `stream-repro --mode hdhr` and the same subtitles on a synthetic clip, 2 s segments, the capture
    cut at each keyframe (PAT and PMT first) and decoded with ffmpeg's `movie=…[out+subcc]`:
    - 29.97 fps, 150 s: 37 of 146 keyframe cuts showed a fragment before, none after. The continuous decode shows the
      same 77 captions, each a whole subtitle cue; 74 on the same frame as before, 3 later by 33-134 ms.
    - 23.976 fps, 200 s: 62 of 196 before, 15 after. The same 91 captions; 89 on the same frame, 2 later by 83 ms.
    - A cut 15 frames past a keyframe decodes nothing until the next one (`non-existing PPS 0 referenced`,
      `no frame!`, as Plex logs at every tune), and its first caption data comes on that keyframe.
- **Tests:** `Cea608Encoder.keyframes.test.ts`: a load that would cross a keyframe goes before it, on time; one
  that fits nowhere on time shows up to 300 ms late, else crosses as before; generated dialogue at 23.976, 25, 29.97
  and 59.94 fps leaves no fragment at any keyframe with pauses between lines, and at most a quarter of them back to
  back, with every caption shown and none more than 300 ms later. `Cea608TestDecoder` can start like FFmpeg's decoder
  partway into a stream. The golden snapshot is unchanged: without keyframes nothing changes.
- **Upstream:** not sent.

### The .ts stream starts when a second audio track is a few seconds late (2026-10-17)

- **What you saw:** a cold tune of a channel with two audio tracks (Audio tracks `eng, jpn`, loudness levelling on)
  failed at once. The .ts wrapper exited with code 234 after `sample rate not set` and `Could not write header
(incorrect codec parameters ?)`. Re-tuning a minute later worked.
- **Cause:** the wrapper copies every stream of the session, so ffmpeg must find each stream's parameters before it
  writes the output header. It reads only its default window: 5 MB, and for the HLS demuxer's segment demuxer
  4 s of analysis when none is set. A track whose first packets come after that window has no sample rate, and the
  MPEG-TS muxer refuses the header. Reproduced with the wrapper's exact command against an HLS stream whose second
  audio track starts 8 s in: exit 234 with the same messages. The exact trigger on the deployment (what made that
  track late on that tune) couldn't be reproduced locally: 80 cold and near-cold tunes of a two-track channel, with
  and without loudness levelling and with the deployment's segment settings, all started.
- **Fix:** `hlsWrap` gives the wrapper's input `-analyzeduration 15000000 -probesize 50000000`
  (`ProbeWindowInputOption`). ffmpeg stops probing as soon as every stream is known, so this only waits when a track
  is late; a track with no packets at all still fails after 15 s.
  - Against the late-track stream: starts, with the second track's packets in the output from 8 s.
  - Tune-in through Tunarr unchanged: 20 cold tunes each with the deployment's settings, first byte median 0.80 s
    before and 0.81 s after.
- **Tests:** `BasePipelineBuilder.test.ts`: the wrapper gets the window before its input (fails on the old code).
- **Upstream:** not sent.

### The .ts stream keeps every frame where segments and programs meet (2026-10-17)

- **What you saw:** captions that lost two letters ("You" as "u"), about one frame lost every 40 s on a slow shared
  server. The .ts stream Plex reads (the wrapper: an ffmpeg that joins a session's
  HLS segments, with `-fflags +discardcorrupt`) had a 2-frame gap there.
- **Cause:** ffmpeg's MPEG-TS demuxer marks the PES it is building as corrupt when the next packet's continuity counter
  doesn't follow on, and `+discardcorrupt` drops it. That PES is the last frame before the join. Two things broke the
  counters:
  - **Captioned segments (most joins):** to end a captioned segment on its original counter, the inserter gives the
    last frame enough extra packets by moving its last bytes one per packet (`packetizePes`). When that frame's last
    full packet held no more bytes than were moved, the packet disappeared, so the segment came out one packet short
    and the next segment's first counter didn't follow on. In a 200 s run, a segment's captioned copy ended on counter
    6 while the original ended on 7, and the verbose wrapper log showed `Packet corrupt (stream = 0, dts = …), dropping
it` each time.
  - **Program boundaries (with or without captions):** a later program's transcode restarts its counters at 0 and was
    meant to flag its first packets as a discontinuity with `-mpegts_flags +initial_discontinuity`. The HLS muxer
    doesn't pass that to its segment muxer, so the flag never appeared and the previous program's last frame was
    dropped.
- **Fix:**
  - `packetizePes` decides how many packets a PES takes first (the minimum plus the extra), then fills them, leaving one
    byte for each packet still to come, so it always makes exactly that many. `insertCaptions` checks that the captioned
    video ends on the original counter and otherwise serves the segment as it is.
  - `HlsOutputFormat` and `HlsDirectOutputFormat` pass the flag through `-hls_segment_options
mpegts_flags=+initial_discontinuity`, so a later program's first packet of each stream carries the discontinuity
    indicator, which the demuxer accepts.
  - Measured with `stream-repro --mode hdhr` (2 s segments, captions on): 3 synthetic programs of 100 s, 240 s
    captured, 5 lost frames before (each the last frame of a segment, two at program boundaries), none after; a DVD
    excerpt with sidecar subtitles played three times (330 s, two program boundaries), 10192 frames with no gap and
    every caption equal to its subtitle cue.
- **Tests:** `MpegTsCaptionInserter.test.ts`: a captioned segment ends on the original counter for every slice size
  from 300 to 699 bytes (fails on the old code at 319), and `packetizePes` makes exactly the minimum plus the extra
  packets for every length up to 600 and every extra up to 15, keeping every byte. `HlsOutputFormat.test.ts` and
  `HlsDirectOutputFormat.test.ts`: a later program passes the flag through `-hls_segment_options` (fails on the old
  code).

### A burned-in subtitle's path can hold any character (2026-10-17)

- **What you saw:** a program with a forced subtitle never started. ffmpeg said `No option name near
'2]aresample=…'` and `Error parsing filterchain '[0:0]pad=…,subtitles=…'`. The subtitle file's name had an
  apostrophe in it (`… - Kid's Final Test.en.forced.srt`).
- **Cause:** FFmpeg reads a filter option's value twice, first when it splits the filtergraph into filters and
  then when it splits a filter's arguments into options (`av_get_token` both times). `SubtitleFilter` escaped the
  path once, and only for `[`, `]` and `:`.
  - **Apostrophe:** an apostrophe opened a quote that swallowed the rest of the graph.
  - **Comma and semicolon:** ended the filter early.
  - **Colon:** lost its single backslash at the graph level, then split the path into options.
  - **Equals sign:** the positional form could also read a path with `=` as `option=value`.
- **Fix:**
  - **`escapeFilterOptionValue`** (`filter/escapeFilterValue.ts`) escapes a literal value for both levels, as in
    FFmpeg's "Notes on filtergraph escaping": `\ ' :` for the option, then `\ ' [ ] , ;` for the graph, plus
    whitespace at either end, which `av_get_token` trims.
  - **`SubtitleFilter`** uses it with the named option, `subtitles=filename=…`, in every pipeline (software,
    NVIDIA, QSV, VAAPI). Windows and HTTP paths need no special cases any more.
  - **No other filter takes a path:** watermarks and images are `-i` inputs, and the drawtext titles are fixed
    strings.
- **Test:**
  - **`escapeFilterValue.test.ts`:** a port of `av_get_token` reads every escaped value back exactly, across
    apostrophes, colons, commas, semicolons, brackets, `=`, `%`, backslashes, leading and trailing spaces, tabs,
    newlines, unicode, a Windows path and an HTTP URL. It also matches the two-level example in FFmpeg's
    documentation, and the burned-in filter no longer swallows the chain after it. Old code: 13 of the 27 fail.
  - **`SoftwarePipeline.local.test.ts`:** real ffmpeg burns in a sidecar under such a name.
  - **stream-repro (`--keep-names`):**
    - before: the program's transcode failed on every start ("Unable to parse 'original_size' option value
      '1]aresample…'"), the HLS session restarted, and 4 segments came through in 30 s;
    - after: 8 segments came through with the subtitle burned in.
- **Reach:** on one library, 77 forced text tracks on 71 programs had such a path: 62 sidecars, and 15 embedded
  tracks in 13 videos. Forced tracks are the ones burned in even with captions on. With captions off, any burned
  text subtitle counts: 3,737 tracks on 1,012 programs, 784 of them with an apostrophe.
- **Upstream:** not sent.

### A source reporting a frame rate that isn't standard keeps all its frames (2026-10-17)

- **What you saw:** on a DVD-sourced series, closed captions in Plex were often missing, or lost letters ("You" as
  "u"), and motion was slightly jerky.
- **Cause:**
  - **The reported rate:** the files' headers report 20 fps, but their frames come about 24 a second (they alternate
    1/24 s and 1/30 s apart). With "Normalize Frame Rate" off, Tunarr sets no output rate, and ffmpeg's HLS output is
    constant-rate at the input's reported rate, so the channel ran at 20 fps and dropped about one frame in six.
  - **Captions at 20 fps:** CEA-608 sends two characters per frame, so captions had two thirds of their usual room,
    and players expect a standard rate. Captions were also laid out at the source's reported rate, not at the output's,
    so any difference between the two (a field-rate deinterlacer doubling the rate, or QSV, whose `fps` filter always
    used 24 because `getNumericFrameRateOrDefault` ignores a rate `parseInt` can read) made HlsSession send padding only.
- **Fix:**
  - `outputFrameRate` (`server/src/ffmpeg/outputFrameRate.ts`) never gives fewer frames a second than the source
    reports: a standard rate (23.976, 24, 25, 29.97, 30, 50, 59.94, 60), a rounded label for one (within 0.05%) or a
    rate up to 2% below one (an average over a few missing frames, 23.81 in the library that showed this) is that
    standard rate exactly; one above them all (high-frame-rate video, 120) is kept; any other, including one a little
    above a standard rate (30.3), gets 29.97 below 30 fps or 59.94 above.
  - `FfmpegPlaybackParamsCalculator.calculateForStream` sets the output rate (`-r <rate> -fps_mode cfr`) for a
    non-standard source, or one corrected up to a standard rate, always (left alone, ffmpeg's HLS output keeps the
    reported rate), with "Normalize Frame Rate", and, new, whenever HDHomeRun captions are on
    (`pinFrameRate`). When the pipeline deinterlaces in software, a field-rate filter (`none`, which is yadif=1,
    `yadif=1`, `bwdif=1`, `w3fdif`) doubles it, so no field-rate frames are dropped: without hardware acceleration,
    with VideoToolbox, with QSV when hardware filters are off, with VAAPI and CUDA when hardware decoding is off, and
    with CUDA for interlaced MPEG-2 and looping items (a filler clip shorter than its slot), which it always decodes
    in software. QSV's own `deinterlace_qsv` always outputs a
    frame per field (FFmpeg sets `field_rate` for it), so QSV with hardware filters doubles it too.
    VAAPI and CUDA also fall back to software when the GPU can't decode the source, which only the pipeline knows;
    there the extra frames are dropped back to the source rate, and captions still match the output.
  - `FfmpegStreamFactory` lays captions and the "No captions" notice out at that output rate, never at the source's.
  - `QsvPipelineBuilder` uses the chosen rate in its `fps` filter instead of dropping the output rate.
  - NTSC rates go to ffmpeg as exact fractions (`30000/1001`, `ffmpegFrameRate`).
  - Local measurement (`stream-repro --clip-file <a 2 min excerpt of a DVD-sourced episode with a 20 fps header,
sidecar subtitles> --mode hdhr --ffmpeg-setting hdhrClosedCaptions=true --seconds 100`): before, 20.000 fps,
    2011 frames 50 ms apart (the source has about 2400 in that time); after, 29.97 fps, every source frame kept, the
    raw HLS segments 33.4 ms apart with no gap, and every caption equal to its subtitle except where the .ts wrapper
    lost a frame (next point).
- **Still open:**
  - **Fixed since:** the .ts wrapper's lost frames where segments and programs meet ("The .ts stream keeps every
    frame where segments and programs meet").
  - **Hardware pipelines:** whether a pipeline's deinterlacer doubles the frame rate is worked out from the transcode
    config and the source, mirroring each builder's choice. A GPU that can't decode a codec falls back to software
    in VAAPI and CUDA, which only the pipeline knows: there the pinned rate keeps the source's, so a field-rate
    deinterlacer's extra frames are dropped (captions still match). Only the software pipeline has been checked end
    to end. Follow-up: have the pipeline report the output rate it ends up with, and lay captions out at that.
- **Tests:** `outputFrameRate.test.ts`; `FfmpegPlaybackParamsCalculator.test.ts` (non-standard rates with the setting
  on and off and in MPEG-TS mode, near-standard rates, `pinFrameRate`, deinterlacing per filter and pipeline);
  `FfmpegStreamFactory.test.ts` (captions and the notice at the output rate; a 20 fps source outputs 29.97; nothing
  pinned with captions off); `QsvPipelineBuilder.test.ts` (the chosen rate in `fps` and `-r`). All new cases fail on
  the old code.
- **Also:** `stream-repro` gained `--clip-file PATH` (a real file as a program, sidecar subtitles included) and
  `--mode hdhr` (the HDHomeRun `.ts` stream, with `report.captions`: frame spacing and the decoded captions).
- **Upstream:** not sent.

### A caption pair is never lost or sent twice because of frame timing (2026-10-17)

- **What you saw:** captions in Plex that lost two letters ("You" as "u"), or lost a whole caption when the lost pair
  was a command.
- **Cause:** each video frame took the caption pair of the frame slot it is shown in (`CaptionSchedule.pairAt`,
  rounding its time). A slot without a frame lost its pair, and two frames in one slot sent it twice, which doubles
  letters or turns a control code's redundant copy into a second command. The inserter also asked per frame in decode
  order, so the answer couldn't depend on the frames around it.
- **Fix:**
  - `insertCaptions` reads a segment's frames first and asks once for all their pairs, in presentation order
    (`pairsForFrames`; sorted by offset from the segment's first frame, so a segment across the 33-bit PTS wrap keeps
    its order).
  - `pairsForFrames` (`server/src/stream/captions/pairsForFrames.ts`), called by `HlsSession` for each program's
    frames in a segment, hands the pairs out: a slot without a frame has its pair sent on the frames that follow, one
    a frame and in order; a second frame in a slot sends padding, or the copy of the control code the frame before
    sent, so the two copies stay on consecutive frames; a program's first frames start from its first slot, so pairs
    due before a frame missing there still go out; a jump of 8 slots or more is a new start, not a backlog to send
    late.
  - It reads only the segment's own frames, so a segment is captioned the same however often and in whatever order
    segments are asked for (two viewers, a retry). A frame missing right where a segment starts can't be told from the
    segment alone and loses its pair; Tunarr's own segments are evenly spaced, so that would take a frame lost before
    them.
  - `HlsSession` checks each program's frame spacing in a segment before laying out its pairs, so a mismatched program
    is sent as padding without touching other programs in the same segment.
- **What it couldn't fix:** a frame the .ts wrapper lost after captioning, fixed since ("The .ts stream keeps every
  frame where segments and programs meet").
- **Tests:** `pairsForFrames.test.ts` (a missing frame, two frames in a slot, a control code's copies and a program's
  missing first frames fail on the old slot lookup; one per slot, a later segment's start and a long jump are guards);
  `MpegTsCaptionInserter.test.ts` (asked once, in presentation order, with B-frames and across the PTS wrap);
  `HlsSession.test.ts` (a segment missing a frame sends every pair in order, which fails on the old code; a segment
  asked for twice is captioned the same way; two segments come out the same whichever is asked for first, which
  fails on a cursor shared between requests). The golden caption snapshot is unchanged.
- **Upstream:** not sent.

### Tuning in during a gap starts as fast as during a program (2026-10-17)

- **What you saw:** Live TV took about 11 s to start when you tuned in during a gap (the channel's offline picture and
  gap music), against about 6 s during a program. Schedules pad to slot boundaries, so gaps fall just before the hour
  and half hour, when people tune in.
- **Cause:**
  - **No read-ahead:** a session's first transcode reads its input ahead (`-readrate_initial_burst 60`) so the first
    segments exist within a second, but only programs got that. `ProgramStream` passed gaps and error screens
    `opts.realtime`, which HLS sessions never set, so `createPlaceholderSession` fell back to real time. Two 2 s
    segments then took over 4 s of wall time.
  - **The picture over the network:** the offline picture is usually an upload, saved with the server's public
    address, so ffmpeg fetched it back through that address (on a typical setup, over HTTPS through a reverse proxy).
- **Fix:**
  - `ProgramStream.setupOfflineItem` and `setupErrorItem` fall back to the session's pace (`context.realtime`), as
    programs do, so a first transcode that lands in a gap reads ahead too. After the 60 s burst it runs at real time,
    like a program (a 150 s gap: 60 s of it within 5 s, then 10 s of media per 10 s).
  - **Except where a still picture can't read ahead:** the CUDA, QSV and VAAPI pipelines loop it with the loop filter,
    which repeats one decoded frame that `-readrate` can't pace; only the realtime filter can, and it has no burst.
    There a still-picture placeholder stays at real time (`FfmpegStreamFactory.paceStillImage`), or the whole gap
    would encode at full speed. Software and VideoToolbox loop it at the input, so they read ahead.
  - `ProgramStream` resolves an uploaded offline picture to its file (`localUploadFile`, `uploadsDirectory`,
    `server/src/util/iconUtil.ts`) and hands it to `createPlaceholderSession` as `picture`. It reads the file only
    when the URL's `?v=` matches the file's contents (`uploadVersion`, the hash every upload URL carries), so a
    same-named picture on another server keeps its URL whatever host it names. Other URLs, missing files and names
    that aren't plain file names keep the URL too.
  - Local measurement (`stream-repro --flex-first 45000 --offline-picture <png>`, 2 s segments, 2 before the
    playlist, 3 runs each): the first segment of a tune into a gap came after 7.0 s before and 1.0 s after; into a
    program, 1.0 s both times. The 1 s floor was the once-a-second readiness check, which now looks every 0.1 s (next entry).
- **Tests:** `ProgramStream.test.ts` (a gap and an error screen follow the session's pace; an uploaded picture is read
  from disk; other pictures keep their URL; the first three fail without the fix), `FfmpegStreamFactory.test.ts` (the
  offline input uses the picture it's given, else the URL; with CUDA, QSV or VAAPI a still-picture placeholder stays
  at real time, which fails without `paceStillImage`), `iconUtil.test.ts` (`localUploadFile`, including a same-named
  picture with other contents).
- **Also:** `stream-repro` gained `--offline-picture FILE`, which uploads an image and makes it the channel's offline
  picture.

### A tune-in's first transcode uses more threads (2026-10-17)

- **What you saw:** every Live TV tune-in took several seconds before the picture came up.
- **Cause:** Plex Live TV answers a tune only once it has 5 s of video, so a tune-in waits on the first transcode's
  first three 2 s segments. That transcode reads 60 s ahead of real time, but encoded with the transcode config's
  thread count (8 on the measured server), so on a shared CPU it ran at about 2x real time and segment 3 took ~3.7–4 s.
- **Fix:** in HLS mode, a transcode that reads ahead of real time (the first one after a tune-in, or one catching
  up) uses up to 16 threads, never more than the cores Tunarr may run on (`os.availableParallelism()`, which follows
  `taskset`) and never fewer than configured (`stream/hls/readAheadThreads.ts`, `HlsSession.transcode`). Real-time
  transcodes keep the configured count, and so does a config of 0 (ffmpeg chooses). Hardware pipelines get it too:
  a hardware encoder ignores it, but software decoding uses it, and so does the software encoder a pipeline falls
  back to when hardware encoding is disabled or unavailable.
- **Measured** (the server's CPU, libx264 veryfast 6 Mbit/s 1080p with loudnorm, a 15-minute seek, median of 3):
  segment 3 came at 2.69 s instead of 3.95 s for an HEVC 10-bit Blu-ray source, and 2.41 s instead of 3.71 s for an
  SD H.264 DVD source. CPU per second of media was unchanged (2.13 against 2.34 s, and 2.06 against 2.10 s), with
  about 20 more threads per such transcode.
- **Quality:** unchanged. On the same frames of 4 excerpts, 16 threads scored a mean VMAF within 0.02 of 8 threads
  (worst 5% of frames within 0.43) and PSNR-Y within 0.01 dB. A faster preset (superfast) would have saved another
  ~0.7 s but cost 0.4–1.2 VMAF and up to 1.2 dB for the rest of the program, so it isn't used.
- **Tests:** `readAheadThreads.test.ts` (the rule); `HlsSession.test.ts`: a read-ahead transcode gets 16 threads
  and a real-time one keeps the configured 4. The first fails on the old code.
- **Upstream:** not sent.

### A tune-in notices its first segments within 0.1 s (2026-10-17)

- **What you saw:** every Live TV tune-in took several seconds before the picture came up.
- **Cause:** a starting HLS session checked for its first segments once a second
  (`BaseHlsSession.waitForStreamReady`, 15 retries 1000 ms apart). The segments were often there well before the
  next check, so a tune-in waited about 0.5 s more on average, and up to a whole second.
- **Fix:** the check runs every 100 ms, with the same 15 s limit (`ReadyPollMs`, `ReadyTimeoutMs`). The "still
  waiting" debug line is logged about once a second, as before.
- **Test:** `BaseHlsSession.test.ts`: segments written 1.25 s in are noticed within 150 ms; the stream isn't ready
  until every required segment exists; it still gives up after about 15 s. The first two fail on the old interval.
- **Upstream:** not sent.

### The end of a caption no longer flashes past at tune-in (2026-10-17)

- **What you saw:** tuning in mid-sentence, a fragment of a caption was on screen for about half a second, then nothing
  for a second or two until the next caption.
- **Cause:** a cue already under way at the stream's first frame is loaded and shown as soon as it can be, until its
  own end ("A session's first program shows its captions on time", below). Loading takes about a third of a second at
  29.97 fps and more at lower frame rates, so a cue with under a second left showed its last words for 0.1–0.6 s.
- **Fix** (`buildCaptionSchedule`, `server/src/stream/captions/Cea608Encoder.ts`): a pop-on or paint-on caption under
  way at the first frame is left out when less than a second of it would be on screen, counting to its own end or the
  program's, whichever comes first. The next caption is then the first one shown, and nothing of the left-out one holds
  up its load. A pop-on cue is judged on its own before overlapping subtitles are stacked, so a longer one it
  overlapped shows alone as soon as it's loaded, not when the short one ends.

  - **Why a second:** it is `MinTailMs`, the minimum the encoder already used to bring a subtitle back for the rest of
    its time when a newer one ends ("Show the newest" overlaps). Both are the rest of a subtitle that began before the
    viewer saw it, so both get the same floor.
  - **Untouched:** captions that start on or after the first frame, however short; their start is what the subtitle
    file asks for. Roll-up keeps its rest too: its lines stay up, scrolled, while the next cue's arrive, so it reads as
    context rather than a flash.
  - At 29.97 fps, a 15-character cue under way at tune-in, on screen (first caption shown → cleared):

    | Left of the cue at tune-in | Before  | After             |
    | -------------------------- | ------- | ----------------- |
    | 0.6 s                      | 234 ms  | left out          |
    | 1.0 s                      | 634 ms  | left out          |
    | 1.3 s                      | 934 ms  | left out          |
    | 2.0 s                      | 1635 ms | 1635 ms, the same |

- **Tests:**
  - `Cea608Encoder.test.ts`: a cue under way with 0.6 s left is left out and the next shows on its own frame (fails
    without the fix); so is one whose program ends 0.6 s in, however long the cue runs on (fails without the clamp to
    the program's end); of two overlapping cues under way, one ending 0.6 s in, the other shows alone once loaded
    (fails without judging cues before stacking); with 2 s left it shows once loaded until its end; a short cue starting on the first frame still
    shows; paint-on leaves the rest out too (fails without the fix); roll-up keeps it, scrolled up by the next cue.
  - `Cea608Encoder.golden.test.ts`: its first cue is under way with 0.8 s to show at 15 fps, so the six 15 fps sections
    lose it (frames 0–23 only). The 23.976 and 29.97 fps sections, where it has over a second, are unchanged.
- **Upstream:** not sent.

### A channel's own caption settings, for a test channel (2026-10-16)

- **What you saw:** caption appearance, alignment and the test pattern were global FFmpeg settings, so trying a
  magenta box changed the captions on every channel, for the owner and friends alike. A test channel (99,
  plans/test-channel-99.md) needs its own.
- **Change:** a channel setting, **Captions for this channel**, under _Audio & Subtitles_ on the Streaming tab:
  - **What it is:** `Channel.captions`, `{ testPattern?, alignment?, appearance? }`, stored in the new column
    `captions` (migration 0055). Only what the channel sets is saved; the rest follows the global settings, so a later
    global change still reaches it. The appearance fields have no defaults (`CaptionAppearanceOverridesSchema`), or an
    override would fill in every field.
  - **Test pattern on this channel:** the numbered samples on this channel only. The global switch still shows them on
    every channel, and the global closed-captions switch stays the master switch.
  - **Use own caption look:** alignment and every appearance field, shown with the global look; only the settings
    changed are saved as the channel's own. **Copy to all channels** writes this look over the latest FFmpeg
    settings; **Reset to global** drops it and keeps the test pattern.
- **How:**
  - `server/src/stream/captions/channelCaptions.ts`: the channel's look over the global one, whether it has one, and
    whether its test pattern is on.
  - `FfmpegStreamFactory`: attaches the channel's look to each program's captions (only when it has one), times the
    "No captions for this program" notice by it, and runs the test pattern per channel. The channel is loaded per
    program, so a change applies from the next program.
  - `HlsSession.addCaptions`: a program's own look wins over the global one.
  - Web: the caption controls moved out of the FFmpeg settings page into `CaptionAppearanceFields`, used by both
    pages; the channel's section is `ChannelCaptionsField`.
- **Verified end to end** (stream-repro, jellyfin-ffmpeg 8.1.3): one server, two HLS channels on the same two
  captioned clips, both HDHomeRun `.ts` streams captured for 30 s at once and decoded with FFmpeg's 608 decoder.

  | Channel 900's own setting    | Channel 900                                                 | Channel 901 (no setting)                    |
  | ---------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
  | magenta text, blue box, left | 16 captions, `\c&HFF00FF&` `\3c&HFF0000&` at `\pos(57,243)` | the same 16, white, no box, `\pos(115,243)` |
  | test pattern                 | "1 WHITE TEXT", "2 GREEN TEXT", "3 BLUE TEXT"…              | the clips' own captions                     |

- **Tests:**
  - `channelCaptions.test.ts`: merge precedence, fields that fall back, the test pattern rules.
  - `FfmpegStreamFactory.test.ts`: the channel's test pattern on that channel only and behind the global switch; its
    look reaches the captions; none for a channel without one; the notice timed by the channel's look.
  - `HlsSession.test.ts`: captions laid out in their channel's look. `Cea608Encoder.golden.test.ts` unchanged.
  - `ChannelDB.test.ts`: save and read back, update without the field, reset, only what is set is stored, validation,
    no defaults filled in, override fields in step with the global ones.
  - Web: `channelCaptions.test.ts` and `ChannelCaptionsField.test.tsx` (the global look shown, only changed
    settings saved, test pattern alone, off and reset, copy to all channels over settings changed since loading).
- **Upstream:** not sent.

### Test media for a test channel (2026-10-16)

- **What you saw:** nothing; a tool. Caption, audio and video options could only be tried on real channels, with real
  programs that hit some cases and not others.
- **Fix:** `scripts/test-channel/make-test-media.mjs` (README beside it) makes 20 labelled clips:
  - caption suites as sidecar SRT and ASS, spoken line by line so timing can be judged by ear;
  - English + Japanese and 5.1 speaker-check audio, stereo, English-only, AC3/E-AC3/AAC, 44.1 kHz;
  - HDR10 (with mastering metadata), HLG, 10-bit SDR, interlaced 29.97i, four frame rates, anamorphic 720x480;
  - three short clips with differing layouts for program boundaries.
    Every clip shows what it tests, a clock and a frame counter, and the script writes `manifest.json` with what ffprobe
    found. Used for the deployment's channel 99 (plan `plans/test-channel-99.md`).
- **Tests:** none in the suite; it's an offline tool. Its own check is the ffprobe manifest: every clip's tracks,
  language tags, colour tags, HDR side data and interlacing, verified against the table in the README.

### A caption's box colour holds to its end (2026-10-16)

- **What you saw:** with a magenta box, Plex for Mac often turned the box back to black partway through a caption,
  for its end or a closing ♪ (user: "almost like it was drawing the magenta over black or the timing of our codes is
  off?").
- **Cause:**
  - **The decoder:** FFmpeg's 608 decoder, the family Plex's players come from, keeps one current box colour
    (`libavcodec/ccaption_dec.c`). A background code sets it, each character is stamped with it as it's written
    (`write_char`), and Erase Displayed Memory resets it to black (`handle_edm`: `bg_color = CCCOL_BLACK`; End of
    Caption calls `handle_edm` too).
  - **The encoder:** a pop-on caption loads while the one before it is on screen, and that one's clear (Erase
    Displayed Memory) is placed first. The next caption's load is then fitted around it, so with a gap shorter than the
    load (under about a second, common in dialogue and songs) the clear landed inside it. The box code goes once at the
    start of each line, so the rest of the line was written on black.
  - **Seen in jellyfin-ffmpeg 8.1.3**, before the fix: `{\3c&HFF00FF&}Then{\i1} Hey!{\i0} to\Nthe
ve{\3c&H000000&}ry end ♪`. The default box ("player") sends no box codes and was never affected.
- **Fix:** `server/src/stream/captions/Cea608Encoder.ts`.
  - A pop-on line that sets a box colour loads wholly before or wholly after any Erase Displayed Memory in the schedule
    (`groupedLoadSequence`; `placeBefore` and `placeFrom` keep each group on one side of a clear).
  - Only where that doesn't move the frame the caption shows on. A later caption would hold up the next one's load,
    which could then miss its own time and be left out (Codex, PR #28: three quick boxed cues showed only two). A
    caption with no room to load before its start loads as before, so its timing never changes. A line the clear
    falls in can still lose its box there; that only happens with very quick cues.
  - Default output (no box) is byte-identical; the golden snapshot is unchanged.
- **Test pattern:** sample 39 is a magenta box, then a second line 200 ms after it, keeping the box through italics, a ♪
  and its end.
- **Tests:**
  - `Cea608Encoder.test.ts`: a model of FFmpeg's box handling (box set by the code, stamped per character, reset by
    Erase Displayed Memory and End of Caption). Gaps of 2 to 30 frames keep every character magenta, and 6 of those 7
    fail without the fix. Three quick boxed cues all show, and a caption that has to load late still shows, boxed from
    its start.
  - `CaptionInsertion.local.test.ts`: jellyfin-ffmpeg 8.1.3 decodes the second caption with no black box after the
    magenta one; it fails without the fix.
  - `CaptionTestPattern.test.ts`: sample 39's timing.

### Saving a channel no longer rewrites every channel's guide entries (2026-10-16)

- **What you saw:** Live TV paused while channels were saved. On the deployment, with the owner watching channel 1,
  the latency probe saw 6 requests over 250 ms (worst 1.05 s), all while the Sci-Fi channel was being saved. The
  save took 4 s there. Editing channels in the web UI did the same on 2026-10-14.
- **Cause:**
  - Every save (`PUT /api/channels/:id`) ends with an XMLTV write.
  - That write fetched every guide program of every channel with all its relations, and rendered every channel's
    programmes.
  - On a copy of the deployment's database (6 channels, 72 h guide, 784 programs), the fetch was 133–382 ms of a
    181–426 ms write. The rest of the save took under 10 ms.
  - The fetch yields between chunks, but on the shared server a chunk can wait on a cold disk.
- **Fix:**
  - **`XmlTvWriter.write(channels, { reuse, onRendered })`:** a channel in `reuse` keeps the programmes an earlier
    write rendered, with no render and no artwork publish.
  - **`TvGuideService`:** remembers each channel's rendered programmes, keyed on the guide entry, channel object and
    programs array they came from, and on the render settings (XMLTV settings, credit-images flag).
  - **Redirects:** the key also holds each redirect target's presence, name and number. A redirect that wasn't
    followed when the guide was built renders from its target at write time (Codex on PR #26).
  - **Effect:** a save re-fetches and re-renders only the saved channel. A guide rebuild or a settings change renders
    everything again.
  - **Trade-off:** program details edited since (a scan) reach the other channels' entries at their next scheduled
    rebuild, as when nothing was saved (`docs/configure/channels/epg.md`).
  - The plan is in `plans/channel-save-guide-reuse.md`.
- **Measured** with `guide-refresh-ab.ts --action save` (new, with `--template-dir` for a copy of a real database)
  against the deployment's copy, medians of 3 trials, reuse off vs on:
  - **saving an offline picture:** 199 → 46 ms, probe p99 17.6 → 4.3 ms;
  - **saving a new start time** (the nightly grid build's save, which regenerates the lineup): 236 → 60 ms, probe
    p99 31.1 → 4.2 ms; stalls of 25–63 ms with reuse off, none with it on.
- **Tests:**
  - `XmlTvWriter.test.ts`: a full write matches `serialize`; a reused channel isn't rendered and publishes nothing.
  - `TvGuideService.test.ts`:
    - after a build, a save fetches and renders only the saved channel;
    - a rebuild or a settings change renders all;
    - a channel with an unresolved redirect is rendered again when its target appears, is renumbered or leaves;
    - a followed redirect stays reused when its target is renumbered.
  - Fail without their change: the writer's two, the first guide test and the unresolved-redirect one. The other two
    pass either way, by design.
- **Upstream:** not sent.

### Downloaded subtitles stay fresh, and a replaced subtitle heals at once (2026-10-16)

- **What you saw:** 132 programs served an older subtitle than the file next to the video (Bazarr's re-syncs and
  replacements), and a subtitle Plex had replaced answered 404 until two rescans later. Investigation:
  `plans/plex-stale-subtitle-404-2026-10-16.md`.
- **Cause:**
  - Through its `plex.direct` address Plex leaves out a sidecar subtitle's file path, so Tunarr downloaded a copy of
    every sidecar. The copy is named after the stream key and was never fetched again.
  - Playback read the copy ahead of a readable live file.
  - The hourly top-up skipped any copy that existed.
  - A 404 waited for Plex's rescan and then Tunarr's.
  - The deployment's fix was a local Plex address and a forced scan (done 2026-10-16). This makes Tunarr cope where
    that isn't possible.
- **Fix:**
  - **Playback prefers the live file:** `ProgramStreamDetailsFetcher` uses a sidecar's resolvable source path ahead of
    a downloaded copy.
  - **Old copies refresh:** `ExternalSubtitleDownloader.fetchToCache` with `refresh` fetches again and swaps the copy
    in only if it changed, through a temporary file and a rename. `SubtitleExtractorTask` does this hourly, for programs
    airing within the hour, to copies more than 6 hours old whose live file it can't read.
  - **A 404 heals at once:** the task reads the item again (`getMovie`/`getEpisode`), mints its subtitles and saves
    them with `replaceProgramSubtitles`, the scan's own save split out per program (new on `IProgramDB`). Sidecars
    that are still the same stream keep their file; replaced copies are deleted, and an item that lists no subtitles
    any more has its rows cleared. If the item still lists the stream that 404'd (the server hasn't rescanned yet),
    nothing is saved and the rows and copy stay until it does. An item that is gone is left to the next scan.
  - **Each program once a run:** a program airing twice in the hour (a repeat, or on two channels) is handled once,
    so a heal that can't succeed doesn't re-read the item each time.
  - **The scan says so:** a Plex scan logs once when sidecar paths are hidden while the video's path came through.
- **Tests:**
  - `ExternalSubtitleDownloader.test.ts`: refresh replaces a changed copy, keeps an unchanged one and renews its age,
    keeps the copy when a fetch fails, never fetches without refresh, and returns a 404 unlogged.
  - `ProgramStreamDetailsFetcher.test.ts`: the live file ahead of a copy (fails without the change), and the copy
    when the live file is out of reach.
  - `SubtitleExtractorTask.test.ts`:
    - a copy older than 6 hours is fetched again, a younger one isn't, nor one whose live file is readable;
    - on a 404 the item is read once, re-minted and saved, the new stream downloaded, and a still-valid sidecar keeps
      its file; films use the movie call; a gone item is left alone; a second 404 doesn't loop; an empty mint clears
      the rows; a program on two channels is read again once; an item that still lists the 404'd stream is left
      alone.
  - `ProgramDB.test.ts`: replacing a program's subtitles with none clears its rows and cached copies.
  - `MediaSourceScanner.test.ts`: the info line once a scan, again in the next scan, and not when the paths are
    reported or the video has none.
- **Upstream:** not sent.

### A custom show sync looks up its program ids without loading whole programs (2026-10-16)

- **What you saw:** nothing reported. A follow-up from the custom-show-sync work of 2026-10-15, where the lookup at the
  end of every sync was the worst stall: 163–186 ms at 1,000 movies, 870 ms at 3,000.
- **Cause:** `CustomShowSyncService` resolved the playlist's Tunarr ids with `lookupByExternalIds`. That loads every
  program with its album, artist, season, show, tags, artwork, credits, genres, studios and versions, only to read its
  id.
- **Fix:**
  - The sync uses `programIdsByExternalIds`, which reads only the external-id table, and matches the results with
    `createExternalId` (`server/src/services/CustomShowSyncService.ts`).
  - `IProgramDB` declared `programIdsByExternalIds` twice. The stale declaration claimed dot-separated keys, while the
    method returns `source|mediaSourceId|key`. It's gone, and `ProgramDB` declares the real key type.
- **Numbers:** `pnpm bench:custom-show-sync -- --movies 1000`, run back to back on the same machine. The in-process
  arm's worst stall went from 177 to 104 ms on the first sync, and from 263 to 100 ms on a resync. Syncs run in a scan
  worker by default; this is the in-process fallback, and the worker does less work too.
- **Tests:** `CustomShowSyncService.test.ts`. The stubs return the id map, and the old lookup now fails the test if
  it's called. Six tests fail against the previous service.
- **Upstream:** not sent.

### Switchable audio in Plex Live TV: a fixed audio track layout per channel (2026-10-16)

- **What you saw:** Plex Live TV offered one audio track, whichever the program's selection picked, so a dual-audio
  anime episode played in one language with no way to switch. Tested on 2026-10-14:
  - the Apple TV's audio menu does switch when the stream has several tracks;
  - Plex picks each account's preferred audio language from them;
  - but Plex keeps the track list it sees at tune-in for the whole session, and ends the session if the stream
    restarts, so the tracks can't change from program to program.
- **Change:** a channel setting, **Audio tracks**, under _Audio & Subtitles_ on the Streaming tab:
  - **What it is:** `Channel.audioTracks`, up to four ISO 639-2 codes in order, stored in the new column
    `audio_tracks` (migration 0054).
  - **Effect:** every program, commercial, gap (offline picture, with gap music or silence) and error screen on the
    channel outputs exactly those tracks, in that order, tagged with their languages.
  - **Filling a slot:**
    1. the program's main track, if it is already in that language;
    2. otherwise its track in that language: commentary skipped, then selected, default, first;
    3. otherwise the main track again, so the list never changes.
  - **Recommended Anime setting:** `eng, jpn`, English first, as the user chose.
- **How** (plans/switchable-audio.md):
  - **Builder:** several streams on an audio input each get their own label and `-map` (`ComplexFilter`), language
    tag (`-metadata:s:a:<i>`), and `-ac` whenever any source differs. Each source stream gets one filter chain, shared
    by the slots that repeat it (see "A repeated audio track is filtered once" above). One stream keeps exactly today's
    arguments.
  - **Stream factory:** builds the slots (`AudioTrackLayout.ts`) for programs and placeholders.
  - **HLS alt:** its concat re-encodes audio streams 1..N.
  - **MPEG-TS:** its concat maps every stream (`-map 0`) instead of ffmpeg's pick of one audio track.
  - **HLS's `.ts` wrapper** already copies every stream.
  - **Not covered:** HLS Direct v2 and remux copy the source, so the UI disables the field there.
- **Verified end to end** (stream-repro, jellyfin-ffmpeg 8.1.3, new `--channel-setting` option), with a 20 s flex gap
  and three clips (English stereo; English 5.1 at 44.1 kHz with subtitles; English + Japanese), layout `eng, jpn`:

  | Mode    | Result                                      |
  | ------- | ------------------------------------------- |
  | HLS     | 35/35 segments `[eng 2ch 48k, jpn 2ch 48k]` |
  | HLS alt | 33/33 segments, the same                    |
  | MPEG-TS | the whole capture has both tracks           |

  - **What Plex reads:** the channel's HDHomeRun `.ts` carried video + eng + jpn.
  - **English + Spanish layout:** 19/19 segments `[eng, spa]`.
  - **Without the setting:** one track, as before.

- **Tests:**
  - `AudioTrackLayout.test.ts`: slot rules, commentary, B/T codes, selected/default.
  - `FfmpegStreamFactory.test.ts`: programs, a missing language, order, no audio, gap music, offline/error
    placeholders, both concats, no layout.
  - `BasePipelineBuilder.test.ts`: chains, maps, tags, `-ac`, the concat's `-map 0`.
  - `ChannelDB.test.ts`: save, read, update without the field, clear, validation.
  - The web parser.
- **Upstream:** not sent.

### Tunarr no longer sits for minutes at startup on a cold disk (2026-10-16)

- **What you saw:** a release's first start hung after the `/dev/dri` log line: 7 minutes at 03:09 UTC (rolled back by
  hand), and 259 s at 11:13 UTC. Nothing else was logged, then a 60 s Plex timeout and "Still waiting for guide to
  generate" arrived together. Other starts of the same images took 4 to 13 s.
- **Cause**, reproduced on the deployment with a copy of its database:
  - The main thread's connection keeps pages in its own cache and doesn't map the file (the hourly-stall fix below).
    A new process starts with that cache empty.
  - On the shared server, the operating system's file cache drops the database within the hour.
  - So every page the startup queries read is a separate wait on a busy disk, and better-sqlite3 blocks the main
    thread for each one.
  - Sampled once a second during a cold start, the main thread sat in `pread64` on the database, in state `D`, using
    no CPU. It was the same picture as the 03:09 hang: a finished `vainfo` that nobody reaped, because the event loop
    never ran.
  - **Cold copy:** ready in 35 s. **The same copy read through once with `cat` (0.8 s) first:** ready in 6 s. The
    disk was quiet during the test; under the 11:13 load the same reads took 259 s.
- **Fix:** before the main thread opens the database, `bootstrapTunarr` reads `db.db` and `db.db-wal` once, front to
  back, in 1 MiB chunks (`db/readIntoFileCache.ts`). The kernel's readahead turns that into a streaming read.
  - It's capped at 512 MiB and skips missing files. A failure only means a slower start; it never stops one.
  - It logs `Read the database into the file cache: <MB> in <ms>`.
  - Workers and new installs skip it.
- **Tests:**
  - `readIntoFileCache.test.ts`: whole files across chunks, a missing WAL, the byte cap across files, and a directory
    in place of a file.
  - `bootstrap.test.ts`: an existing database and its WAL are read before `DBAccess.init`; a new install reads
    nothing. The first fails without the bootstrap change.
- **Upstream:** not sent.

### Local libraries find the subtitle files next to their videos (2026-10-16)

- **What you saw:** nothing; found while reading the subtitle code. A local library never picked up `Movie.en.srt`
  next to `Movie.mkv`, although the docs say it does. Libraries from Plex, Jellyfin and Emby aren't affected.
- **Cause:** `LocalSubtitlesService.findExternalSubtitles` handed `parseSubtitleFilePath` the subtitle's name without
  its extension or folder (`Movie.en`), so the extension check saw `.en` and dropped every file. Three smaller faults
  sat behind it:
  - the video's name was stripped of an extension twice, so `Movie.2010` became `Movie`;
  - `Episode 1` matched `Episode 10.en.srt`, and `Movie` matched `Movie.part2.en.srt`;
  - `Movie.srt` was read as the language `srt`.
- **Fix:** `server/src/services/local/LocalSubtitlesService.ts`:

  - it passes both full paths;
  - a file must start with the video's name and a dot, and not with a longer video name in the same folder;
  - the language is the first part that is a language code, or looks like one and isn't an option (a private
    code such as `qaa`). `Movie.hi.srt` is Hindi; `Movie.en.hi.srt` and `Movie.qaa.hi.srt` are for the hard of
    hearing. Failing that it's the first part that isn't `hi`, `cc`, `sdh` or `forced`, and `unknown` when there is
    none;
  - extensions match in any case.

  The ffmpeg docs list the naming rules. Folders that haven't changed since their last scan need one **Force Scan**.

- **Tests:** `LocalSubtitlesService.test.ts`:
  - real files in a temporary folder: full paths, other files ignored, a dot in the video's name, a neighbouring
    episode's subtitles, a longer video name;
  - no language, flags first, `hi` as Hindi or as hard of hearing (also after a private code), upper-case
    extensions.
- **Upstream:** not sent.

### Captions follow subtitle placement, and overlapping subtitles show together (2026-10-16)

- **What you saw:** captions went only at the top (an inline `{\an7-9}`) or the bottom. ASS styles, exact positions, the middle and the sides were ignored, and vector drawings came out as text. When two subtitles overlapped, the later replaced the earlier, which never came back.
- **Why it mattered, in this library:** the extracted ASS files style 4,336 lines at the top and about 1,100 at a side, and position 43,786 with `\pos` or `\move`; 1,448 lines are drawings. About 1,400 SRT files have 20,339 overlapping pairs, nearly all two bottom lines.
- **Placement** (`Cea608Encoder.ts`, `ProgramCaptions.ts`): a caption is now a list of blocks, each placed in a third of the screen: top, middle or bottom, and left, centered (by the alignment setting) or right. A cue's place comes from, in order:

  1. an ASS `\pos` or `\move` start point, against the script's PlayResX/PlayResY (filled in as libass does);
  2. its alignment override (numpad `\an`, or SSA's `\a`);
  3. its ASS style's alignment (`[V4+ Styles]`, or `[V4 Styles]` in SSA numbering, each by its own Format line);
  4. the bottom.

  The middle sits between the top and bottom rows; right-aligned lines end at column 32. Drawing text is left out, and a layered copy of a line (the same text at the same times) is kept once. Files that only use `{\an8}`, as all of the library's SRT do, show as before.

- **Overlaps** (`resolveOverlaps`, setting `overlappingCues`):

  - **together** (default): while subtitles overlap by more than 500 ms they share one block, older above newer, the newest 4 lines kept. Stretches under a second fold into a neighbour so each caption has time to load. When their places differ, the block goes at the bottom, because FFmpeg-family decoders position only a caption's first row.
  - **apart:** each band keeps its own block, for players that position every row.
  - **newest:** the later replaces the earlier, which comes back when it still has at least a second and the next caption can load.

  Paint-on and roll-up are unchanged, and input without overlaps is returned as is (the golden snapshot is unchanged).

- **Test pattern:** samples 35 (middle), 36 (right-aligned), 37 (two lines stacked) and 38 (a top sign and a bottom line as two blocks: the check for `apart` in Plex). FFmpeg writes a position for each block, but libass honours only the first in an event, so in FFmpeg's own rendering sample 38 shows both at the top.
- **Tests:** `Cea608Encoder.test.ts` (middle, sides, legacy SSA, drawings, ASS precedence, stacking, the 4-line cap, apart, newest and its comeback rule, paint-on unchanged; the overlap tests fail with the resolver off), `ProgramCaptions.test.ts` (styles in any column order, SSA numbering, unknown and `*` style names, PlayRes fallbacks, layered lines), `CaptionTestPattern.test.ts`, and through jellyfin-ffmpeg 8.1.3 (`CaptionInsertion.local.test.ts`: middle and right positions, stacked rows, the two-block caption's positions).
- **Upstream:** not sent.

### Closed caption appearance settings, and a test pattern (2026-10-15)

- **What you wanted:** every presentation feature CEA-608 closed captions have, as settings, to find out which ones Plex Live TV shows. Plex draws captions itself, with a decoder of FFmpeg's family, so what it honours can only be found by trying.
- **Settings** (Settings > FFmpeg > Caption appearance (experimental), `hdhrCaptionAppearance`, and `hdhrCaptionTestPattern`):

  - text color; the box behind the text (the player's own by default) and its opacity;
  - pop-on, roll-up with 2, 3 or 4 rows, or paint-on;
  - lines per caption (2–4), line width (20–32 columns), bottom and top rows;
  - all capitals; keeping the subtitle file's italics and underline, and its top placement.

  The defaults send what Tunarr always sent. `Cea608Encoder.golden.test.ts` pins those bytes for a varied cue set, each alignment, three frame rates and a program end; the snapshot was recorded before any encoder change and never updated.

- **Encoder** (`server/src/stream/captions/Cea608Encoder.ts`): `buildCaptionSchedule` takes an appearance (the settings, the alignment, and flash for the test pattern), and a cue can carry its own.
  - **Color:** a mid-row color code at the start of each line. 608's italics are white, so an italic run loses the color and the code ending it restores it.
  - **Box:** a space, then the background code (semi-transparent with the low bit, or transparent `0x17 0x2d`), at the start of each line. One column each, counted in the width.
  - **Rows, lines, width, capitals:** bottom captions end on the bottom row and top ones start on the top row, always on screen. Capitals and the style and placement switches apply before the width is measured.
  - **Paint-on:** Resume Direct Captioning before the cue, Erase Displayed Memory on its start frame, then the text as it arrives.
  - **Roll-up:** erase and the roll-up command when the mode starts, then each line as a carriage return, a preamble on the base row, and its text, from the cue's start frame. A cue's lines stay together, aligned as a block, and the last lines stay up for up to 2 s for the next cue to scroll.
  - **Mixed modes:** a caption only replaces one in its own mode without a clear, the next caption's pairs never start before the last one's end, and a carriage return is never sent while a pop-on caption loads (FFmpeg's decoder would take it as a roll-up).
  - **Notice:** "No captions for this program" waits for a longer load when the appearance makes one (`captionLoadFrames`), never earlier than before.
- **Test pattern** (`CaptionTestPattern.ts`): 34 numbered samples that loop for the program's length, one per feature, each saying what it should look like and carrying its whole appearance, so the settings don't change it. It replaces the captions of every program that would get some. Docs list the samples.
- **Checked with jellyfin-ffmpeg 8.1.3** (`CaptionInsertion.local.test.ts`): FFmpeg's decoder shows the text and box colors (`\c`, `\3c`), rolls lines up keeping the chosen rows, and times paint-on and roll-up from the start frame. It ignores flash, see-through and transparent boxes, so those are the ones most likely to do nothing in Plex.
- **Tests:**
  - `Cea608Encoder.test.ts`: each option through a new frame-by-frame test decoder (`testing/captions/Cea608TestDecoder.ts`); paint-on, roll-up and mode changes; the notice loading in full under heavy appearances.
  - `CaptionTestPattern.test.ts`: numbering, whole appearances, timing and looping; every sample shows, in order, whatever the settings.
  - `HlsSession.test.ts` (the settings reach each program's captions), `FfmpegStreamFactory.test.ts` (the pattern replaces captions and the notice; the notice waits for a longer load), `ProgramCaptions.test.ts`.
  - The web settings page passes the e2e sweep, and with captions on its controls save.
- **Known limits:** italic words are white whatever the text color. A box or color makes each caption take longer to send, so fast dialogue can show captions a little late. Roll-up and paint-on send a caption's text while it is up, at two characters a frame; what doesn't fit before its end is cut off, so it never outlasts its subtitle or holds up the next one. What Plex does with each option is untested until the test pattern is watched on an Apple TV; a preview and "works in Plex" labels come after that.
- **Upstream:** not sent.

### A session's first program shows its captions on time (2026-10-15)

- **What you saw:** on the first program after tuning in, closed captions came one to two frames early, and a cue
  already under way at tune-in never showed. Later programs were on time.
- **Cause:** a session's first program was encoded with no `-output_ts_offset`. libx264's B-frames make its first
  decoding timestamps negative, so the MPEG-TS muxer shifted the whole program later to keep them positive. Its first
  frame came out at PTS 6000, two frames at 30 fps, while its captions were laid out from 0.
  - Every caption landed two frames before the frame its schedule meant.
  - The first two frame slots were never sent. They held the start of the load for a cue already under way.
  - Later programs start at a positive offset, so nothing is shifted.
  - By the same arithmetic, the WebVTT subtitles in Tunarr's own players were two frames early on the first program
    too (not measured).
- **Fix:**
  - **Session start** (`SessionStartPts`, `server/src/stream/hls/HlsSession.ts`): a session's output clock starts at
    1 s (90,000 at 90 kHz), so the first program is muxed at an exact offset like every later one. hls_direct_v2 keeps
    0, since it copies the source's timestamps. The fallbacks for an unreadable last segment start there too.
  - **Seek** (`firstFrameMs`, `ProgramCaptions.ts`): cues on a tuned-in program are timed from the first frame at or
    after the seek, the frame ffmpeg starts the stream with. Timing them from the seek itself put them up to a frame
    late. This assumes the source's frames sit on its frame rate's grid, as constant-rate video does.
  - **Late captions** (`buildCaptionSchedule`, `Cea608Encoder.ts`): a caption that can't be loaded before it ends is
    left out, instead of flashing for one frame. The caption it would have replaced is cleared at its own end. A cue
    nearly over at tune-in is the usual case, and its load also held up the next caption by a few frames.
  - **Offline and error streams** (`createPlaceholderSession`): they now pass `isFirstTranscode`, as program streams
    do. Without it the pipeline guessed a first transcode from an offset of 0, so a session that began on an offline
    gap would have opened its HLS output with a discontinuity (`discont_start`, `+initial_discontinuity`).
- **Checked** on a stream-repro test server: three 40 s clips with a subtitle cue every 2 s, captions on,
  jellyfin-ffmpeg 8.1.3. The captioned HLS segments were read for 50 s and decoded with ffmpeg's 608 decoder. Each
  caption's frame was compared with its cue on absolute timestamps.

  |                                              | Before                       | After                            |
  | -------------------------------------------- | ---------------------------- | -------------------------------- |
  | First program's first frame                  | PTS 6000                     | PTS 90,000, exactly the offset   |
  | First program's captions against their cues  | 1 to 2 frames early, by seek | on the frame                     |
  | A cue under way at tune-in, about 0.9 s left | not shown                    | shown once loaded, until its end |
  | A cue 2 ms from its end at tune-in           | not shown                    | left out, the next one on time   |
  | Later programs                               | on the frame                 | on the frame                     |

  - **Offline start:** a session that began on a 12 s offline gap started at offset 1 s with no discontinuity flags.
    The programs after it had them as before, and the capture had no findings.
  - **Tune-in:** the `.ts` stream's first byte came 3.4–4.3 s after the request, against 3.3–4.6 s before, at the same
    data rate. Its reader paces from its input's first timestamp, so starting at 1 s adds no wait.

- **Tests:**
  - `HlsSession.test.ts`: the first program starts at `SessionStartPts`, its captions land on their frames, and
    hls_direct_v2 stays at 0. Two fail without the fix.
  - `Cea608Encoder.test.ts`: a cue under way that can't load in time is left out and the next one shows on its frame;
    a caption whose replacement is left out is cleared at its end. Both fail without the fix.
  - `ProgramCaptions.test.ts`: `firstFrameMs`, and cues timed from the first frame (fails without the fix).
  - `SessionStartPts.local.test.ts` (with ffmpeg): at 0 the first frame comes whole frames late, and at
    `SessionStartPts` exactly there.
  - `FfmpegStreamFactory.test.ts`: offline and error placeholders hand `isFirstTranscode` and the offset to the
    pipeline. Both fail without the change.
- **Upstream:** not sent.

### Custom show syncs run in a scan worker (2026-10-15)

- **What you saw:** nothing reported. It was the last sync work on the main thread.
- **Cause:** `CustomShowSyncService` ran on the main thread, which serves streams. It ran from the hourly `SyncCustomShowsTask` and from the create and Sync Now routes.
  - A 1,000-movie playlist kept that thread busy for 7 s on the first sync and 2.8 s on each hourly resync.
  - The lookup that ends every sync (`lookupByExternalIds`, which loads each program with all its relations) stalled requests for 163–186 ms, and 870 ms at 3,000 movies.
- **Fix:** the sync is a scan job, `{kind: 'custom-show', customShowId}` (`types/worker_schemas.ts`). `MediaSourceScanCoordinator.syncCustomShow` runs it like a library scan: in a scan worker when there is one, one job at a time, in-process with `TUNARR_SCAN_IN_WORKER=false`.
  - **The job:** `ScanJobExecutor` hands it to `CustomShowSyncService.syncShow`, which skips a show that's gone or unlinked, and on a cancel stops before the next item without writing a partial list.
  - **Routes:** create and Sync Now wait for the sync and answer with the synced show. If the sync fails, Sync Now
    answers 500, while create still creates the show and answers 201 with it unsynced (as before). Both go ahead of
    waiting scans, even when Sync Now joins a sync the hourly task queued, but wait for a running one.
  - **Joining and locks:** a second request for a show joins the first. Each show has its own lock, which `isSyncing` reads.
  - **No reconcile:** a sync doesn't reconcile channel durations.
  - **The task:** `SyncCustomShowsTask` queues every linked show and ends when they've run.
  - **Sync Now 500:** Sync Now always answered 500, because its response left out `isSyncing`. Fixed in its own commit.
  - **Probe harness:** `measureWithConcurrentProbe` missed a stall at the very end of an operation. Fixed in its own commit.
- **Numbers:** `pnpm bench:custom-show-sync`, 1,000 movies, median of 2 trials, main-thread CPU and worst stall:
  - first sync: 7.4 s and 176 ms in-process, against nothing measurable and 9 ms in a worker;
  - resync: 2.3 s and 165 ms in-process, against nothing measurable and 19 ms in a worker;
  - 3,000 movies, first sync: 26 s and 875 ms in-process, against nothing measurable and 10 ms in a worker.
- **Tests:**
  - `ScanJobExecutor.test.ts`, `MediaSourceScanCoordinator.test.ts`, `ScanWorkerRoundTrip.test.ts` and `CustomShowSyncService.test.ts`;
  - new `SyncCustomShowsTask.test.ts`, `tests/customShowSync.test.ts` (API against a stand-in Plex server) and `tests/support/probe.test.ts`;
  - new perf test `tests/perf/customShowSyncLag.test.ts`.
- **Upstream:** not sent.

### Live TV playlist requests no longer slow down the longer a channel is watched (2026-10-15)

- **What you saw:** after PR #11, a Live TV playlist request still re-read and re-parsed the session's whole `stream.m3u8`. The cost grew with the session: ~6 ms at 3 hours and ~25 ms at 11 hours on a laptop, about 6 times that on the server, on the main thread every few seconds per viewer.
- **Cause:** ffmpeg never trims the playlist (`hls_list_size 0`, `append_list`), and `HlsSession.trimPlaylist` parsed all of it on every request to keep 20 segments.
- **Fix:**
  - `MediaPlaylistReader` parses only the bytes ffmpeg appended since the last request. It checks the first and last 256 parsed bytes, and parses the whole file again when the file shrank or changed. ffmpeg rewrites old entries byte for byte; only its header changes.
  - `MediaPlaylistIndex` keeps per-segment discontinuity counts, so `HlsPlaylistMutator.trimIndex` builds the playlist from the segments it holds.
  - `HlsSession` drops segments below the pruning floor, which bounds memory too.
  - Served playlists are unchanged.
- **Numbers:** per request at 5,265 / 20,000 / 43,200 segments: 6.0 / 23.6 / 51.3 ms before, 0.13 / 0.15 / 0.16 ms after (MacBook, median of 31).
- **Tests:**
  - `HlsSession.test.ts`: a request on a 20,000-segment session reads under 8 KiB (2.8 MB on `main`, which fails).
  - `MediaPlaylistReader.test.ts`: scenario tests plus randomized tests against main's trim (kept as `src/testing/hls/ReferenceHlsPlaylistTrim.ts`).
  - `HlsPlaylistMutator.test.ts`: 1,000 random playlists against main's trim.
  - stream-repro shadow check: every real request matched main's trim.
- **Upstream:** not sent.

### Smart collection filters with `genres.name` (2026-10-15)

- **What you saw:** Six smart collections logged "has unparseable filter … Results will be wrong" whenever smart collections were listed, and the startup fixer logged "has keywords set but an unparseable filter". Their filters (`genres.name in [...]` with `title in`/`title not in`, joined by AND/OR) were ignored, and a copy of each filter in `keywords` ran as a full-text search.
- **Cause:** The query language calls the field `genre`, and `genres.name` is its search index path. The API stored the filter tree with the field name the client gave, so it wrote a string its own parser rejects at the `.`. The startup fixer then copied each filter into `keywords` and tried to clear the filter. The clear never happened, because `update` skips an undefined filter, so the warning repeated on every start.
- **Fix:** The parser accepts a string field's index path as another name for the field. `searchFilterToString` writes field names the parser knows, writes `added_date` as a date, and adds parentheses where a nested AND/OR group would otherwise be read back differently. The fixer writes columns directly, so `null` clears them. It moves a filter into keywords only for rows saved before the keywords column (NULL keywords). Any other filter stays a filter. When the filter parses, it clears keywords that exactly equal the filter, which is what the old fixer copied. One collection whose keywords are an older copy of a since-edited filter keeps them until the client re-saves it with `keywords: ""`.
- **Tests:** `shared/src/util/searchUtil.test.ts` ("saved filter strings"), `server/src/db/SmartCollectionsDB.test.ts`, `server/src/tasks/fixers/FixSmartCollectionFilters.test.ts`.
- **Upstream:** not sent.

- **Known limit:** a collection saved before the keywords column (keywords NULL) whose free-text query starts with an index path such as `genres.name:` now parses as a filter instead of a text search. This fork's deployment has no NULL-keyword collections (checked 2026-10-15). Sending this upstream would need the fixer to move such NULL-keyword filters into keywords.

### Tunarr keeps its database in its own memory, so it stops stalling on the hour (2026-10-15)

- **What you saw:** Live TV paused briefly at the top of the hour. A latency probe saw stalls at :00 every hour,
  from 0.4 s to 5.9 s; the worst was at 07:00 UTC.
- **Cause**, measured on the deployment, a shared server:
  - At 19:00 UTC the main thread spent 4.5 s in uninterruptible disk wait (state `D`, not in a system call, so on
    page faults). It used no CPU, while the server's disk pressure rose from 26% to 42%.
  - The main connection memory-mapped the database (`mmap_size` 256 MiB, a 140 MB database). Mapped pages live in
    the operating system's file cache, which the other users' processes share.
  - At 19:02, just after an hourly run, 96% of the database file was cached. By 19:58 it was 2%.
  - Tunarr's hourly tasks start at :00, the same second as the other users' hourly jobs, so their reads waited on
    the busiest disk of the hour.
  - Reading the file once at 19:59:30 (back to 100%) cut the 20:00 disk wait to about 0.15 s.
- **Fix** (`db/DBAccess.ts`, `connectionPragmas`):
  - The main thread's connection doesn't map the file (`mmap_size = 0`) and keeps up to 256 MiB of pages in its own
    page cache (`cache_size = -262144`), room for the whole database. Process memory isn't evicted for other
    processes, and the box has no swap.
  - Another connection's write (a scan worker, say) empties that cache, so it refills after scans.
  - Workers keep the previous settings: a worker waiting on the disk blocks nothing else.
- **Numbers:** the perf tests got no slower (guide rebuild worst probe 7.8 ms, slot save 15 ms, library request
  21 ms). The deployment's hourly stall will be re-measured after the release. Memory: up to about 150 MB more for
  Tunarr's main process on this database.
- **Tests:** `DBAccess.test.ts` ("connection settings"): the main thread's connection reports `mmap_size` 0 and
  `cache_size` -262144, with WAL and foreign keys still on, and workers keep the old values. Both tests fail before
  the change.

### A long Live TV session no longer stalls Tunarr every few seconds (2026-10-15)

- **What you saw:** about two hours into watching a channel, every request to Tunarr stalled for 270-380 ms about
  every 4 seconds (seen with a latency probe and `curl`). The main thread was running JavaScript the whole time.
- **Cause:**
  - Each program's ffmpeg appends to the session's `stream.m3u8`, which is never trimmed on disk. After about 3 hours
    it held 5,265 segments in 15,743 lines, while only the last 39 segment files still existed.
  - Every playlist request (`HlsSession.trimPlaylist`) re-reads the whole file and `HlsPlaylistMutator` parses all of
    it, to keep about 20 segments.
  - The parse did one `dayjs` addition per segment.
  - Writing out the playlist compared every item against each kept segment with `equals`, which uses `dayjs`'s
    `isSame` and builds new date objects on each call. That's about 100,000 date comparisons per request.
- **Fix** (`stream/hls/HlsPlaylistMutator.ts`):
  - **Membership:** the kept segments are the parsed objects themselves, so the output loop and `findIndex` use a
    `Set` and `indexOf` (identity).
  - **Parsing:** the parse adds durations as milliseconds, truncating at each step as a `Date` does, so the times are
    the same. A segment's `startTime` (a `Dayjs`) is only built when read: for the ~20 kept segments.
  - **`equals`:** compares the millisecond start.
- **Numbers:** on the real 5,265-segment playlist, `trimPlaylist` went from 58 ms to 6 ms (MacBook), with
  byte-identical output. On the server that's about 330 ms → about 35 ms per request. The cost still grows with the
  session, ten times more slowly. Rewriting the playlist on disk periodically (the TODO in `parsePlaylist`) would
  bound it.
- **Tests:** `HlsPlaylistMutator.test.ts` ("a long session"):
  - trimming a 3,000-segment playlist calls `isSame` never and `add` at most once per kept segment (fails before);
  - the kept segments' program date-times equal the old chained `add` results, millisecond truncation included.
- **Upstream:** not sent.

### The library programs request no longer freezes Tunarr (2026-10-15)

- **What you saw:** Live TV paused while a script ran against Tunarr (`build_grid.py`, even with `--dry-run`). A latency
  probe saw two freezes, of 17,061 ms and 17,158 ms, one per run.
- **Cause:** `GET /api/media-libraries/:libraryId/programs` built its whole response in one go on the main thread,
  which also serves the streams:

  - one Drizzle query with the full relation set, so every episode carries its show's and season's cast, artwork and
    genres;
  - then the conversion, the Zod encoding and `JSON.stringify` of the whole array.

  better-sqlite3 is synchronous, so none of it let another request in. The TV library has 5,393 episodes.

- **Fix:** the body is built a page at a time (`pagedJsonArray` and `libraryProgramsJson` in
  `api/libraryProgramsJson.ts`).
  - **Yielding:** it yields between pages, and between each page's read, conversion and encoding.
  - **Page size:** it follows how long a read blocks, aiming for about 30 ms with 10 to 100 rows per page, so a slow
    or busy server takes smaller pages.
  - **Query:** the page query is prepared once and walks the uuid index
    (`ProgramSearchRepository.getMediaSourceLibraryProgramsPage`). Building and compiling its nested query for every
    page had cost about as much as reading the page.
  - **Response:** each page is encoded with the route's own schema, so the items and fields are the same as before.
    Items now come in uuid order.
  - **Streaming:** each page's JSON goes to the client as soon as it is built (`sendJsonChunks`), with
    `Transfer-Encoding: chunked` and no `Content-Length`. At first the pages were joined and sent at the end. On
    production that made one 185 MB string, and joining and sending it froze Tunarr once more, for 0.93 s, at the end
    of the 20 s request.
    - A slow client holds the next page back, so Tunarr holds about one page instead of the whole body.
    - A failure in the first page is still an error response. After that the status is already sent, so Tunarr
      closes the connection: the client sees a broken download, never a shorter list.
    - A client that disconnects stops the page reads.
- **Numbers** (perf test, MacBook):

  | Episodes | Worst stall of a concurrent request | The request itself |
  | -------- | ----------------------------------- | ------------------ |
  | 1,500    | 678 ms → 28 ms                      | 0.7 s → 1.3 s      |
  | 5,400    | 2.6 s → 39 ms                       | 2.6 s → 5.6 s      |

  On the production server the same request had frozen it for 17 s. Paged but joined at the end, it still froze it
  for 0.93 s.

  With a 185 MB body like production's (`TUNARR_PERF_CAST=160`) and the client in another process, 3 runs each,
  joined at the end → streamed: worst stall 74–76 ms → 49–59 ms, p99 about 23 ms either way, and peak memory during
  the request about 1.0 GB → 0.6 GB. The MacBook joins and sends 185 MB about 12 times faster than production did.

- **Tests:**
  - `api/libraryProgramsJson.test.ts`: paging across boundaries, an empty library, the yields, and page-size
    adaptation. Each page is its own chunk; a first-page failure comes before any chunk; a stalled client holds the
    pages back; a closed stream reads no more pages.
  - `tests/libraryProgramsResponse.test.ts`: the body matches the one-shot response for episodes and movies. Over a
    real connection: the body is chunked, a first-page failure is a 500, a later failure cuts the download off, and
    the first page arrives while the second is still held.
  - `tests/perf/libraryProgramsLag.test.ts`: worst concurrent request under 250 ms. It fails before the fix. Scale
    it with `TUNARR_PERF_SHOWS` / `_SEASONS` / `_EPISODES` / `_CAST`. It fetches with `curl`, so the client's reading
    isn't counted against the server's event loop.
- **Upstream:** not sent.

### Uploaded images are saved with the public address, not `http://` (2026-10-15)

- **What you saw:** images uploaded in the web UI behind the HTTPS proxy were saved as
  `http://<public host>/images/uploads/…`, so channel offline pictures pointed at plain http while the rest used https.
- **Cause:** `POST /api/upload/image` built the address it returns from the request, `${req.protocol}://${req.host}`.
  A proxy that terminates HTTPS forwards plain http, and Tunarr trusts no proxy headers by default, so the request
  said `http`. An upload through an SSH tunnel got `http://localhost:…`, which no app can load.
- **Fix:** an upload answers with the configured public address (Settings → XMLTV, the one the guide's pictures use)
  when there is one, and with the request's address otherwise (`uploadedImageUrl` and the new `publicLinkOrigin`,
  `util/iconUtil.ts`; `api/index.ts`). The guide's `xmlTvLinkHost` uses the same rule through `publicLinkOrigin`.
  - **Existing uploads:** they keep the address they were saved with until uploaded again.
  - **Docs:** `docs/configure/clients/plex.md`.
- **Tests:** `iconUtil.test.ts`: behind an HTTPS proxy and through `localhost` an upload gets the public address, and
  without one it gets the request's address. They fail without the fix.
- **Upstream:** not sent.

### Guide posters are served from a public media folder, with versioned addresses (2026-10-15)

- **What you saw:** guide posters loaded slowly in Plex's apps, and a replaced poster kept showing the old picture.
  One poster took 1.4 s and 628 KB per load, with `Cache-Control: no-cache`.
- **Cause:** the guide linked each programme to `/api/programs/<id>/artwork/<type>`, which fetches the picture from
  the media server again on every request and passes the server's caching headers through. The address never
  changed when the picture did, and Plex's image cache (3 days) and its apps key by address.
- **Fix:** each guide write publishes every programme's picture as a file in `<data>/media/artwork/`, and the guide
  links to it (`services/PublicMediaService.ts`, `services/XmlTvWriter.ts`, `Server.ts`).
  - **Address:** `/media/artwork/<id>-<type>.<ext>?v=YYYYMMDDHHMMSS`, served with
    `Cache-Control: public, max-age=31536000, immutable` and `nosniff`. The version is the second (UTC) the bytes were
    saved. A rescan that finds the same bytes keeps the address, and two changes within one second get versions one
    second apart.
  - **One file per version:** each version is its own file, `<id>-<type>.<version>.<ext>`. A small route maps the
    `?v=` to it, so an address always serves the bytes it was published with, even to a client still holding an
    older guide. A replaced version is kept for 30 days. A request without a valid version, or for a version that
    doesn't exist, gets a 404 with no cache header.
  - **Cheap when nothing changed:** the guide already loads each picture's artwork row, so it passes the row's cache
    or source path along. A picture whose source matches what was published needs no lookup. Each picture yields to
    the event loop first. On the guide rebuild perf test (1,375 pictures, all unreachable), the longest request stall
    went from 2.6 s to 15 ms.
  - **Fetching:**
    - A picture is fetched again only when its source changes (a Plex path ends in Plex's own timestamp for the
      image), or after 7 days, with at most 20 such refreshes per write. A refresh that fails waits another week, so
      it can't take the quota from the rest.
    - Only JPEG, PNG, WebP, GIF and AVIF are published, judged by the bytes; an SVG could run script on Tunarr's
      origin.
    - A fetch is cut off at 10 s and 25 MB, and a failed one is retried after an hour.
    - One write spends at most 60 s on pictures. Past that, the rest skip their lookups and keep the files they have,
      and a fetch still running is cut off.
    - Anything not published keeps the artwork route address.
    - A failed fetch is logged with its URL and error code only, never the error object, which carries the
      request's headers and so the media server's token.
  - **Index:** `<data>/media/artwork-index.json`, outside the served folder. It's a JSON file rather than a table, so
    the fork adds no migration to collide with upstream's numbering. If it's lost, a version already on disk with the
    same bytes is adopted, so its address doesn't change.
  - **Cleanup:** pictures no guide write has linked for 30 days are deleted, along with their earlier versions.
  - **Uploads:** an `/images/uploads/…` request carrying `?v=` (every upload URL since the logo fix) gets the same
    year-long immutable header. Without `?v=` it keeps `max-age=0` (`versionedUploadCacheControl`, `util/iconUtil.ts`).
  - **Not changed:** credit images and the web UI keep the artwork routes.
  - **Docs:** `docs/configure/clients/plex.md`.
- **Tests:**
  - **`PublicMediaService.test.ts`:**
    - the file and version;
    - an unchanged source isn't fetched again;
    - a matching source hint skips the lookup;
    - the same bytes from a new source keep the address;
    - new bytes get the next second, and the old URL keeps its bytes;
    - a change after changing back gets a version above every earlier one, so no retired file is overwritten;
    - a new format keeps the old one at its old URL;
    - a replaced version is kept 30 days, then deleted;
    - the weekly refresh, and refreshes that keep failing wait a week so the rest get their turn;
    - an SVG is never published;
    - failed fetches back off for an hour, including a replaced picture whose new source fails;
    - past the budget, later pictures skip their lookups;
    - a lost index adopts the file;
    - the 30-day cleanup;
    - URL-to-file mapping refuses malformed names and versions;
    - load errors are described without headers.
  - **`XmlTvWriter.test.ts`:**
    - the source hints;
    - a write publishes each picture once, and the `<icon>` and `<image>` link to the file;
    - a failed publish still writes the guide.
  - **`iconUtil.test.ts`:** the upload header.
  - **Throwaway server, local movie library:**
    - the guide linked both posters, served with the immutable header (`HEAD` too);
    - a second write kept both addresses;
    - after one poster was replaced and rescanned, its new address served the new bytes and its old address still
      served the old ones;
    - missing, short or unknown versions, `..` paths and `.svg` all returned 404, with no cache header.
- **Upstream:** not sent.

### An HLS Direct v2 channel with subtitles starts even when no one is talking (2026-10-14)

- **What you saw:** an HLS Direct v2 channel with subtitles on never started. Tunarr waited for the subtitle
  playlist (`subs.m3u8`), gave up after 15 s with "Stream not ready yet", and the stream failed. With subtitles off, or
  in another stream mode, the same channel started.
- **Cause:** ffmpeg's segment muxer, which writes the WebVTT subtitle track (`HlsSubtitleOutputFormat`), writes
  `subs.m3u8` only when it closes a subtitle segment, and it closes one only when a cue arrives after the segment's
  end. HLS Direct v2 maps a program's embedded subtitles from the program's own input, which ffmpeg reads at playback
  speed after a 60 s read-ahead. So a stream that started more than about 75 s (the read-ahead plus the 15 s start-up
  wait in `HlsSession.getAdditionalRequiredFiles`) before the next lines of dialogue had no `subs.m3u8` in time, though
  its video segments were ready. That covers opening credits, a quiet scene, or a forced-only subtitle track. The other
  modes burn subtitles in, or read an extracted subtitle file at full speed, so they didn't hit this.
- **Fix:** before a program with a subtitle track starts, `HlsSession` writes an empty live `subs.m3u8` if there isn't
  one. ffmpeg replaces it when it closes its first subtitle segment. A playlist an earlier program left is kept, so a
  client never sees it emptied. Start-up still waits for `subs.m3u8`, which now exists from the start
  (`server/src/stream/hls/HlsSession.ts`).
  - **Docs:** `docs/configure/ffmpeg/index.md` says HLS Direct v2 always serves text subtitles as WebVTT, that its
    subtitle track can be empty until the next line, and that the experimental switch is for the HLS mode.
  - **stream-repro:** `--subs-start S` puts each clip's first cue S seconds in, and `--no-subtitles` turns the
    channel's subtitles off. Cue times past 59 s are now valid SRT.
- **Tests:** `HlsSession.test.ts`: a session whose program has subtitles is ready as soon as its video is, before
  ffmpeg writes a subtitle segment (without the fix, start-up gives up after 15 s with "Stream not ready yet"); a
  playlist an earlier program left is kept; a program without subtitles gets no subtitle playlist. With stream-repro
  (`--mode hls_direct_v2 --layout subs --clips 2 --clip-seconds 150 --subs-start 90`): before, start-up failed after
  15 s with 8 video segments ready and no `subs.m3u8`. After, the channel started in about 1 s, and `subs.m3u8` was
  empty until the program reached its first cue at 90 s, then listed the lines.

### Tunarr warns when a channel's transcode falls behind real time (2026-10-14)

- **What you saw:** a channel paused briefly every so often, for many minutes, and Tunarr logged nothing. Timing the
  segment files by hand showed 2.002 s segments arriving every 2.1 to 2.3 s, about 0.95x real time, so players kept
  running dry. The source was 10-bit HEVC 1080p, transcoded to libx264 `veryfast` with `-threads:v 4`. Raising the
  transcode config's thread count to 8 fixed it.
- **Cause:** nothing measured how fast a transcode produces video. A transcode below real time looked the same as a
  healthy one in the logs.
- **Fix:** while an HLS transcode runs, Tunarr follows its playlist and compares the video it produces with wall-clock
  time. When a program stays below 0.98x over a minute of output, and keeps there for 20 s more, it logs one warning
  naming the channel, the program, the speed and the transcode config's thread count, with the remedies. It logs one
  info line if the program gets back to 0.99x, and nothing more for that program.
  - **Measuring:** `TranscodeSpeedMonitor` (`stream/hls/TranscodeSpeedMonitor.ts`) takes "a segment of N seconds
    finished at T" and reports the change of state. Time counts from the first segment, so ffmpeg's start-up and
    probing don't count. The initial read burst only makes the speed higher. The extra 20 s keeps a stall that ffmpeg
    catches up (a slow disk or network read) from warning.
  - **Following the playlist:** `TranscodeSpeedWatcher` (`stream/hls/TranscodeSpeedWatcher.ts`) reads the end of
    `stream.m3u8` every 2 s. It takes durations from `EXTINF` and finish times from the segment files' mtimes, so the
    poll interval doesn't affect the measurement. Segments of earlier programs, which share the playlist, are skipped.
  - **Wiring:** `HlsSession.transcode` starts a watcher before each program's ffmpeg and stops it when ffmpeg exits.
    `hls_direct_v2` copies the video and isn't watched.
  - **Docs:** `docs/misc/common-issues.md` ("Playback pauses every few minutes"): the warning and the remedies.
- **Tests:** `TranscodeSpeedMonitor.test.ts`: real time gives nothing; 0.95x gives one warning, after 80 s; recovery
  gives one info line and nothing after it; a slow start, a long first segment, a fast initial burst, a caught-up
  stall and a program shorter than the window give nothing; the log line's wording. `TranscodeSpeedWatcher.test.ts`:
  playlist parsing, mtime timing, skipping earlier programs' segments, a playlist longer than the part read, and a
  poll still running when the watcher stops delivering nothing (programs share one playlist, so it would otherwise
  read the next program's segments under this one's name; found by the Codex review).
  `HlsSession.test.ts`: the watcher runs for exactly the life of ffmpeg, the warning reaches the log, and
  `hls_direct_v2` isn't watched. Checked end to end with stream-repro and 2 s segments: a single-thread `medium`
  transcode logged one warning (`Channel 900 (Repro) is transcoding "clip01" at 0.23x real time …`) under two minutes
  after its first segment, matching the segment files' timing. A fast 360p transcode over two programs, the first
  with the 60 s read burst, logged nothing.

### Closed captions say "No captions for this program" when a program has no subtitles (2026-10-14)

- **What you saw:** Plex decides which caption tracks exist at tune-in, so it offers CC for the whole Live TV session.
  On a program without subtitles, a viewer who turned CC on saw nothing and couldn't tell whether captions were broken.
- **Why:** the HDHomeRun `.ts` stream carries the caption track on every frame, whatever is on, but only programs with
  subtitles put any text in it.
- **Change:** a program with no subtitles gets one caption, "No captions for this program", on screen from 1 s to 5 s
  into its stream (`noCaptionsNotice`, `server/src/stream/captions/ProgramCaptions.ts`).
  - **Same pipeline:** `FfmpegStreamFactory` hands the notice to `HlsSession` as the program's captions, so it is an
    ordinary pop-on caption at the bottom, in the default style, with the Caption Alignment setting. No new setting: it
    is on wherever the captions are (**Closed captions for HDHomeRun clients**, an HLS channel with subtitles enabled).
  - **Which programs:** lineup items of type `program` (scheduled programs, custom show episodes, what a redirect
    resolves to) with no subtitle track at all. Filler (`commercial`, from filler lists), flex fallback filler
    (`fallback`), offline and error streams, music tracks and streams under 8 s get none. A program whose subtitles
    can't become captions (image-based, forced only, another language) is left as it was.
  - **Tune-in:** a program's caption clock starts where its stream starts, so a viewer who tunes in partway through a
    program gets the notice too.
  - **Timing:** 4 s is about twice the time its five words take to read. It starts 1 s in rather than at 0 because a
    session's first program has no frames for the first two slots of its caption schedule: the encoder's B-frame delay
    puts its first video frame at PTS 6000 (two frames at 30 fps, with libx264) where the schedule expects 0. A notice
    loaded from the first frame lost its Resume Caption Loading code and never showed. From 1 s, it loads in the 17
    frames before it appears. Below 23.976 fps, 1 s is too few frames for the load after the two lost slots, so the
    notice starts at least 23 frames in (`noCaptionsNoticeStartMs`; about 1.5 s at 15 fps). Found by the Codex review.
  - **Docs:** `docs/configure/ffmpeg/index.md`.
- **Known limit, fixed since:** the same two-frame delay made a session's first program show its own captions two
  frames early, and a cue already under way at tune-in could be lost on it. See "A session's first program shows its
  captions on time".
- **Tests:** `ProgramCaptions.test.ts` (which programs get the notice, its cue), `Cea608Encoder.test.ts` (bottom row,
  block-centred, shown on frame 30 and erased on frame 150 at 30 fps), `FfmpegStreamFactory.test.ts` (no subtitles,
  image-based subtitles, filler, fallback, captions off, an offline gap), `HlsSession.test.ts` (served whole on a first
  program whose video starts two frames late). Checked with stream-repro on a throwaway server: an HLS channel of
  `mixed` clips (1 and 3 without subtitles, 2 with), captions and subtitle extraction on, its `.ts` URL captured for
  110 s and decoded with ffmpeg's 608 decoder. The notice showed for 4.0 s after tune-in partway through clip 1, then
  clip 2 had only its own captions, then the notice showed 1 s into clip 3 and into clip 1 again.

### A subtitle the media server no longer has is one info line, not a warning with a stack (2026-10-14)

- **What you saw:** since early October, library scans logged three warnings for each external subtitle that Plex no
  longer had: `Not found: …/library/streams/<id>`, `API client response error: … status 404 …` with Plex's HTML 404
  page and headers, and `Error while requesting external subtitle stream: Request failed with status code 404` with a
  stack trace. The scan skipped that subtitle and carried on, so nothing was broken, but it read like a failure.
- **Cause:** when a subtitle file is replaced or deleted, Plex keeps listing its stream until it rescans the item, and
  answers 404 when asked for it. The API client warned about every 404, Plex's subtitle fetch turned the 404 into a
  generic request error, and the downloader logged every fetch failure as a warning with the error object.
- **Fix:**
  - **The fetch:** the subtitle fetches (`PlexApiClient.getSubtitles`, and `getSubtitles` and `getSubtitlesByPath` in
    `JellyfinApiClient` and `EmbyApiClient`) report a 404 as `not_found` (through `BaseApiClient.requestErrorResult`).
    They pass a new `notFoundIsExpected` request option, so `BaseApiClient.doRequest` logs that 404 as one debug line
    instead of the two warnings. Every other request still warns about a 404.
  - **The log line:** `ExternalSubtitleDownloader` logs a `not_found` at info, as one line without the error. Any
    other failure is still a warning with the error. After the media server rescans the item its streams change, so
    Tunarr's next library scan rescans it and picks up the new subtitle. The line reads:
    `Plex no longer has subtitle stream 173516 for "The Movie" (item 4242); skipped until Plex rescans the item.`
  - **Its text:** `missingSubtitleMessage`. The stream id comes from `externalSubtitleStreamId` (`util/subtitles.ts`):
    Plex's stream id, or the stream index for Jellyfin and Emby, never a query string. The scanner
    (`MediaSourceScanner.ts`) and `SubtitleExtractorTask.ts` pass the program's title for it.
  - **Info, not debug:** the program plays without that subtitle until the media server rescans the item. That is
    worth seeing at the default log level, but it isn't a fault.
  - **Emby:** its subtitle fetches never caught request errors. They checked the return value for an error, which
    `doGet` never returns, so a failed fetch escaped as an exception and the scan logged it with the whole program
    record. They now return a failure like Plex and Jellyfin.
- **Tests:** `ExternalSubtitleDownloader.test.ts` (new): a 404 is one info line with no error and no warning, any other
  failure is still a warning with the error, and the message names Jellyfin and Emby streams by index without the
  query string. `MediaSourceScanner.test.ts` (new): of two sidecars, a 404 on the first logs the one line and the
  second still downloads; a 500 still warns with the error and the second still downloads. `subtitleRequests.test.ts`
  (new): Plex, Jellyfin and Emby subtitle fetches against a local HTTP server; a 404 is `not_found` with only a debug
  line, and a 500 is a generic failure that still warns. `BaseApiClient.test.ts`: a 404 still warns by default, an
  expected one is a single debug line, and other statuses still warn. Nine of the new tests fail without the change.
- **Upstream:** not sent.

### A replaced channel logo gets a new address, so Plex shows it (2026-10-14)

- **What you saw:** after replacing all six channel logos, Plex and its Apple TV app kept showing the old ones, through
  a guide refresh and an app restart.
- **Cause:** an upload keeps its file name (a channel's logo is always `<channel id>_icon.<ext>`), and the upload route
  returned the bare file URL. A replaced logo kept its exact address, and everything that caches images by address
  (Plex's image cache, its apps, Tunarr's own cache for watermarks) went on serving the old picture.
- **Fix:** `POST /api/upload/image` returns the URL with `?v=` and the first 12 hex digits of the image's SHA-256
  (`uploadedImageUrl`, `util/iconUtil.ts`). A different image under the same name gets a new address; the same image
  uploaded again keeps its address. Channel logos, offline pictures and watermarks all go through this route.
  - **What still works:** the file is served without the query string. Clearing an icon still finds its file to
    delete, because `extractLocalUploadFilename` reads only the path. Tunarr's image cache keys by the whole URL.
  - **Docs:** `docs/configure/channels/properties.md` (versioned addresses) and `docs/configure/clients/plex.md` (a new
    logo appears after Plex's next guide refresh, which ends a playing Live TV stream).
  - **Existing logos:** ones uploaded before this keep their old address until uploaded again.
- **Tests:** `iconUtil.test.ts`: the URL's shape, a different image gets a new URL, the same image keeps it, and the
  file name can still be read back. Checked end to end on a throwaway server: two images uploaded under one name got
  different URLs, and each served its own image.
- **Upstream:** not sent.

### The nightly collection sync runs in a scan worker (2026-10-14)

- **What you saw:** nothing specific. It was the last scan work left on the main thread: `SyncCollectionsTask` (daily,
  00:00) read and wrote every remote source's collections there, on the thread that serves streams.
- **Fix:** the task now queues a `collections` job per remote media source with `MediaSourceScanCoordinator`, which
  runs it like a library scan: in a scan worker when there is one, one job at a time.
  - **The job:** `{kind: 'collections', mediaSourceId}` (`types/worker_schemas.ts`). `ScanJobExecutor` re-reads the
    source when the job starts and skips it if the source is gone, local, or has no collection scanner.
  - **Lock:** each source's sync has its own lock (`EntityMutex.getLockForCollections`), so a sync still queued from
    the night before isn't queued twice. It's separate from the source's lock, so its libraries don't show as locked
    and can still be scanned.
  - **No reconcile:** collections change tags, not durations, so a collections job doesn't reconcile channel
    durations.
  - **Cancel:** the collection scanner can't stop partway, so a canceled sync ends when its scan does; in a scan
    worker, the worker is terminated after 30 s.
- **Checked end to end** on a throwaway server with a Plex source: running the task queued the sync, a scan worker
  started, and the collection scan ran in it.
- **Tests:** `ScanJobExecutor.test.ts` (a sync, a gone or local source, no scanner, a cancel),
  `MediaSourceScanCoordinator.test.ts` (queued once, no reconcile, libraries not locked, local refused), and a new
  `SyncCollectionsTask.test.ts` (queues each remote source with a collection scanner, scans nothing itself).
- **Upstream:** not sent.

### A scan A/B bench, and a latency probe for a running server (2026-10-14)

- **Why:** to show that scans in a worker thread stop stalling the main thread, here and on a real server.
- **`pnpm bench:scan-worker`** (`scripts/scan-worker-ab.ts`):
  - **What it runs:** a fresh migrated database per run, a local movie source over 1,500 hard-linked clips, and the
    initial scan, with `TUNARR_SCAN_IN_WORKER` off and on. The arms alternate (A B, then B A), and both use the same
    worker pool.
  - **What it measures:**
    - an HTTP probe every 10 ms, timed from when each probe was due;
    - **main-thread CPU:** the CPU time the scan adds to the server's main thread (`ps -M` on macOS, `/proc` on
      Linux), which a busy machine doesn't distort;
    - **write-lock wait:** a second connection, in its own thread, times `BEGIN IMMEDIATE` every 50 ms, as a main-thread
      write (play history at a program start) would wait on the scan's transaction;
    - the bench's own event-loop lag, to tell a busy machine from a stalled server.
  - **Pass:** the worker arm adds at most 10% of the in-process arm's main-thread CPU, and the write wait's p99 stays
    under 25 ms. Worst cases (probe stall, longest write wait) must stay under 100 ms, judged only when the bench's
    own loop kept up.
  - **Result** on a loaded laptop (1,500 clips, 2 trials, medians):
    - main-thread CPU for the scan: 11.5 s in-process, 0.0 s in the worker;
    - write-lock wait p99: 6.3 ms in-process, 6.6 ms in the worker;
    - worst cases were not judged, because the bench's own loop lagged up to 166 ms.
- **`scripts/probe-latency.mjs`**: plain Node with no dependencies, for a running server.
  - Probes `/api/xmltv-last-refresh` on a cadence and can read a channel's `.ts` the way an HDHomeRun client does,
    timing the gaps between chunks and noting if the stream ends.
  - Basic auth comes from `TUNARR_BASIC_AUTH_USER`/`PASSWORD`, read from the environment or from `--auth-env FILE`, so
    credentials never appear in the process list.
  - **First use, on the in-process build:** a forced 91 s Plex movie-library scan stalled the API for up to 3.4 s (53
    probes over 250 ms, against 1 in the two minutes before). The `.ts` stream's longest gap was 3.5 s, against
    about 2 s, one segment, at idle.
- **Upstream:** not sent.

### The worker smoke test runs a real scan in a scan worker (2026-10-14)

- **Why:** the unit tests drive the scan worker over a `MessageChannel`, but only a real server shows that a scan
  worker boots, scans and reports back. `scripts/worker-smoke-test.ts` already starts the real entry point for the
  worker pool.
- **Change:**
  - **Scan checks:**
    - generates one short clip with ffmpeg, hard-links it into 12 movie folders, points the FFmpeg paths at this
      machine's ffmpeg and ffprobe, and creates a local movie source;
    - checks that its scan runs in a scan worker, with the scanner's log lines marked `"worker":true`;
    - checks that all 12 programs are saved and progress ends as `not_scanning` on the main thread.
  - **SIGTERM:** a forced rescan is started and SIGTERM is sent once it is scanning in its worker. The server must
    exit within 10 s.
  - **`--binary` works through pnpm:** `pnpm test:worker-smoke -- --binary …` forwards the `--`, and `parseArgs`
    read every flag after it as a positional. The binary flag was dropped silently and the dev server was tested
    instead. The leading `--` is now removed, and an unknown flag is an error.
  - **Loopback only:** the test server binds to 127.0.0.1, since it mounts the debug endpoints.
- **Upstream:** not sent.

### Library scans run in a worker thread, so live streams don't stall (2026-10-14)

- **What you saw:** live streams paused while a library scanned. A music rescan stalled the server for up to 3.6 s at a
  time.
- **Cause:** better-sqlite3 is synchronous, and scans ran on the main thread. That thread also serves HLS segments,
  playlists and the HDHomeRun `.ts` stream that Plex reads, so every scan query and write blocked streaming.
- **Fix:** `WorkerScanJobRunner` (`services/scanner/`) runs each scan job in a fresh worker thread with its own
  database connection. The coordinator stays on the main thread and keeps the queue, locks, progress and the
  duration reconcile after each job.
  - **One worker per job:** each job gets current settings and media source credentials, and no memory is held
    between scans. When the job ends, the worker is asked to exit and is terminated if it hasn't within 5 s.
  - **Progress:** the worker's progress messages are applied to the main thread's `MediaSourceProgressService`, so
    the UI is unchanged.
  - **Start-up:** a worker has 60 s to report it started (180 s in dev, where tsx compiles the server first). If it
    doesn't, the job runs on the main thread as before. After 3 failed starts in a row, scans stay on the main thread
    until restart.
  - **Cancel:** the worker gets a `cancel` and is terminated if the job hasn't stopped within 30 s. A job canceled
    while its worker is starting never runs. Terminating a worker mid-transaction rolls the transaction back and
    frees the write lock.
  - **Crash:** a worker that dies mid-job fails that job without running it again; the next scan starts a new worker.
  - **Shutdown:** `MediaSourceScanCoordinator.shutdown(graceMs)` cancels every job and skips the reconcile. `Server`
    gives the running scan 2 s, then its worker is terminated. A worker still starting is terminated at once (found by
    the Codex review).
  - **Switch:** `TUNARR_SCAN_IN_WORKER` (default on) needs `TUNARR_USE_WORKER_POOL` (default on). With either off,
    scans run on the main thread as before. `ServicesModule` picks the runner; worker threads always scan in-process.
  - **Docs:** `docs/getting-started/run.md` adds the switch and corrects the pool's defaults (on, at most 8 threads).
- **Tests:**
  - new `WorkerScanJobRunner.test.ts` (fake worker): progress, a fresh worker per job, start-up fallback, the 3-failure
    limit, a crash, a reported failure, cancels honored and ignored, a cancel during start-up, shutdown during a job and
    during start-up, and a worker that won't exit;
  - new `ScanWorkerRoundTrip.test.ts`: the runner and a real `ScanWorker` over a `MessageChannel`;
  - new `workerTerminateReleasesLock.test.ts`: a real worker thread holding a write transaction is terminated, and
    the lock is free and the row gone.
- **Upstream:** not sent.

### A scan worker role and its message protocol (2026-10-14)

- **Why:** groundwork for running library scans in a worker thread, so they stop stalling live streams. Nothing uses
  it yet; the entry above switches scans over.
- **Change:**
  - **Protocol** (`types/worker_schemas.ts`):
    - `WorkerRole` (`pool` or `scan`);
    - main to worker: `ScanWorkerRequest` (`scan`, `cancel`, `shutdown`);
    - worker to main: `ScanWorkerMessage` (`started`, `scan-progress`, `scan-done`, `scan-failed`).
  - **Starting a worker:** `TunarrSubprocessService.createWorker(opts, role)` passes the role in `workerData` and
    guards a missing entry script instead of using `process.argv[1]!`. `start-worker` starts a `ScanWorker` for
    `role: 'scan'`, and a pool worker otherwise; workers without a role are pool workers.
  - **`ScanWorker`:**
    - runs one `ScanJob` at a time through `ScanJobExecutor`, on its own database connection;
    - relays its `MediaSourceProgressService` events, sanitised and coalesced to whole percents;
    - aborts the job on `cancel`, refuses a second job while busy, and flushes logs before exiting on `shutdown`.
- **Test:** new `ScanWorker.test.ts`, run over a real `MessageChannel`.
- **Upstream:** not sent.

### Write transactions start IMMEDIATE, so a second writer can't fail them (2026-10-14)

- **Why:** library scans are moving to a worker thread, which has its own SQLite connection. That makes the worker the
  second writer to the same database, alongside the main thread. In WAL mode, a DEFERRED transaction (Drizzle's
  default) that reads and then writes fails at once with `SQLITE_BUSY_SNAPSHOT` if the other connection committed in
  between; the busy timeout doesn't apply. better-sqlite3's busy wait also blocks the thread that waits, and the main
  thread serves the streams.
- **Change:**
  - **Immediate by default:** `withImmediateTransactions` (`db/immediateTransactions.ts`, applied in `DBAccess`)
    makes `drizzle.transaction(fn)` start with BEGIN IMMEDIATE unless the caller passes its own `behavior`. The
    write lock is taken up front, so a read-then-write can't fail that way. Applying it in one place keeps the 31
    call sites unchanged, and new transactions get it too.
  - **Busy timeout:** the main thread's connection keeps 5 s; worker threads get 30 s, since they can afford to wait.
  - **Checkpoint:** `ProgramStateRepository.checkpointAndOptimize` runs the TRUNCATE checkpoint with
    `busy_timeout = 0` and restores the timeout afterwards. While another connection holds a transaction, the
    checkpoint just reports busy instead of blocking the main thread for 5 s.
- **Test:** new `sqliteWriteContention.test.ts`, on a pre-migrated database with a second raw connection standing in
  for a worker:
  - a deferred read-then-write fails after another connection commits;
  - Tunarr's transactions hold the write lock before their first write;
  - an explicit `behavior` still applies;
  - the checkpoint returns in under a second while another connection holds a snapshot, and the busy timeout is
    restored.
  - The second and fourth fail on the old code.
- **Upstream:** not sent.

### Scan jobs go through a runner, and re-check the library when they start (2026-10-14)

- **Why:** this prepares for running scans in a worker thread, so the coordinator can hand a job to whichever runner
  is configured. It also fixes a latent problem: a queued job checked whether its library was available only when it
  was queued. A job that waited hours behind others could then scan a library the server no longer reports, which
  marks every program in it missing.
- **Change:**
  - **The job:** `ScanJob` (`types/worker_schemas.ts`, zod) describes a scan by IDs and flags only. A local job is
    `{kind: 'local', mediaSourceId, force, pathFilter?}`; a remote one is `{kind: 'library', libraryId, …}`.
  - **The executor:** `ScanJobExecutor` re-reads the library or media source when the job starts. It skips the job
    if the library is gone or unavailable, wires the abort signal to `scanner.cancel`, and runs the library scan,
    then the collection scan (not after a cancel).
  - **The runner:** `ScanJobRunner` (bound at `KEYS.ScanJobRunner`) runs one job. `InProcessScanJobRunner` runs it on
    the calling thread, as before.
  - **The coordinator:** `MediaSourceScanCoordinator` still refuses unsupported libraries up front and keeps the
    queue, locks and progress. It doesn't reconcile durations after a skipped job.
  - **`awaitAllFinished`:** now also waits for each job's cleanup, not just for the queue to go idle.
- **Tests:** new `ScanJobExecutor.test.ts`; `MediaSourceScanCoordinator.test.ts` now uses a fake runner.
- **Upstream:** not sent.

### A failed or canceled scan no longer leaves its library locked or "scanning" (2026-10-14)

- **What you saw:** nothing obvious yet; found while planning to move scans into a worker thread.
  `MediaSourceScanCoordinator` had several ways to leave a library stuck:
  - **Lock leaks:** if no scanner could be created, the library's lock stayed taken until restart, because the early
    return came after `lock.acquire()`.
  - **Stuck progress:** a scan that threw, or was canceled, stayed "in progress" in the UI, because only a scanner
    that finishes normally calls `scanEnded`.
  - **Cancel ignored:** a job canceled while still queued ran anyway, because the abort listener was added only once
    it started.
  - **Wasted work:** a canceled library scan was still followed by a full collection scan.
  - **Shutdown:** `awaitAllFinished` waited only for the queue to empty, not for the running scan.
- **Fix:** both `add` and `addLocal` now go through one `enqueue` helper.
  - **Order:** the scanner is created before the lock is taken.
  - **Cleanup:** whatever happens to the job, the lock is released, the abort controller is dropped, and progress
    ends.
  - **Cancel:** a job canceled before it starts doesn't run, and the collection scan is skipped after a cancel.
  - **Reconcile:** duration reconciliation runs only after a job that actually ran.
  - **Shutdown:** `awaitAllFinished` uses `onIdle`.
  - **Tidy-ups:** the queue and controllers are instance fields (the coordinator is a singleton), and a local source
    without a media type is refused instead of hitting `mediaType!`.
- **Test:** new `MediaSourceScanCoordinator.test.ts`; 6 of its 7 cases fail on the old code.
- **Upstream:** not sent.

### Movie scans pick up subtitle files added later (2026-10-14)

- **What you saw:** a movie got no captions although Bazarr had added an `.srt` the day before (Plex listed the
  sidecar, Tunarr still knew only the embedded PGS track after the nightly scan).
- **Cause:**
  - **Wrong comparison:** `MediaSourceMovieLibraryScanner.scanSingleInternal` decided "unchanged" by comparing the
    stored canonical id with the **library listing's**. The episode and other-video scanners compare the full
    metadata's.
  - **No streams in the hash:** the Plex movie hash (`canonicalizePlexMovie`) ignored streams, and Plex's listing
    has none anyway (`Part` without `Stream`).
  - **Plex doesn't mark the change:** adding a sidecar doesn't move the movie's `updatedAt` (03:10 before the `.srt`
    at 05:49, checked).
  - **Result:** the movie was skipped every night. Episodes weren't affected: their hash includes stream ids,
    compared on the full metadata.
- **Fix:**
  - **Hash:** `canonicalizePlexMovie` hashes stream ids, like episodes.
  - **Comparison:** the movie scanner compares `fullMovie.canonicalId`, which was already fetched before the check,
    so it costs no extra request.
  - **One-time rescan:** the first scan after this change re-saves every movie once, because their stored ids
    change.
- **Tests:**
  - `PlexMediaCanonicalizers.test.ts`: a stream id change, and a sidecar subtitle stream added.
  - New `MediaSourceMovieLibraryScanner.test.ts`: a rescan when only the full metadata changed, a skip when it's
    unchanged, and a forced rescan. Three of these four fail on the old code.
- **Upstream:** not sent.

### Closed captions are labelled with their language in the stream Plex reads (2026-10-14)

- **What you saw:** Plex Live TV listed the captions as "Unknown (Closed Captioned)".
- **Cause:** the captioned HLS segments name the language in their PMT, but the HDHomeRun `.ts` stream is ffmpeg's
  `-c copy` remux of those segments (`ConcatStream`, `hls_concat`). ffmpeg writes a PMT of its own and keeps none of
  the segments' descriptors, so the stream Plex reads had no language on its video, where the captions live. Checked
  on the live stream: no descriptors on the video entry.
- **Fix:**
  - **Stream:** `CaptionLanguageStream` (`server/src/stream/captions/`) relabels every PMT in ffmpeg's output on its
    way to viewers. `ConcatStream.outputSink()` supplies it when captions are on, `ConcatSession` hands it to the
    transcode session (`DirectStreamSession.outputSink()`), and `StreamModule` passes the first preferred language.
    Every other byte passes through unchanged; if the stream ever lost TS sync, the rest would pass through
    untouched.
  - **Labels:** `withLanguageDescriptors` (`MpegTsCaptionInserter.ts`) adds an ISO 639 language descriptor to the
    video entry, which ffmpeg-based readers such as Plex's take as the video's language, next to the ATSC caption
    service descriptor, which they ignore. The segment inserter uses the same function, so the segments carry both
    too.
- **Checked:** with Plex's own transcoder on a stream sample from the server, the video read as `(eng)` only with
  the ISO 639 descriptor; the caption service descriptor alone changed nothing. A local server's `.ts` stream (HLS
  channel, captions on) read as English video, with both descriptors in all 157 PMTs and caption data intact.
  Tests: `CaptionLanguageStream.test.ts` (chunk sizes from 1 byte, idempotent, lost sync), the PMT test in
  `MpegTsCaptionInserter.test.ts`, and `CaptionInsertion.local.test.ts` (ffmpeg's remux drops the language,
  the stream puts it back).
- **Confirmed in Plex (2026-10-14, `oliviacpu-2026.10.14`):** on the Apple TV, the CC menu lists the captions as
  English, as does the audio menu.
- **Upstream:** not sent.

### Gaps in the guide show the channel's offline picture (2026-10-13)

- **What you saw:** gaps between programmes (flex, such as "<channel> · back soon") were blank tiles in Plex's "Shows
  On Now" and guide, while programmes had posters.
- **Cause:** `XmlTvWriter.makeXmlTvProgram` only wrote an `<icon>` for real programmes.
- **Fix:** a flex programme gets the channel's guide picture for gaps (new optional `offline.guidePicture`,
  **Guide Picture for Gaps** in the channel's Flex settings), else its offline picture when the offline mode is a
  picture (what airs during the gap), else the channel's logo or Tunarr's default logo. Plex keeps one picture per
  guide entry (`thumb`; `art` stays empty for XMLTV) and crops it to both tall and wide tiles. The guide picture is
  there so a square tile can carry a wide card whole. A picture stored as a path
  (`/images/...`) gets the guide address. (`XmlTvWriter.flexIconUrl`; the writer now passes the channel through.)
  Test: `XmlTvWriter.test.ts` (gaps in the guide).
- **Upstream:** not sent.

### Guide pictures can use a public address (2026-10-13)

- **What you saw:** in Plex's apps, programmes in the guide and "Shows On Now" showed plain titles with no posters.
  A channel logo left at Tunarr's default was missing too.
- **Cause:** `/api/xmltv.xml` fills `{{host}}` with the address it was requested on. Plex fetches the guide from
  `http://127.0.0.1:<port>`, so every picture link pointed at 127.0.0.1. Plex's apps load guide pictures themselves,
  so on a phone or TV that address is the device itself.
- **Fix:**
  - **Setting:** an XMLTV setting, **Public Address for Guide Pictures** (`xmlTvSettings.publicUrl`), in Settings →
    XMLTV. When set, `{{host}}` becomes it (`xmlTvLinkHost` in `XmlTvWriter.ts`); empty keeps the old behaviour.
    `/channels.m3u` already had a `hostOverride` for the same reason.
  - **Docs:** `docs/configure/clients/plex.md` notes that the picture paths must be reachable at that address without
    a login.
  - **Safe to expose:** artwork that needs a media-server credential is always proxied, never redirected
    (`ArtworkService.serveArtwork`), so exposing the picture paths doesn't expose the credential.
- **Test:** `XmlTvWriter.test.ts` (`xmlTvLinkHost`).
- **Upstream:** not sent.

### The search server requires a key (2026-10-13)

- **What you saw:** Tunarr's bundled Meilisearch listened on `localhost:<port>` with no key. Anything that could
  reach localhost could read and change the search index. That includes other users of a shared machine, and other
  containers when Tunarr runs on the host network.
- **Cause:** `MeilisearchService.start` launched Meilisearch without a master key, and `client()` connected without
  one.
- **Fix:**
  - **Key file:** on first start the main thread writes a random 32-byte key to `meilisearch-master-key` in the data
    directory, readable only by its owner (mode `0600`).
  - **Meilisearch:** gets the key through `MEILI_MASTER_KEY` in its environment, not its arguments, so the key
    never shows in a process listing. Every request then needs it.
  - **Clients:** the client and worker threads read the same file.
  - **Existing installs:** an existing index keeps working; Meilisearch only enforces the key on requests.
- **Test:** `MeilisearchService.local.test.ts` runs the real binary. A request without the key gets 401, a wrong
  key 403, Tunarr's client works, and a restart reuses the key.
- **Upstream:** not sent.

### Closed captions keep italics, underline and top placement, with a choice of alignment (2026-10-13)

- **What you saw:** captions dropped the subtitle file's italics (off-screen voices, narration, songs) and its
  top-of-screen placement, and every caption was block-centred at the bottom.
- **Cause:** `layoutCaption` in `server/src/stream/captions/Cea608Encoder.ts` stripped every tag, and `loadSequence`
  always used rows 14–15 with one shared indent.
- **Fix:**
  - **Styles:** cues are parsed into styled characters. `<i>`, `<u>`, ASS `{\i1}`, `{\u1}` and `{\r}` become 608
    mid-row codes. A change at a space takes the space's column; one inside a word takes its own. Punctuation right
    after a styled word keeps its style, so `<i>Hello</i>,` opens no gap. Width counts the codes when wrapping.
  - **Placement:** `{\an7}`–`{\an9}` (or SSA `{\a5}`–`{\a7}`) put the whole cue on rows 1–2. Every part of a long top
    cue stays at the top.
  - **Alignment:** a new FFmpeg setting, **Caption Alignment** (`hdhrCaptionAlignment`): centred block (the default,
    unchanged), each line centred (preamble indent plus Tab Offset 1–3 for exact columns), or left.
  - **Plumbing:** `HlsSession.addCaptions` reads the alignment per program, so a change applies from the next
    program.
- **What the player decides:** text size, font and background have no 608 codes Plex honours. For Plex Live TV on
  Apple TV, Plex burns the captions in: it decodes the 608 itself (`inlineass=…:atsc_cc=1`) and draws them in its own
  style, an opaque near-black box with Noto Sans text. The text size follows the Plex app's subtitle size setting
  (`font_size`, `font_scale`).
- **Background codes tried and removed:** an experimental `hdhrCaptionBackground` setting sent 608's optional
  background attributes: semi-transparent black (`0x10 0x2f`) and transparent (`0x17 0x2d`), each after a space at a
  line's start. On 2026-10-13 both were confirmed in the stream Plex read, and the Apple TV's box stayed solid
  black. ffmpeg's 608 decoder, which Plex's burn-in shares a lineage with, maps background attributes only to the
  box colour and ignores transparent. So the setting and the codes were taken out again.
- **Checked:** with ffmpeg's own 608 decoder (jellyfin-ffmpeg 8.1.3), which Plex's burn-in shares a lineage with,
  italics and underline come out as `{\i1}`/`{\u1}`. The top cue comes out at the top (`\pos(…,28)` against 228/243
  at the bottom), and each centred line gets its own leading spaces. Tests:
  `Cea608Encoder.test.ts` (with a small decoder for rows, columns and styles), `CaptionInsertion.local.test.ts`
  (the ffmpeg round trip), `ProgramCaptions.test.ts`.
- **Upstream:** not sent.

### Music rescans only save tracks that changed, and mark removed tracks missing (2026-10-13)

- **What you saw:** every rescan of a music library took as long as the first scan (about 45 minutes for 7,000 Plex
  tracks), and a track removed from an album on the media server stayed listed as available in Tunarr.
- **Cause:** `MediaSourceMusicArtistScanner.scanTracks` looked up the library's existing programs with
  `ProgramType.Episode`. A music library has none, so no track was ever recognised: each one was saved and
  re-indexed in search on every scan, and none were found missing. Using `ProgramType.Track` alone would have been
  worse: the lookup covered the whole library while the missing check runs per album, so every other album's tracks
  would have been marked missing.
- **Fix:** the lookup asks for this album's tracks only (`ProgramType.Track`, scoped to the album, as the TV scanner
  does for seasons). An unchanged track is skipped, and a track the album no longer lists is marked missing. The
  lookup now also returns each program's `state`. A missing track that comes back unchanged is saved again, which
  returns it to `ok`; previously the save on every scan did that. Applies to Plex, Jellyfin and Emby. Tests:
  `MediaSourceMusicArtistScanner.test.ts` (a rescan only saves tracks that changed; a track Plex no longer lists is
  marked missing, and recovers when it returns).
- **Still fetched:** each track's full metadata is still requested (about 50 ms per track from Plex), because the
  stored content hash includes stream IDs that only the full metadata has. Skipping that needs a hash of the listing.
- **Upstream:** not sent.

### Plex music scans import EPs and singles (2026-10-13)

- **What you saw:** after a full Plex music scan, many releases were missing from Tunarr. In one library, 187 of 797
  releases (459 of 7,314 tracks) never arrived. Artists with only EPs and singles were imported with no albums at all.
- **Cause:** `PlexApiClient.getArtistAlbums` listed `/library/metadata/<artist>/children`. Plex returns only full
  albums there and leaves out EPs, singles and other release types. Neither `excludeAllLeaves=0` nor `includeAll=1`
  brings them back.
- **Fix:** `getArtistAlbums` takes the library section key and lists
  `/library/sections/<section>/all?type=9&artist.id=<artist>`, which returns every release by that album artist.
  `PlexMediaSourceMusicScanner.getAlbums` passes `context.library.externalKey`. Without a section key it keeps the
  old listing. Test: `PlexApiClient.test.ts` (`getArtistAlbums` lists EPs and singles through the library section).
- **Checked** against a real Plex server: the section listing returned all 5 of Foodman's releases (the children
  listing returned 0), and 7 for Air (the children listing missed the EP _Casanova 70_). Its `totalSize` matches, so
  paging is unchanged.
- **After upgrading:** run a scan of the music library. Scans walk every artist's releases, so the missing ones are
  added.
- **Media picker:** the web app picks music from Tunarr's own database, so EPs and singles appear there after the
  scan. The live Plex browse routes (`/api/plex/:id/search` with a parent, `/api/plex/:id/items/:id/children`) still
  use the children listing, but the web app no longer calls them.
- **Upstream:** not sent.

### On/off subtitles in Plex Live TV: closed captions in the HDHomeRun stream (2026-10-13)

- **What you saw:**
  - Plex Live TV viewers couldn't turn subtitles on or off. Tunarr burned them into the picture, and Plex's CC button
    had nothing to show.
  - Turning on the WebVTT sidecar feature made it worse: Plex got no subtitles at all.
- **Cause:**
  - Plex reads a channel as an HDHomeRun, through one MPEG-TS stream (the `.ts` URL, a copy of the channel's HLS
    session). MPEG-TS can't carry a text subtitle track. The only switchable subtitles Plex Live TV offers are CEA-608
    closed captions inside the video.
  - ffmpeg can only read 608 captions, not create them. There is no encoder, filter or bitstream filter for it (checked
    in jellyfin-ffmpeg 8.1.3 and ffmpeg 9.0.2).
- **Fix:** a global FFmpeg setting, **Closed captions for HDHomeRun clients (Plex)** (`hdhrClosedCaptions`, off by
  default), under Settings > FFmpeg > Audio & Subtitle Options.

  - **Captions** (`Cea608Encoder.ts`): cues become one 608 byte pair per frame, in pop-on mode. Each caption loads
    ahead of time and appears with End of Caption on its start frame.
    - **Layout:** the bottom rows, block-centred (every line starts at the same column), 32 columns, with special and
      extended characters.
    - **Long cues:** a cue whose lines are wider than 32 columns is rewrapped as a whole. Only a cue that still needs
      more than two lines is shown as several captions, each for a share of its time in proportion to its text.
    - **Speed:** control codes are sent once, not twice as broadcasters do to survive transmission errors. The stream
      is never damaged in transit, and the second copy delayed captions in fast dialogue.
    - **Padding:** every other frame gets null padding, so players always find the track.
  - **Into the stream** (`MpegTsCaptionInserter.ts`): an ATSC A/53 caption SEI goes before the first slice of every
    H.264 frame of a TS segment. The video PES is re-split into packets, keeping PCR, PTS and continuity counters. The
    PMT gets a caption service descriptor naming the language.
  - **Which subtitles** (`FfmpegStreamFactory`, `ProgramCaptions.ts`, HLS channels with subtitles enabled):
    - When the profile picks full text subtitles, they become captions. They're sent as WebVTT (the sidecar path)
      instead of burned in, so Tunarr's own players keep them.
    - Forced and image-based subtitles stay burned in.
    - Otherwise the full text track in the preferred language (regular before SDH) becomes the captions. One example is
      English audio whose forced subtitles are burned in.
    - An embedded track is read from its extracted copy in the subtitle cache, as burn-in does
      (`SubtitleStreamPicker.getSubtitleDetailsWithExtractedPath`). Embedded tracks have no path of their own, and
      the first version only looked at tracks with one, so only sidecar files became captions.
    - Cues come from the SRT, WebVTT or ASS file on disk, moved onto the program's clock (minus the seek).
    - If they can't be read, the subtitles are burned in as before.
  - **Timing** (`HlsSession`): each program's captions are laid out at the session's `ptsOffset` (the video's
    `-output_ts_offset`). This handles the 33-bit timestamp wrap and uses the exact frame rate (`24000/1001`, not
    23.976).
    - A segment whose frames are spaced more than 1% away from the schedule gets padding only, rather than garbled
      text. Deinterlacing that doubles the rate is one cause.
  - **Continuity:** each captioned segment ends on its original continuity counter. The last frame gets up to 15
    extra packets, keeping the video packet count the same modulo 16, so the next segment continues without a jump.
    Without this, Tunarr's `.ts` wrapper (`-fflags +discardcorrupt`) dropped the frame at every segment join, and the
    frames that depend on it decoded with errors. This was found on the deployment's test copy: 8 of 17 two-second
    pieces of a capture had errors with captions on, 0 of 13 with them off.
  - **Serving:** only the `.ts` stream gets captions. Its reader asks for the playlist with `captions=1`, and those
    segment links are served through the inserter. Any failure serves the segment as it is.

  Tests:

  - `Cea608Encoder.test.ts`: timing, parity, layout, repeated characters.
  - `MpegTsCaptionInserter.test.ts`: SEI placement, packets, counters, PCR, PMT CRC, refusals.
  - `ProgramCaptions.test.ts`: parsers, NTSC rates, track choice, playlist marking.
  - `FfmpegStreamFactory.test.ts`: burn vs captions, forced, fallback, setting off, non-HLS.
  - `HlsSession.test.ts`: frame placement, PTS wrap, rate mismatch, unreadable segment.
  - `CaptionInsertion.local.test.ts`: a real libx264 round trip through ffmpeg's 608 decoder.

  Docs: `docs/configure/ffmpeg/index.md` ("Closed Captions for HDHomeRun Clients").

- **Checked** on a throwaway server: a clip with embedded English subtitles, extracted, channel subtitles on.
  - **The `.ts` URL** Plex uses carried caption data on 603 of 603 frames. ffmpeg decoded the subtitles from it, each
    1.5 s long and 2 s apart, as in the source.
  - **Timing:** in a served segment, the frames showing each caption were within 14 ms (half a frame) of the WebVTT cues
    that the same encode wrote.
  - **Decoding:** after the continuity fix, 0 of 14 two-second pieces of a 30 s `.ts` capture had decode errors.
  - **Not yet checked on the Apple TV:** CC toggling, the label from the caption service descriptor, and whether Plex
    turns captions on by itself for foreign-audio programs.
- **Known limits:**
  - The `mpegts` stream mode and hls_direct modes get no captions; hls_direct copies the source's video, often HEVC.
  - Captions use the player's own style. Non-Latin text is dropped.
  - Two cues closer together than a caption's load time show late: two full lines are 64 characters at 2 per frame,
    plus 4 commands, so 36 frames (1.5 s at 23.976 fps).
  - Captions keep the subtitle file's timing. A sidecar timed for another release of the episode is just as far off
    as in any other player. Tools like Bazarr's subtitle sync fix the file.
- **Upstream:** not sent.

### Changing the FFmpeg path applies without a restart (2026-10-13)

- **What you saw:** after changing the FFmpeg executable path, Tunarr kept probing the old path until it restarted. A
  symlink had to stay at the old path so that nothing broke in the meantime.
- **Cause:** `FfmpegInfo` received both paths once, in its constructor (`KEYS.FFmpegPath`, `KEYS.FFprobePath`).
  Long-lived holders keep one instance:

  - the pipeline builder factory, an Inversify factory binding created once, whose `FfmpegInfo` supplies the encoders,
    filters and options every stream's command is built from;
  - `TroubleshootService`, a singleton;
  - ffprobe for stream details, and the health checks.

  The ffmpeg processes themselves run the current path (`FfmpegProcess`), so commands were built from the old binary's
  capabilities and then run on the new binary.

- **Fix:** `FfmpegInfo` takes the settings DB and reads both paths on every call. Its probe caches are already keyed
  by path, so a new path is probed fresh. The two path bindings and keys are gone.
- **Why it matters now:** the image has two ffmpegs (jellyfin-ffmpeg at `/usr/bin`, ErsatzTV 7.1.1 at
  `/usr/local/bin`). Before this fix, switching to 7.1.1 without a restart kept the stale "has `tonemapx`" capability,
  so HDR programs would have been sent a filter 7.1.1 doesn't have.
- **Checked:**
  - Test: `ffmpegInfo.test.ts` switches one `FfmpegInfo` between two stand-in ffmpeg scripts; version and filters follow.
  - On a throwaway server, with one HDR10 program, no restart: jellyfin-ffmpeg → `tonemapx`; Homebrew ffmpeg (no
    `tonemapx`) → the zscale chain; back to jellyfin → `tonemapx` again.
- **Known limit:** probe results are cached per path for an hour. Replacing the binary behind the same path, for
  example by editing a wrapper script to call another ffmpeg, still shows the old capabilities for up to an hour.
- **Upstream:** not sent.

### Faster tune-in: HLS segment length, segments before playback, and a start-up burst (2026-10-13)

- **What you saw:** a cold channel took 5–10 s to send its first byte to Plex's tuner. It was sped up outside Tunarr by
  rewriting ffmpeg's arguments to 2 s segments and a read-ahead burst.
- **Cause:** Tunarr hard-codes 4 s HLS segments (`HlsOutputFormat.SegmentSeconds`, `hlsTime: 4`). It serves a channel's
  playlist only once 2 segments exist (`initialSegmentCount: 2` in `SessionManager`), so 8 s of video must be encoded
  first. The `.ts` stream HDHomeRun clients read (`hlsWrap`, a copy of the HLS playlist) then reads at `-readrate 1` from
  the first byte.
- **Fix:** three global FFmpeg settings, under Settings > FFmpeg > Global Options. Each is read when a channel's session
  starts.

  - `hlsSegmentSeconds` (default 4, 1–10) reaches `HlsSession` (hls mode only) as `segmentSeconds`. `HlsOutputFormat`
    then writes it as `-hls_time`, with `-g`, `-keyint_min` and `-force_key_frames` scaled to match. The playlist's
    target duration follows. hls_direct_v2 keeps 4 s, because its copied video can only be cut at the source's keyframes.
  - `hlsInitialSegmentCount` (default 2, 1–10) replaces the hard-coded 2 for hls and hls_slower sessions.
  - `hlsTsInitialBurstSeconds` (default 0, 0–60) becomes `-readrate_initial_burst N` on the `hlsWrap` reader, through
    `FfmpegState.readrateInitialBurstSeconds`.

  The defaults keep the old behavior. `defaultHlsOptions.hlsTime` changed from an unused 2 to 4 so it matches the
  sessions. Files: `HlsOutputFormat.ts`, `BasePipelineBuilder.ts`, `HlsSession.ts`, `SessionManager.ts`,
  `FfmpegStreamFactory.ts`, `FfmpegState.ts`, the FFmpeg settings schema and page. Tests: `HlsOutputFormat.test.ts`,
  `BasePipelineBuilder.test.ts`, `HlsSession.test.ts`. Docs: `docs/configure/ffmpeg/index.md` ("HLS Start-up").

- **Checked** on a throwaway server (stream-repro, jellyfin-ffmpeg 8.1.3). The encoder was slowed to about real time
  (1 thread, `medium`) to resemble the deployment. Over 3 cold starts each, the HDHomeRun `.ts` URL's first byte went
  from 7.1–8.1 s (defaults) to 4.1 s (2 s segments, 10 s burst), and the 3 s after it carried 1.87 MB instead of
  1.19 MB. The playlist read `#EXT-X-TARGETDURATION:2` with 2.000 s segments. To match the old wrapper, set segment length
  2 and burst 10.
- **Upstream:** not sent.

### The image ships jellyfin-ffmpeg 8.1.3-1 as its ffmpeg (2026-10-13)

- **What you saw:** the image's only ffmpeg was ErsatzTV's 7.1.1, which has no `tonemapx`. The faster tone mapping ran
  only through a hand-installed jellyfin-ffmpeg and a wrapper script that rewrote Tunarr's command.
- **Cause:** upstream's image builds on `ghcr.io/ersatztv/ersatztv-ffmpeg` and links its ffmpeg into `/usr/bin`.
- **Fix:** a `jellyfin-ffmpeg` build stage downloads the static `portable_linux64-gpl` release, checks its sha256, and
  `ffmpeg-base` copies its `ffmpeg` and `ffprobe` to `/usr/bin` in place of the symlinks. The build fails unless that
  ffmpeg runs and lists `tonemapx`. Tunarr's default paths already point at `/usr/bin`, so it then picks `tonemapx` by
  itself (previous entry).
  - **Checked:** in a local linux/amd64 build of `ffmpeg-base`, `/usr/bin/ffmpeg` reports `8.1.3-Jellyfin` (binary
    sha256 `79a8d05b…`) and has libx264, libx265, ac3, aac, `tonemapx`, `zscale`, `sidedata`, `loudnorm` and `afade`.
  - **Not checked:** hardware acceleration (VAAPI, QSV, NVENC) through the static build. The fork's deployment is
    software-only.
- **Upstream:** fork-only; upstream chose the ErsatzTV build.

### Software tone mapping uses `tonemapx`, with a choice of curve (2026-10-13)

- **What you saw:** HDR tone mapping on the software pipeline was slow, and its look was fixed to Hable. Using
  jellyfin-ffmpeg's much faster `tonemapx`, or trying the BT.2390 curve, meant rewriting ffmpeg's command line outside
  Tunarr.
- **Cause:** `SoftwarePipelineBuilder.setTonemap` always used `TonemapFilter` (`zscale` to linear float RGB, then
  ffmpeg's plain-C `tonemap=tonemap=hable`), and nothing chose the curve.
- **Fix:**

  - A global FFmpeg setting, `tonemapAlgorithm` (`hable` default, `bt2390`, `mobius`, `reinhard`), shown as **HDR
    Tone-map Curve** under Settings > FFmpeg > Global Options. It reaches the builder through `FfmpegState`, like the
    scaling algorithm, and takes effect from the next program.
  - When ffmpeg has the `tonemapx` filter (`KnownFfmpegFilters.Tonemapx`, found by the usual filter probe), `setTonemap`
    uses the new `TonemapxFilter`: `tonemapx=tonemap=<curve>:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p`,
    with `hwdownload` first for hardware frames. It reads the peak from the frame's HDR10 metadata, applies Dolby
    Vision RPUs, and drops the HDR10 side data itself. Dolby Vision with no transfer is tagged PQ with `setparams`
    first, as the zscale chain does with `tin=`.
  - Without `tonemapx`, the zscale chain stays, with the chosen curve; `bt2390`, which ffmpeg's `tonemap` lacks,
    becomes `hable`.
  - The VAAPI builder's software fallback goes through the same method.
  - Settings files without the field load as `hable`, so nothing changes until it's set.

  Checked with jellyfin-ffmpeg 8.1.3 on an HDR10 test clip: `tonemapx` output is 8-bit High-profile H.264, bt709,
  without mastering display or light level side data. jellyfin-ffmpeg's version string (`8.1.3-Jellyfin`) parses as
  8.1.3. Tests: `TonemapxFilter.test.ts`, `TonemapFilter.test.ts`, `SoftwarePipelineBuilder.test.ts`,
  `ffmpegInfo.test.ts`. Docs: `docs/configure/ffmpeg/index.md`, `docs/configure/ffmpeg/transcode_config.md`.

- **Upstream:** not sent.

### Tone-mapped HDR10 no longer keeps its HDR metadata (2026-10-13)

- **What you saw:** with HDR tone mapping on, some HDR10 programs never started. ffmpeg exited with code 187 and
  libx264 logged "content light levels out of range". The ones that did play sent an SDR (bt709) picture labeled with
  the source's HDR10 mastering display and light level metadata. This was worked around outside Tunarr by appending
  `sidedata=mode=delete` filters to ffmpeg's command.
- **Cause:** the software tone map (`zscale` + `tonemap`) converts the pixels but leaves the frames' HDR10 side data
  attached. Since ffmpeg 7, libx264 writes that side data into the H.264 stream as SEI, and refuses to open when its
  light levels fall outside 0–65535.
- **Fix:** `TonemapFilter` ends its chain with
  `sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL,sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA`
  (`StripHdr10SideData`). Checked with ffmpeg 8.1: without it the tone-mapped H.264 still carries mastering display and
  content light level side data; with it, neither. Test: `TonemapFilter.test.ts`.
- **Upstream:** not sent.

### Gap music: a channel's music list plays under its offline picture (2026-10-13)

- **What you saw:** during flex gaps a channel showed its offline picture over silence. The channel's
  `offline.soundtrack` setting was stored but never used, and there was no way to use your music library there.
- **Cause:** `FfmpegStreamFactory.createOfflineSession` always used the placeholder audio (anullsrc, sine or noise).
- **Fix:** a channel's offline settings take an optional `musicListId`, a filler list of tracks. It isn't attached to
  the channel as ordinary filler, so its tracks never play as normal programs with album art. When a gap reaches the
  offline picture:

  - `GapMusicPicker` picks a track from the list: never played on this channel first (at random), otherwise the one
    played longest ago (30-day history window).
  - The gap item lasts `min(rest of gap, track length)`, so long gaps play track after track.
  - The play is recorded in program play history with the list's id.
  - The offline session uses the track as its audio, normalized to a TV-like `I=-24 LUFS, LRA=11, TP=-2`
    (`GapMusicLoudnorm`; programs are not normalized). It fades in over 1 s, and out over the last 3 s when the gap cuts
    the track short. The fades go after loudnorm (`AudioState.fades`, `AudioFadeFilter`) so its gain control can't
    undo them.
  - Anything that fails (empty list, unresolvable source, no audio stream) leaves the gap with the old placeholder
    audio, and is logged.

  Files: `StreamProgramCalculator.ts`, `ProgramStream.ts`, `FfmpegStreamFactory.ts`,
  `services/scheduling/GapMusicPicker.ts`, `builder/filter/AudioFadeFilter.ts`, `builder/state/AudioState.ts`, the
  channel offline schemas. Tests: `GapMusicPicker.test.ts`, `StreamProgramCalculator.test.ts`,
  `FfmpegStreamFactory.test.ts`, `BasePipelineBuilder.test.ts`. The channel's list isn't validated on save; a deleted or
  wrong list just gives the silent picture.

- **Where to set it:** the channel's Flex settings, **Gap music**, next to the fallback image (any filler list).
  Documented in `docs/configure/channels/flex.md`.
- **Checked end to end** on a throwaway server (stream-repro, local music library, ffmpeg 9.0.2;
  the deployed image ships 7.1.1, which has the same `loudnorm` and `afade`): three tracks measuring
  -6.2, -22.6 and -47.6 LUFS all came out at -24.0 LUFS. Gap items rotated tracks (never-played first, then the
  oldest), the track cut by the gap's end faded out over its last 3 s, each item faded in over 1 s, and a channel
  without a list still played digital silence.
- **Upstream:** not sent.

### Plex music tracks keep their audio stream (2026-10-13)

- **What you saw:** music tracks imported from a Plex music library couldn't be played; streams failed with "Streams
  with no video" or played nothing.
- **Cause:** `PlexApiClient.plexTrackInjection` called `plexMediaStreamsInject` with its default
  `requireVideoStream = true`. Tracks have no video stream, so the import failed and fell back to an item with no
  streams at all.
- **Fix:** tracks pass `requireVideoStream: false`, so their audio streams are stored. Test: `PlexApiClient.test.ts`
  (`getMusicTrack` keeps an audio-only track's stream).
- **Fixed later:** rescans used to save every track again and never marked removed ones missing. See "Music rescans
  only save tracks that changed" above.
- **Upstream:** not sent.

### "Normalize Frame Rate" works again (2026-10-13)

- **What you saw:** the transcode config's **Normalize Frame Rate** checkbox ("Output video at a constant frame rate")
  did nothing; output kept whatever timing the source had, including variable frame rates.
- **Cause:** when the old ffmpeg pipeline was replaced (#1349), its `fps=<source rate>` filter for this setting wasn't
  carried over. The new calculator only had a commented-out `maxFPS` stub. The builder could already write
  `-r <rate> -fps_mode cfr` when the desired state has a frame rate, but nothing set one.
- **Fix:** with the setting on, `FfmpegPlaybackParamsCalculator` sets the output frame rate to the source's own rate
  (from `24`, `23.976`, `"24000/1001"` or `"25"`, rounded to 3 decimals; nothing for missing or implausible values).
  `HlsOutputFormat` now rounds its keyframe interval to whole frames, since 23.976 x 4 s would otherwise be written as
  `-g 95.904`. Checked with real ffmpeg: a variable-rate input comes out at exactly 24000/1001 with 96-frame segments.
  Off by default, as before. Tests: `FfmpegPlaybackParamsCalculator.test.ts` (its `makeStreamDetails` helper now
  applies its overrides, which it silently ignored), `HlsOutputFormat.test.ts`.
- **Upstream:** not sent.

### Tag the output audio's language (2026-10-13)

- **What you saw:** Tunarr's streams carried no audio language, so Plex logged every program as foreign-language audio
  ("foreign film") and couldn't match audio or subtitle language preferences.
- **Cause:** the stream selector picks the audio track knowing its ISO 639-2 language, but `AudioStream` had no field
  for it and the audio pipeline wrote no stream metadata.
- **Fix:** `AudioStream` carries `language`, `FfmpegStreamFactory` sets it from the selected track's
  `languageCodeISO6392`, and `BasePipelineBuilder.buildAudioPipeline` writes `-metadata:s:a:0 language=<code>`
  (`AudioLanguageOutputOption`) when it's a valid 3-letter code. MPEG-TS turns this into the stream's ISO 639 language
  descriptor, and it survives the `.ts` remux (checked with ffmpeg 7). Test: `BasePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### Pick the software encoder's preset in the transcode config (2026-10-13)

- **What you saw:** software H.264/HEVC always encoded with `-preset veryfast`. Transcode configs have a `videoPreset`
  field, but the settings page didn't show it and the stream code ignored it. Trying a faster preset meant rewriting
  ffmpeg's command line outside Tunarr.
- **Cause:** `FfmpegPlaybackParamsCalculator` hard-coded `VideoPresets.VeryFast` for hardware acceleration "none".
- **Fix:** the calculator uses the transcode config's preset when it's a known libx264/libx265 preset, and keeps
  `veryfast` when it's empty or unknown, so existing configs behave as before. The transcode config page shows a **Video
  Preset** dropdown (ultrafast to medium) under Video Options when Hardware Acceleration is Software and the format is
  H.264 or HEVC. A change takes effect when the next ffmpeg process starts; no restart. Hardware encoders are unchanged.
  Files: `server/src/ffmpeg/FfmpegPlaybackParamsCalculator.ts`, `server/src/ffmpeg/builder/constants.ts`,
  `web/src/components/settings/ffmpeg/TranscodeConfigVideoSettingsForm.tsx`. Tests:
  `FfmpegPlaybackParamsCalculator.test.ts`.
- **Upstream:** not sent.

### The transcode config's thread count now limits the encoder (2026-10-13)

- **What you saw:** setting **Thread count** in a transcode config didn't limit how many threads libx264 used. On a box
  with many cores, or a tight per-user thread limit, each watched channel still started about 1.5x the visible cores
  in encoder threads.
- **Cause:** the value was written only as a global `-threads N` before the inputs, which ffmpeg applies to the first
  input's decoder. `PipelineOptions.encoderThreadCount` was filled in for the main transcode path but never read, and
  the offline, error and `hls_slower` concat sessions didn't pass it at all.
- **Fix:** `Libx264Encoder` takes an optional thread count and writes it as the output option `-threads:v N`;
  `BasePipelineBuilder.setupEncoder` passes `pipelineOptions.encoderThreadCount`, and `FfmpegStreamFactory` now sets it
  for the offline, error and `hls_slower` concat sessions too. The decoder's `-threads` is unchanged. 0 still means
  "let ffmpeg decide". Tests: `Libx264Encoder.test.ts`, `SoftwarePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### 10-bit sources no longer come out as H.264 High 10 (2026-10-13)

- **What you saw:** 10-bit sources (most x265/HEVC files, HDR or not) were transcoded to H.264 **High 10** on the
  software (no GPU) pipeline. Almost no player decodes High 10, so those programs failed or fell back to another
  transcode. It had to be worked around outside Tunarr by adding `-pix_fmt yuv420p` to the ffmpeg command.
- **Cause:** `SoftwarePipelineBuilder.setupVideoFilters` started its frame state from the desired output state without
  the source's pixel format, so it believed frames were already `yuv420p`. `setPixelFormat` then saw no difference and
  never added `-pix_fmt yuv420p`, and libx264 encoded the decoder's `yuv420p10le` frames as High 10. The Nvidia, QSV and
  VAAPI builders already seed the state with `videoStream.pixelFormat`. Tone mapping hid the bug for HDR sources,
  because its filter chain ends in `format=yuv420p`.
- **Fix:** seed the software pipeline's starting state with `videoStream.pixelFormat`, as the hardware builders do
  (`server/src/ffmpeg/builder/pipeline/software/SoftwarePipelineBuilder.ts`). Test:
  `SoftwarePipelineBuilder.test.ts` (a 10-bit source gets `-pix_fmt yuv420p`; an 8-bit source gets no conversion).
- **Upstream:** not sent. Related: upstream PR #1559 (an unconditional `-pix_fmt yuv420p`) was closed on the grounds
  that the pipeline builder already forces 8-bit output; on the software path it didn't.

### Pipeline output rate and text rendering

Pipeline filters expose the frame rate they produce, including deinterlacing, so
FFmpeg output options retain the selected rate. Source probing prefers a valid
average frame rate. x265 pools follow the configured thread limit. Subtitle inputs
and burn-in filters accept an explicit character encoding, while now-playing text
sizes account for picture width and share filter-value escaping.

This follow-up stacks on the subtitle text reliability branch and caption timeline
PR #65. Playback parameters keep their source-based target and caption timing uses
the resolved pipeline rate; broader session integration follows separately.

### Scan queue responsiveness

Custom-show sync requests wait for completion when the queue is idle, and return
once accepted when another job is running. Acceptance and completion use an explicit
job handle; requests joining the same show share its job and retain priority. Scanner
validation warnings run once per library. The duplicate-case artwork test skips
when the filesystem cannot create two distinct files differing only in case. This follow-up depends on scan-worker watchdog PR #63.

### Safer channel switching and less tune-in setup work (2026-10-20)

- **Symptoms:** slow cold tunes and switches that fail without sending bytes.
- **Found in code:** readiness failures could become `started`; stale instance-based teardown could remove a replacement;
  detached viewers left listeners on shared sessions; timing a direct stream with a `data` listener could consume its
  initial bytes before the HTTP response attached. These are verified code paths, not proof of every reported failure.
- **Fix:** preserve readiness errors, replace unusable sessions, bind wrappers to backing-session identities, and scope
  teardown to the current instance. Initial-byte timing now happens in a pass-through. Each HTTP viewer owns its
  listeners, pipe, cancellation, and 20-second first-output deadline; late acquisitions are released after disconnect.
  Output readiness is awaited outside the channel mutex, so the wrapper can make its internal HLS request.
- **Speed:** successful version probes are cached by binary path for an hour and shared while running. Startup seeds
  FFmpeg's version. Existing HLS settings, audio/caption behavior, and the late-audio probe window are preserved.
- **Local A/B:** 100 switches each, six cold starts, ten second-viewer joins: cold median first byte 985 → 666.5 ms,
  overall p95 1,124 → 848 ms; neither run failed. The base accumulated listener warnings; the patch did not.
  These synthetic FFmpeg 9.0.2 measurements do not establish production Plex/Apple TV time to picture.
- **Tests:** version-cache sharing/expiry/failure/path changes; readiness errors and stale teardown; initial bytes,
  cancellation during startup, silent timeout, two viewers, listener cleanup; the real HTTP route. The stream-repro
  skill gained `--tune-ins` for alternating channels, cold resets, and second-viewer checks.
- **Report:** `plans/tune-in-startup-2026-10-20.md`; separate availability investigation under
  `plans/investigations/plex-tuner-availability-2026-10-20.md`. No deployment was changed.
- **Upstream:** not sent.
