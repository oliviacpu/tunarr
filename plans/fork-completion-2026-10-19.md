# Fork completion candidate — 2026-10-19

This is work for the personal fork, not an upstream submission. The candidate starts
at `5b1ba7065c21673427046ff4687bb18233376407` on `codex/fork-completion`.
The original checkout and its existing uncommitted files are preserved.

## Implemented

| Area | Changes | Verification |
| --- | --- | --- |
| Guide and background work | Integrates the patches from PRs #62–#64: classified/bounded Plex notifications, scan-worker protocol and watchdog handling, and guide refreshes across midnight. | Notification, worker, scheduling, API and settings UI regressions. |
| Captions and playback | Integrates PR #65's early-end and per-segment language fixes. HLS and its wrapper share the first session's caption decision. Selected filters determine the output rate used by FFmpeg and captions. | Timeline, wrapper, factory and session-manager regressions; software/NVIDIA/VAAPI/QSV builder cases for normal and software fallback paths. |
| Subtitles | Downloads decode bytes before UTF-8 caching; conversion/burn-in gets a Windows-1252 override when detected. Embedded tracks retain their stored SDH disposition. | Real HTTP fixtures for Plex, Jellyfin and Emby; SDH/encoding unit tests; real FFmpeg compares legacy and UTF-8 rendered frames. |
| Controls and rendering | Slow/slower/veryslow presets are available and retain saved values; shared select controls have label associations. Now-playing font size accounts for picture width, and filter escaping is shared. | Form save regressions, all four pipeline builders, real rendering on landscape/square/portrait pictures and punctuation/Japanese text. |
| Lifecycle and diagnostics | Integrates PR #66's secret redaction. HLS readiness polling ends on stop without changing stopped state into an error. Speed warnings distinguish configured threads from active read-ahead threads. Audio-language fallback is logged; missing drawtext warns once per executable path per process. | Redaction, lifecycle, speed-monitor and factory regressions. |
| Search | Atomic private key replacement, repair of existing permissions, explicit backup instructions. | Filesystem failure/restart tests; real Meilisearch restart and existing-index-without-key tests. |
| Throughput and storage | Configurable read-ahead thread limits, x265 pools, SQLite cache/mmap overrides and warmup caps; average frame-rate selection for VFR; parallel gap assets and a narrow gap-track query. Deleting a filler list clears channel gap-music references. Library pagination gains migration 0056 with a covering index. | Thread, frame-rate, pragma and warmup regressions; migrated-database query plan; explicit-transaction policy check. |
| Scanning and publishing | Case-insensitive subtitle discovery, per-library scanner warnings, queued custom-show responses, one artwork listing per publication and stale temporary-file cleanup. | Real HTTP responsiveness regression, scanner and matching fixtures, bounded artwork listing tests. |
| Caption fallback and maintenance | Unsupported text falls back to burn-in; repeated caption refusal warnings are suppressed per session. HLS serialization helpers move to test support; segment defaults and caption normalization are centralized. | Non-Latin fallback, timeline, playlist and session regressions. |
| Engineering workflow | API generation retains temporary paths through server initialization; regenerated dev contracts; upstream `latest` spec restored. Rerunning a release edits its existing release notes. A Docker runtime-test stage is required by the final image and a nightly/manual workflow builds it without publishing. | Production builds, generated-file reproducibility, real-binary tests, packaged worker smoke test. |

The five existing PRs are assembled locally for integration testing; this work does
not mark them approved or merge them on GitHub. Release concurrency stays serialized:
removing it would introduce a race between checking the newest tag and moving `latest`.

## Readability and redaction follow-up

Three Sol subagents handled subtitle planning, scan/session lifecycle, and credential
redaction, with integration review in the main session. Subtitle planning now returns
one result for burn-in, WebVTT and captions. Custom-show queue callers receive explicit
acceptance and completion promises. Caption-capable sessions share a typed contract
and the `captionsEnabled` name. Comments describe current session and thread behavior.

The reported logging defect is reproduced with synthetic credentials: query punctuation
was treated as a value terminator, leaving a suffix visible. The follow-up separates
query and header handling and tests punctuation through strings, errors and streamed
stderr. This is evidence of a redaction defect, not evidence that an actual credential
was exposed. The fix was pushed to PR #66; its GitHub review has not been marked resolved by this work.

## Validation record

Use Node 22 and `pnpm install --frozen-lockfile`. Validation commands:

```sh
pnpm lint-changed
pnpm turbo typecheck
pnpm turbo test -- run
pnpm turbo build
pnpm --filter @tunarr/server generate-openapi
pnpm --filter @tunarr/web generate-client
docker build --platform linux/amd64 --target runtime-tests \
  --build-arg exec_target=linux-x64 --build-arg is_edge_build=false \
  --build-arg tunarr_version=completion-validation --build-arg tunarr_build=local \
  -t tunarr-completion-validation .
```

The ordinary suite's artwork tests now stub their HTTP transport instead of contacting
a fake hostname. The duplicate-case artwork test skips when the filesystem cannot
create two files distinguished only by case; it still runs on Linux.

- Integrated follow-up suite: **3,694 passed, 4 skipped** (server 3,297; web 255; shared 142).
  The subsequent unquoted-header quote fix passed all 44 focused redaction/process tests.
- Workspace type checks: all five tasks passed, including local-test types.
- Changed-file lint: passed for 144 TypeScript files.
- Packaged Linux worker smoke: **14/14 checks passed**, including scans, task distribution,
  database path isolation and shutdown. This image predates the final pagination-index
  migration, path-boundary fix and narrow gap-track query; those pass the final source suite.
- Native Meilisearch: **2/2 passed**, including existing-index recovery and keyed restart.
- Shipped Linux FFmpeg/runtime tests: 38 passed and 60 hardware-dependent cases skipped.
  The combined runtime target is **not green locally**: Meilisearch cannot reserve its
  500 GB virtual address range under Rosetta. Native Linux validation remains a release gate;
  the workflow retains the full test rather than skipping it.
- Production build: all five tasks passed. API specification and generated client are byte-for-byte reproducible on a second generation.

## Release and remaining work

This candidate is not a claim that every item in the older 36-task review is complete.
The following require additional implementation or evidence:

- Benchmark the new tuning controls on representative deployment media before changing
  defaults. Gap assets resolve concurrently and selection loads only candidate fields; tune-in latency and the 5,000-track benchmark have not been measured.
- Documentation now uses generic media examples and correct migration references. Historical
  entries were not assigned guessed upstream submission status. Invalid saved filter warnings
  remain visible until the configuration is repaired.
- Caption cache work and repeated-audio filter sharing need measurements first. Long-running
  playlist growth requires the planned 12–24-hour capture; no short test substitutes for it.
- Caption label changes in Plex and appearance need the client checks described in the
  review. Non-Latin captions now fall back to burn-in when more than 10% of cues contain
  unrepresentable characters; confirm this behavior on the actual client. No GPU playback
  evidence is available here.
- The prototype branch is untouched; archiving/deleting it needs the explicit authorization
  called for in the plan. No release tag, image push or deployment occurred.

Before a release is accepted:

1. Review the combined changes and the individual PRs; run the runtime target on Linux.
2. Record Apple TV/Plex results for captions, language labels, audio switching, fallback
   programs and gaps. GPU support requires testing on the corresponding hardware.
3. Preserve the current image digest and a verified backup, including the separate search
   key. Publish only when requested, then confirm the running digest and restored state.
4. Check one day of redacted deployment logs and playback for scan stalls, guide coverage,
   subtitle healing, caption failures and new warnings. Keep rollback available.

## Pull request map

The existing work remains in #62 (Plex notifications), #63 (scan workers),
#64 (XMLTV scheduling), #65 (caption boundaries) and #66 (logging redaction).
PR #66 now includes the punctuation fix; #64 includes isolated scheduling cases.
The fork Build workflow currently targets PRs against main, dev or media-scanner.
Stacked children have independent local checks and commitlint, but require Build
CI after their parents land and they are retargeted to main.

| PR | Scope | Base / dependency |
| --- | --- | --- |
| [#67](https://github.com/oliviacpu/tunarr/pull/67) | Narrow gap-music query and deleted-list cleanup | main |
| [#68](https://github.com/oliviacpu/tunarr/pull/68) | Atomic private search keys | main |
| [#69](https://github.com/oliviacpu/tunarr/pull/69) | Queue lifecycle and responsive custom-show requests | #63 |
| [#70](https://github.com/oliviacpu/tunarr/pull/70) | Database tuning and pagination index | main |
| [#71](https://github.com/oliviacpu/tunarr/pull/71) | Artwork publication and URL helper cleanup | main |
| [#72](https://github.com/oliviacpu/tunarr/pull/72) | Preset controls and labels | main |
| [#73](https://github.com/oliviacpu/tunarr/pull/73) | Runtime validation and release tooling | main |
| [#74](https://github.com/oliviacpu/tunarr/pull/74) | Subtitle encoding and matching | #65 |
| [#75](https://github.com/oliviacpu/tunarr/pull/75) | Pipeline frame rate and rendering | #74 |
| [#77](https://github.com/oliviacpu/tunarr/pull/77) | Session/caption integration and read-ahead controls | #75 |

The session/caption integration is #77. This documentation PR describes the
combined result and should land after the implementation PRs. Parent PRs must land
before their children are retargeted to main. Resolve FORK.md entries by retaining
each scoped entry; regenerate API contracts after combining schema-changing PRs.
No merge, release, or deployment has been performed.
