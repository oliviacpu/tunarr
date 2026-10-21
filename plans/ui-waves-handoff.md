# UI waves: handoff for whoever continues (2026-10-20)

This is the self-contained resume point for the work planned in
`plans/ui-primitives-and-settings-audit-2026-10-19.md` ("the plan"). It is written so a new Claude
session, Codex, or a person can continue without the previous session's memory. Read the plan's
"Approval gate" paragraph, the row you are about to work on, and this file's "Working rules" before
starting anything.

## Screenshot and docs closeout (2026-10-21)

The [UI gallery](../docs/dev/ui-gallery.md) records the final 19 canonical page states in both
themes at 390px and 1440px, with source and seeded-fixture provenance and a standalone regeneration
command. Matching channel and transcode documentation illustrations are refreshed; the older
external-client and multi-step media-selection tutorials are outside this bounded refresh.

The capture checks exposed two local phone issues, addressed separately: #160 wraps the Trash
filters and keeps Empty Trash/active-job Cancel reachable; #161 separates channel navigation,
options and session-detail controls instead of nesting buttons. Both have old-code regressions.
Their notes are consumed into `FORK.md` here.

Production remains `oliviacpu-2026.10.20.5` from `bdcde70b`, with its verified outcome recorded in
the [release notes](https://github.com/oliviacpu/tunarr/releases/tag/oliviacpu-2026.10.20.5).
The two phone follow-ups are not part of that image. This docs closeout creates no release or
deployment. Apple TV acceptance remains manual and unverified.

Next is the separately approved S5 design in `plans/channel-audio-subtitle-defaults.md`: S5a
compatibility/persistence and channel mode, then S5b effective preference resolution, then S5c
global/channel UI and previews. Use fresh scoped agents and separate reviewed PRs in dependency
order. C7b/C7c batching remains held. The dated snapshots below preserve earlier release boundaries.

## Calendar continuation after the .20.4 deployment (2026-10-20)

The bounded continuation through `2bdc1ed7` is deployed as `oliviacpu-2026.10.20.4`, reporting
`2026.10.3-oliviacpu-2026.10.20.4`. Its candidate and restore CLI rehearsals passed. The existing
Whatbox guard completed its backup and idle checks, and Tunarr became ready in 12 seconds.
Live checks preserved the 81-migration ledger, catalog counts, external-ID hashes, settings
version 2 and all schedule/seed hashes. Authenticated settings/version, web assets, one bounded
HLS segment and Plex guide refresh passed. The exact running image and corrected full OCI
revision label match the release commit. Only the release-owned automatic-update pause was
cleared. The observed outcome is recorded in the
[release notes](https://github.com/oliviacpu/tunarr/releases/tag/oliviacpu-2026.10.20.4)
and [closing PR #153](https://github.com/oliviacpu/tunarr/pull/153#issuecomment-6301559237).
Apple TV acceptance remains unverified.

The separate local calendar findings are addressed by two web-only source PRs, folded into
`FORK.md` here:

- #156: advance repeated-cycle timestamps using the current edited lineup's duration for both
  cycle phase and advancement. This also covers unsaved append/shorten edits whose saved channel
  duration is stale, selects the final item both at and inside its range, and returns no preview for an empty/zero-length current cycle.
- #157: keep week headers and day columns aligned in one bounded native horizontal viewport,
  with a fixed hour axis/divider and header gutter, keyboard scrolling and all seven days reachable.
  Date selection, navigation, zoom and palette behavior remain covered.

The focused regressions pass: twelve hook tests, nine component/palette tests, four timestamp
browser cases including seed, and two layout browser cases including seed. Old-code runs
reproduced repeated timestamps/keys, stale-duration and final-item selection errors, and the 390px-to-1048px page overflow.
No known-issue exclusions were added. The combined branch still requires full CI, exact-head
review and the complete seeded browser suite before landing and release.

This snapshot predates their deployment. They change no server scheduling, API contracts,
migrations or settings version. Follow the existing release-tag, owned automatic-update pause,
fresh private on-host backup, pinned candidate/restore rehearsal and guarded deployment procedure.
Both rehearsal images must preserve the same 81 migrations and settings version 2. Record the
observed deployment outcome in that release's notes and this closing PR afterward.

C7b/C7c batching and S5 implementation remain held. The older continuation snapshots below
predate the `.20.4` deployment; their pending-release statements describe those snapshots.

## Continuation after the .20.3 deployment (2026-10-20)

The work through `0eba0856` is deployed as `oliviacpu-2026.10.20.3`, reporting
`2026.10.3-oliviacpu-2026.10.20.3`. Its isolated migration/restore rehearsals and guarded
Whatbox deployment passed. Live checks confirmed the exact 81-migration ledger, integrity/FK
checks, preserved catalog counts/external-ID hashes, expected settings normalization and preserved
schedules/seeds. Authenticated settings/version reads, web assets, one valid HLS MPEG-TS segment
and Plex guide refresh passed. Apple TV acceptance remains unverified. The actual deployment
record is in the [release notes](https://github.com/oliviacpu/tunarr/releases/tag/oliviacpu-2026.10.20.3).

This closing continuation records the following source PRs in `FORK.md`; they require the next
release and are not included in the deployed `.20.3` image:

- #146: future images label their actual release commit. Existing `.20.3` labels are unchanged.
- #147: outlined Manage Libraries Close and shared equivalent dialog action labels.
- #148: preserve nonempty legacy `{error}` failure reasons in the client.
- #150: minus decreases displayed guide hours; plus increases them, within the existing 1–8 hour limits.
- #151: guide-derived lineup/calendar colours and tabular time/count numerals.
- #152: C7a preserves omitted filler/subtitle relations, clears explicit empty arrays and replaces
  nonempty arrays. Changed editor relations serialize deliberately; creation/update skip empty
  subtitle inserts. Existing start-time/on-demand behavior and the bulk stealth workaround remain.
- #154: use the existing bounded initial-field wait and current Playback breadcrumb in settings tests.
- #155: persist table preferences outside React state updater callbacks while preserving batched updates.

C7a alone was approved in #149. C7b/C7c batching is held. S5 remains approved design only, with
implementation separate; a different dark-yellow palette step remains a separate visual decision.

The first combined browser run passed 164 tests, failed two and skipped one. It exposed the
retired transcode breadcrumb locator fixed by #154 and the table preference render warning fixed
by #155. A separate CI run exposed the initial executable-field wait fixed by #154. These
follow-ups preserve the original assertions; the combined suite must pass before release.

Source PRs carry their focused tests and final-head CI/review evidence. The closing branch also
combines their code for integration checks. Before the next release, require its final CI and
review, pause automatic updates with ownership recorded, build the tagged image, run isolated
on-host candidate/restore rehearsals, then use the existing guarded deployment and verify live
image/version, data and playback. This batch adds no database migration or settings-version bump;
both rehearsal images must preserve the same 81 migrations and settings version 2. Keep catalog
snapshots on the deployment host. Record the observed deployment result in that release's notes
and this closing PR afterward; this snapshot does not claim the next deployment has happened.

### Separate local calendar observations

The D4 browser fixture exposed two existing issues outside its presentation scope: a cycle shorter
than a day repeats `actualStartTime`/React keys because the calendar loop wraps its item index
without advancing the cycle start; and the 390px week preview overflows its headers and initially
clips later columns under fixed day widths. These are local seeded-test findings, not reported
production incidents. Neither is fixed here. D4's full-day GET-only fixture isolates colour checks
without suppressing warnings or changing scheduling logic.

## Earlier fold-in snapshot (before the .20.3 deployment)

The state and release instructions below preserve the earlier handoff history. Their pending
`.20.3` deployment statements describe that snapshot; use the continuation status above for the
current release boundary.

| Wave        | Rows                                                          | Status                                                                                                                            |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1           | B1–B10                                                        | merged, PRs #86–#95                                                                                                               |
| 2           | D1–D7                                                         | merged, PRs #98–#104; fold-in #105                                                                                                |
| 3           | C1 form shell                                                 | merged, #108                                                                                                                      |
| 3           | C5 one delete dialog                                          | merged, #107                                                                                                                      |
| 3           | C6 sources route                                              | merged, #106                                                                                                                      |
| 3           | C7 bulk actions                                               | merged, #109                                                                                                                      |
| 3           | C4 transcode form on RHF                                      | merged, #111                                                                                                                      |
| 3           | C2 settings pages on the shell                                | merged, #112; General schedule follow-ups in #113                                                                                 |
| 3           | C3 editors on the shell                                       | merged, #115                                                                                                                      |
| 3           | Phone and guide follow-ups                                    | merged, #116, #119, #120                                                                                                          |
| 4           | S1–S7                                                         | S1 #118, S2 #124, S3 #126, S4 #133, S6 #121 and S7 #117 merged. S5 design #114 approved and merged; implementation stays separate |
| 5           | P1–P5                                                         | merged: P1 #123, P2 #122, P3 #127, P4 #129 and P5 #134                                                                            |
| 4 follow-up | FFmpeg probe errors and independent tuner defaults            | merged, #136                                                                                                                      |
| Follow-ups  | Exact browser fixtures/locators and mobile HLS helper spacing | #143 and #144 merged                                                                                                              |

Wave 3 was released as `oliviacpu-2026.10.20.2` from `f77aaea02d45f23294fb811d2c719e166214473a`.
The fork-image workflow passed, and the existing guarded deployment completed on 2026-10-20.
Post-deployment checks confirmed the release version, expected image digest, static assets and a
real HLS segment. Database integrity, row counts and settings were checked; lineups regenerated
normally with their schedules preserved. Later merges listed below are not part of that deployment.

This is the repository state at the 2026-10-20 fold-in, not a claim that the later work is deployed.
Continue to use the existing deployment scripts and their idle checks, backup and recovery path.
The next release still needs combined checks, its image build, isolated migration/restore rehearsals
using that image, and guarded deployment. A release tag moves `:latest`; it is a release action.

## Remaining rows, in order

Each row's full text and acceptance test is in the plan; this lists the order, the dependencies and
what the previous session learned that the row's agent needs.

### Wave 3, complete

1. **C3, port the entity editors** (M, Opus). Merged in #115. Channel edit (keep tabs and error dots),
   filler list, custom show, both slot editors (Save disabled when clean). Same shell and rules as
   C2: `isSubmitting={mutation.isPending}`, `mode: 'onTouched'`, the guarded load effect, tests mock
   `UnsavedNavigationAlert` and never click a disabled Save, fields locked (`fieldset` disabled +
   `inert`) while a create is in flight because the create navigates. A parity-checklist row in
   `architecture/infinite-schedules/parity-checklist.md` if slot editor behaviour changes.

### Wave 4, settings regrouped by task (after C2)

4. **S1, merged #118:** new tab set with redirects: General, Playback, Captions & audio, Guide, Tuner, Library,
   Experimental; each tab a one-line description; docs sidebar matches; e2e routes updated.
5. **S2, merged #124:** add the missing fields (scaling algorithm, deinterlace filter, rolled-file limit, backup
   tempDir/cron/enabled, search snapshot interval and max indexing memory).
6. **S3, merged #126:** remove dead settings (`plexStream.*`, `xmltv.enableImageCache`, `/plex-settings`,
   `usePlexSettings`, `channel.transcoding`, `DynamicContentConfig`) with a settings-file migration
   that bumps `SettingsFileSchema.version` / `CURRENT_VERSION`; regenerate the OpenAPI spec and web
   client (see Working rules).
7. **S4, merged #133:** "applies when" chip per field, driven by a table in `types/`.
   Browser server-address changes require a browser reload; HLS Direct output format is read for
   new playlists/program streams, not latched until every viewer disconnects.
8. **S5, design approved and merged #114:** global audio/subtitle-default design only; implementation
   stays separate. See `plans/channel-audio-subtitle-defaults.md`; no global model or UI ships in S5.
9. **S6, merged #121:** one settings API shape on the server (`/api/settings/{…}`, partial updates, `{message}`
   errors); old GET/PUT routes remain aliases for one release, unused POST reset routes are removed;
   the rescan-interval rule is shared in the schema.
10. **S7, merged #117:** env-var registry hygiene (`TUNARR_BIND_ADDR`, `TUNARR_DATABASE_NAME`,
    `DATABASE_DEBUG_LOGGING`, `ENABLE_SSDP_DEBUG_LOGGING` through `util/env.ts`; fix
    `TUNARR_BUILA_SHA`; docs still saying `LOG_LEVEL`; `systemApi.ts` reading `LOG_LEVEL`).

### Wave 5, primitives

11. **P1, merged #123:** shelve the stream-selection API (exclude from current/Latest specs and client, keep server code).
12. **P2, merged #122:** retire vestigial schema safely (backfill `mediaSourceId` inside the migration; keep
    `channel_fallback` and `mikroOrmMigrations`; legacy-only and null-id fixtures).
13. **P3, merged #127:** "used by" for filler lists, custom shows and smart collections (lineup scan unioned with
    `channel_filler_show`, cache invalidated on lineup save and attachment change).
14. **P4, merged #129:** smart collection create flow from its own page; edit the query, not only the name.
15. **P5, merged #134:** channel edit tabs as routes, including `watermark`, with `?tab=` redirects.

### Also open

- **Wave-3 follow-ups completed:** D8 and XMLTV spacing in #119, General schedules in #113,
  transcode phone layout/validation/docs/dependency cleanup in #120, and pending-save Reset in #115.
  The original findings are retained below for reference:

  - D8 (new, S, Sonnet): 16px inputs and floating labels below the `sm` breakpoint only (`MuiInputBase`,
    `MuiInputLabel`, the MUI X picker input base), 14px from `sm` up; never `maximum-scale=1`. C2's
    measurement: labels go from 10.5px to 12px, nothing scrolls sideways at 390px.
  - General settings: clearing the roll interval and then unticking "Enable log file rolling" (not
    "Roll on schedule") still sends the empty interval and the server refuses it; unticking and
    re-ticking "Enable backups" replaces a cron backup schedule with a daily one until Reset (C2).
  - Transcode form: phone layout needs `xs` sizes on its Grid/Stack; docs describe a `vaapiDriver`
    option the form never showed; zod's raw "expected number, received NaN" message; leftover
    `@tanstack/react-devtools` dev dependency; "Reset changes" still works while a create is in
    flight (harmless) (C4).
  - XMLTV at 390px: "Refreshes start at" label overlaps the previous field's two-line help (D2/C2).

- From C7: a server bulk endpoint for channels/lists (one guide and M3U rebuild instead of N);
  `getApiErrorMessage` does not read the `{ error }` body that `PUT /api/channels/:id` sends; the
  server's whole-object channel replace wipes `fillerCollections`/`subtitlePreferences` when a
  request omits them (the client works around it by fetching first). These remain follow-ups beyond S6.

- The wave-1 and wave-2 follow-up lists in the plan (T1 test health; the small D-row leftovers;
  the error page's bug-report link targeting upstream; docs links to tunarr.com).
- Wave-3 notes are folded and that release is deployed, as recorded above. The settings and tune-in
  stacks are merged; their combined release and deployment remain pending at this fold-in.

## Reconciled follow-up inventory (2026-10-20)

The older follow-up lists above preserve the original reports. Their current disposition is:

- D2/D6 headings and navigation: merged in #131. Fork help and error-page links: merged in #128.
- D4 functional guide defects: merged in #137 (redirect channel names, mobile times/remaining time,
  themed sliver divider, empty controls file). Guide duration buttons now flank the duration in
  minus/duration/plus order (#132); this merge is later than the deployed wave-3 release.
- T1 test-health and separate browser-fixture ports: merged in #130. Integrated follow-up fixture
  cleanup and exact locators merged in #143; mobile HLS helper spacing merged in #144.
- D3 Refresh Preview and entity-editor Add Media buttons are already outlined. Custom-show and
  filler deletion already use shared success/failure toasts. Page creation buttons, selection
  commit and unsaved-navigation confirmation remain primary actions intentionally.
- D3 remaining presentation candidates: `EditMediaSourceLibrariesDialog` has a contained Close
  button despite saving each library toggle immediately; localized Cancel/Delete/Close labels
  remain inline in some dialogs; task/fixer/copy-operation toasts have operation-specific wording.
  Any later vocabulary pass must preserve each operation's meaning rather than calling it a save.
- D4 remaining presentation work: `ChannelLineupList`, `MidRollGroupRow`, `ProgramDayCalendarView`
  and `ProgramWeekCalendarView` still use the random program palette. Their non-table time/count
  surfaces need tabular numerals; the guide's remaining-time box does too. System-theme palette
  selection is fixed. A different dark yellow is a separate visual decision, not a correctness fix.
- D5 localization/accessibility merged in #138. D7 missing-entity handling merged in #135,
  including cached 404/500 behavior and one lookup request per visit. S5 remains approved design
  only (#114).
- C7 bulk endpoints, whole-object channel replacement and the legacy `{error}` response helper
  remain candidates, not part of S6. The current client preservation workaround stays in place.

The separate tune-in stack #139–#142 and settings follow-up #136 are merged. The tune-in report
and existing `FORK.md` entry are preserved. This continuation owns the combined release/deploy.
Use the existing deployment guard and fresh private backup; keep database snapshots and isolated
migration/restore rehearsals on the deployment host.

## Fold-in state and next release (2026-10-20)

This fold-in records 21 merged settings/UI notes in `FORK.md`: #117, #118, #121–#124,
#126–#138, #143 and #144. Their consumed source notes are removed;
`docs/fork/changes/README.md` remains. All planned code rows and the tune-in stack are merged.
S5 remains approved design only; no global defaults implementation is included.
The FFmpeg API example now uses the canonical `PUT /api/settings/ffmpeg`; S6's entry records the
one-release GET/PUT aliases and the explicit reset-endpoint removal.

At this snapshot, wave 3 is live and the later combined work has not been deployed. Complete the
remaining release steps in this order:

1. Finish combined CI/review and contract checks. The generation order is types/shared build,
   OpenAPI, web client, router routes. Check matching current development/Latest specs, six canonical
   settings groups, three library usage paths, structured FFmpeg probe errors, hidden profile routes
   and the unchanged `/version` contract. Do not rewrite historical specs; inspect docs-selector changes.
2. Hold the existing automatic-update pause mechanism before tagging: preserve any pre-existing
   app `.paused` marker, and record ownership of any temporary pause so only its creator clears it.
   Publish the fork release tag and wait for the existing fork-image workflow to build the release
   image. The tag moves `:latest`, so keep automatic updates paused during the build and rehearsals.
3. Use that built image for isolated migration and restore rehearsals on the deployment host.
   The existing workflow builds only release tags; it cannot provide this candidate image before
   the tag. Keep the live database on its host and use isolated copies for rehearsals.
4. After rehearsals pass, perform the guarded live deployment with its existing idle, backup and
   recovery checks. Verify the running image/version, readiness, data preservation and playback.
   Record the actual version/digest and verified outcome in the existing GitHub release notes and
   fold-in PR afterward. This repository snapshot does not imply that deployment already happened.

## Decisions already taken (do not reopen)

- Stay on MUI and Material; the theme in `web/src/theme.ts` is the design system (IBM Plex Sans,
  type scale, both palettes, outlined default buttons, flat bordered Paper). Light primary is
  `#00757c`; dark primary `#2fb7c0`; dark secondary `#5b8fb9`.
- Settings tabs are regrouped by user task and stay tabs (no sidebar).
- Input size: 14px from the `sm` breakpoint up; below `sm`, inputs and floating labels go to 16px
  (decided after C2's measurement; implemented by the D8 follow-up row). Never `maximum-scale=1`.
- P1 shelve; P2 retire (with the safety rules now in the row).
- Fork notes for parallel PRs go to `docs/fork/changes/<date>-<slug>.md` (see its README); a
  standalone PR writes FORK.md directly.
- One verb per action: labels and toasts come from `web/src/strings/actions.ts`
  (`useActions()`, `useToasts()`, `withReason`).
- One delete dialog: `web/src/components/DeleteConfirmationDialog.tsx`.
- One form shell: `web/src/components/form/SettingsForm.tsx` + `web/src/hooks/useSettingsMutation.ts`
  - `SwitchFormController` / `SelectFormController` in `components/util/TypedController.tsx`.

## Working rules

- **Environment.** Node 22: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"` (sourcing
  nvm is blocked in agent sandboxes). `pnpm i && pnpm turbo build` once per worktree. Tests:
  `cd web && pnpm test --maxWorkers=2` (full parallelism times out a few files under load);
  `cd server && pnpm test <path>`. `pnpm turbo typecheck`; `pnpm lint-changed`. E2E:
  `cd server && pnpm install-meilisearch` once, `cd e2e && pnpm e2e:install-browsers` once, then
  `cd e2e && pnpm e2e` (the fixture finds ffmpeg on PATH or `TUNARR_TEST_FFMPEG`; default ports are shared; use a distinct `TUNARR_E2E_PORT_OFFSET` in each worktree
  for parallel sweeps).
- **One PR per row, one worktree per PR**, branch off `main`, conventional-commit subjects
  (commitlint rejects a subject that starts with a capital), the repo's PR template. In its "Design issue" section write the plan path and the row id and
  that the maintainer approved the plan on 2026-10-19 (PR #85); this fork has no labelled GitHub
  design issues, so that line is what satisfies AGENTS.md's gate here (upstream's `design approved`
  label does not apply). Fill the "AI use" section with the tool that actually did the work, and
  end the body with that tool's attribution line (Claude Code's line when Claude did it; Codex's own
  disclosure when Codex did; nothing when a person did).
- **Never `git add -A`.** A build can rewrite `web/src/generated/*` and `docs/generated/*`; stage
  paths. The Lingui catalogs (`web/src/locales/*/messages.po`) are regenerated by the post-merge
  `lingui-extract` job; do not commit them. When a server schema changes on purpose, regenerate
  with `cd server && TUNARR_DATABASE_PATH=<empty scratch dir> pnpm generate-openapi` and
  `cd web && pnpm generate-client`, and commit those.
- **Review and landing.** Post `@codex review` on the PR; fix real findings with a plain push and
  re-request; answer process findings (the "approved design" one) by pointing at the plan's
  approval-gate paragraph. Then merge main into the branch (not rebase) if GitHub says
  CONFLICTING, resolve, push, let CI run again, and merge with a merge commit after the `build`
  check is green and Codex's state for the head commit has no unresolved findings; label
  `approved` first (repo rule). Agent sandboxes cannot rebase, force-push or merge; the
  orchestrating session does that.
- **Every change ships with a test** that fails without it; no `as any`; no inline `import()`
  types; `!== undefined` for `T | undefined`; no unguarded `!`; Lingui for user-visible strings.
- **Sizing.** S rows and mechanical work: Sonnet. M/L rows, pipeline, scheduling, migrations,
  design judgement: Opus.
