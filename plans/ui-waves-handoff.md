# UI waves: handoff for whoever continues (2026-10-20)

This is the self-contained resume point for the work planned in
`plans/ui-primitives-and-settings-audit-2026-10-19.md` ("the plan"). It is written so a new Claude
session, Codex, or a person can continue without the previous session's memory. Read the plan's
"Approval gate" paragraph, the row you are about to work on, and this file's "Working rules" before
starting anything.

## State at handoff

| Wave | Rows | Status |
|---|---|---|
| 1 | B1–B10 | merged, PRs #86–#95 |
| 2 | D1–D7 | merged, PRs #98–#104; fold-in #105 |
| 3 | C1 form shell | merged, #108 |
| 3 | C5 one delete dialog | merged, #107 |
| 3 | C6 sources route | merged, #106 |
| 3 | C7 bulk actions | merged, #109 |
| 3 | C2, C4 | in progress (agents launched 2026-10-20 after C1 merged); C3 starts after C2 lands |
| 4 | S1–S7 | not started; S1 needs C2; S5 is a design decision first |
| 5 | P1–P5 | not started; P1 shelve and P2 retire were approved 2026-10-19 |

Release `oliviacpu-2026.10.20` was tagged at the wave-2 fold-in (waves 1–2 plus C5/C6) and the
fork image built from it. Cut another tag after wave 3 lands.

## Remaining rows, in order

Each row's full text and acceptance test is in the plan; this lists the order, the dependencies and
what the previous session learned that the row's agent needs.

### Wave 3, remaining

1. **C2, port every settings page to the shell** (M, Opus). After C1. Pages: General (server
   form; `toFormValues = (data) => getDefaultFormValues(settings, data)`), Transcoding (the old
   FFmpeg page), Scanner, Tuner (HDHR), Features (`useForm({ values })` + env-override switches map
   onto `SwitchFormController` with `disabled`; `toFormValues = (r) => r.flags`). Use
   `SettingsForm`, `useSettingsMutation({ form, mutation, toFormValues, invalidate })`,
   `isSubmitting={mutation.isPending}`, `onRestoreDefaults` only when values differ from defaults,
   and the load-effect guard `if (!isEqual(data, defaultValues)) reset(data)` with `data` as the
   only dependency (otherwise the refetch after a save drops edits made during it). Delete the
   XMLTV/HDHR copy-pasted scaffolding and the duplicated "Every N / unit / time" schedule widget
   (one `ScheduleFields` for backups and log rolling). Before porting, evaluate 16px inputs on a
   phone (iOS Safari zooms into inputs under 16px; labels shrink to 10.5px at 14px) and decide.
   Acceptance: each page is a form body only; all have the unsaved guard; one e2e spec per page of
   the shape load → change one field → save → reload → the field held and nothing else moved
   (`e2e/tests/xmltvSettings.spec.ts` is the pattern).
2. **C3, port the entity editors** (M, Opus). After C2. Channel edit (keep tabs and error dots),
   filler list, custom show, both slot editors (Save disabled when clean). Same shell and rules as
   C2. A parity-checklist row in `architecture/infinite-schedules/parity-checklist.md` if slot
   editor behaviour changes.
3. **C4, transcode config form onto RHF** (M, Opus). After C1; can run beside C2. Replace
   TanStack Form in `components/settings/ffmpeg/TranscodeConfigSettingsForm.tsx` and
   `useTranscodeConfigFormOptions.ts`; remove `@tanstack/react-form` from `web/package.json` and
   delete `hooks/form.ts` and `components/form/Basic*Input` if nothing else uses them; validation
   parity tests (resolution, bitrate, hardware options).

### Wave 4, settings regrouped by task (after C2)

4. **S1** new tab set with redirects: General, Playback, Captions & audio, Guide, Tuner, Library,
   Experimental; each tab a one-line description; docs sidebar matches; e2e routes updated.
5. **S2** add the missing fields (scaling algorithm, deinterlace filter, rolled-file limit, backup
   tempDir/cron/enabled, search snapshot interval and max indexing memory).
6. **S3** remove dead settings (`plexStream.*`, `xmltv.enableImageCache`, `/plex-settings`,
   `usePlexSettings`, `channel.transcoding`, `DynamicContentConfig`) with a settings-file migration
   that bumps `SettingsFileSchema.version` / `CURRENT_VERSION`; regenerate the OpenAPI spec and web
   client (see Working rules).
7. **S4** "applies when" chip per field (live, next session, next program, restart), driven by a
   table in `types/`.
8. **S5** design decision only: a short design for global audio/subtitle defaults; no UI.
9. **S6** one settings API shape on the server (`/api/settings/{…}`, partial updates, `{message}`
   errors); old routes as aliases for one release; also fold the rescan-interval rule into the schema.
10. **S7** env-var registry hygiene (`TUNARR_BIND_ADDR`, `TUNARR_DATABASE_NAME`,
    `DATABASE_DEBUG_LOGGING`, `ENABLE_SSDP_DEBUG_LOGGING` through `util/env.ts`; fix
    `TUNARR_BUILA_SHA`; docs still saying `LOG_LEVEL`; `systemApi.ts` reading `LOG_LEVEL`).

### Wave 5, primitives

11. **P1** shelve the stream-selection API (exclude from spec and client, keep server code).
12. **P2** retire vestigial schema safely (backfill `mediaSourceId` inside the migration; keep
    `channel_fallback` and `mikroOrmMigrations`; legacy-only and null-id fixtures).
13. **P3** "used by" for filler lists, custom shows and smart collections (lineup scan unioned with
    `channel_filler_show`, cache invalidated on lineup save and attachment change).
14. **P4** smart collection create flow from its own page; edit the query, not only the name.
15. **P5** channel edit tabs as routes, including `watermark`, with `?tab=` redirects.

### Also open

- From C7: a server bulk endpoint for channels/lists (one guide and M3U rebuild instead of N);
  `getApiErrorMessage` does not read the `{ error }` body that `PUT /api/channels/:id` sends; the
  server's whole-object channel replace wipes `fillerCollections`/`subtitlePreferences` when a
  request omits them (the client works around it by fetching first). Candidates for S6.

- The wave-1 and wave-2 follow-up lists in the plan (T1 test health; the small D-row leftovers;
  the error page's bug-report link targeting upstream; docs links to tunarr.com).
- After wave 3: a fold-in PR (see Working rules) and a release tag.

## Decisions already taken (do not reopen)

- Stay on MUI and Material; the theme in `web/src/theme.ts` is the design system (IBM Plex Sans,
  type scale, both palettes, outlined default buttons, flat bordered Paper). Light primary is
  `#00757c`; dark primary `#2fb7c0`; dark secondary `#5b8fb9`.
- Settings tabs are regrouped by user task and stay tabs (no sidebar).
- Inputs stay 14px until C2's phone evaluation says otherwise.
- P1 shelve; P2 retire (with the safety rules now in the row).
- Fork notes for parallel PRs go to `docs/fork/changes/<date>-<slug>.md` (see its README); a
  standalone PR writes FORK.md directly.
- One verb per action: labels and toasts come from `web/src/strings/actions.ts`
  (`useActions()`, `useToasts()`, `withReason`).
- One delete dialog: `web/src/components/DeleteConfirmationDialog.tsx`.
- One form shell: `web/src/components/form/SettingsForm.tsx` + `web/src/hooks/useSettingsMutation.ts`
  + `SwitchFormController` / `SelectFormController` in `components/util/TypedController.tsx`.

## Working rules

- **Environment.** Node 22: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"` (sourcing
  nvm is blocked in agent sandboxes). `pnpm i && pnpm turbo build` once per worktree. Tests:
  `cd web && pnpm test --maxWorkers=2` (full parallelism times out a few files under load);
  `cd server && pnpm test <path>`. `pnpm turbo typecheck`; `pnpm lint-changed`. E2E:
  `cd server && pnpm install-meilisearch` once, `cd e2e && pnpm e2e:install-browsers` once, then
  `cd e2e && pnpm e2e` (the fixture finds ffmpeg on PATH or `TUNARR_TEST_FFMPEG`; ports are fixed,
  so run one sweep at a time).
- **One PR per row, one worktree per PR**, branch off `main`, conventional-commit subjects
  (commitlint rejects a subject that starts with a capital), the repo's PR template with the
  "Design issue" section pointing at the plan and the row id, body ending with the Claude Code line.
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
