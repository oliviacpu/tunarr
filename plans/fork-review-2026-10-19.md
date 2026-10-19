# Fork review: state of every change, and the work to finish it (2026-10-19)

## Context

The fork (`oliviacpu/tunarr`) carries 59 merged PRs on top of `upstream/main` (313 files, +52,681/-1,491), merged
with upstream as of 2026-10-18 and released as `oliviacpu-2026.10.18.4`. Nothing is unreleased on `main`. The user
asked for a whole-picture review, grouped by category: what is good, what needs work, how complete each change is,
and what to do next, with each action scoped so one Opus subagent can carry it from branch to merge.

This document is that review plus the plan. The findings come from three thorough read-only reviewers (one per
category group) and an independent `/code-review` bug hunt over the whole fork diff, with the headline claims
re-checked by hand. Nothing was run; CI on `main` is green (Build, Fork image `.18.4`), and every claim of "test
exists" is from reading the code. Captions had their own review yesterday
(`plans/closed-captions-review-2026-10-18.md`); this one checks that its items landed and covers what it missed.

## Verdict in one table

| # | Category | PRs | Complete | Verdict |
|---|---|---|---|---|
| 1 | CEA-608 closed captions | #4 #18 #19 #20 #28 #29 #32 #39 #43 #53–#57 | ~75% | Core verified end to end on software. Two new correctness bugs (wrapper codec gate, captions leaking past an early program end). Design still moving. |
| 2 | Sidecar / external subtitles | #3 #21 #24 #44 | ~90% | Done as planned; small gaps (SDH on embedded tracks, case-sensitive local matching, charset). |
| 3 | Switchable audio (fixed track layout) | #23 + pre-PR language tag | ~85% | Clean code; needs an on-device Plex check and a fallback log. |
| 4 | Gap music and now-playing text | #52 + pre-PR gap music | ~85% | Works on software; sizing assumes 1920×1080, drawtext absence is silent, dead Soundtrack field. |
| 5 | HLS session / tune-in | #5 #6 #11 #14 #34 #35 #36 #49 | ~85% | Sound, oracle-tested playlist work, no upstream overlap. Thread-boost has no off switch; speed warning misreports. |
| 6 | `.ts` wrapper (HDHomeRun stream) | #41 #42 #46 #54 | ~85% | All four fixes land; shares bug 1 with captions. |
| 7 | FFmpeg pipeline fixes | #38 #40 + 9 pre-PR | ~75% | Software path solid. Hardware never tested; frame-rate rule copies builder logic; libx265 ignores threads. |
| 8 | Logging / observability | #48 #49 #56 | ~70% | Levels right. ffmpeg stderr still leaks media-server tokens (pre-existing upstream). |
| 9 | Scanner worker threads | #1 #15 + 7 pre-PR | ~85% | Cleanup paths solid. A bad final worker message hangs the queue forever; Sync Now blocks behind scans. |
| 10 | Database / request latency | #10 #12 #17 #22 #25 #51 | ~85% | Streamed JSON and IMMEDIATE transactions are right. Cache/mmap/warm-up forced with no switch; warmer uncapped. |
| 11 | Guide / XMLTV / Plex | #2 #7 #8 #26 #45 #47 #50 | ~80% | Public media folder is safe. Rebuild hours stop at midnight (guide can run out daily); notifier retries auth failures. |
| 12 | Search / smart collections | #13 + meili key | ~90% | Correct; key file write not atomic, no CI test. |
| 13 | Build / CI / docs / tooling | #9 #16 #27 #31 #33 #37 #58 #59 | ~75% | Works. Hand-edited `latest` spec, workflow edge cases, FORK.md drift and private details, orphan prototype branch. |

Code-style rules (CLAUDE.md) hold across the fork's production code: no `as any`, no inline `import()` types, no
`!= null` on `T | undefined`. The exceptions are in tests (`databaseFileWarmer.test.ts:11` inline import,
`ProgramDB.test.ts:2933` unguarded `!`, ~9 `as any` in `TvGuideService.test.ts` copying upstream's habit).

## Cross-cutting findings

- **Bugs confirmed by more than one reviewer.** The HDHomeRun caption gate (`ConcatStream.captioned`,
  `server/src/stream/ConcatStream.ts:29-35`) lacks the H.264 check that `captionsOn`
  (`server/src/ffmpeg/FfmpegStreamFactory.ts:813-833`) gained in #53. An HEVC or MPEG-2 channel advertises a CC
  track that never carries data, and every segment is parsed and refused at debug level. Three of four reviewers
  found it independently.
- **Silent failure modes.** Captioning refusals (`HlsSession.ts:637-642`), missing drawtext
  (`FfmpegStreamFactory.ts:1210`), `CaptionLanguageStream` losing TS sync, and the non-H.264 notice are all debug-only
  or per-program noise. The pattern: a feature disappears with no visible reason.
- **Churn hot spots.** `Cea608Encoder.ts` 23 commits, `FfmpegStreamFactory.ts` 31, `HlsSession.ts` 18, the #38
  frame-rate rule 9 fix-on-fix commits, `FORK.md` 136 of 327 commits. The caption and frame-rate designs are not
  settled; the "two quiet weeks" readiness signal from yesterday's review has not started.
- **Predicted, not reported.** The output frame rate (`FfmpegPlaybackParamsCalculator.ts:178-201`) mirrors each
  hardware builder's deinterlace choice instead of asking the built pipeline. Any builder change puts captions and
  `-r` out of step. Hardware pipelines have never been run with the fork's changes; the deployment has no GPU.
- **Duplicated logic.** Two filter escapers (`escapeFilterOptionValue` vs `escapeDrawtextValue`); two caption
  normalisers (`BasicChannelRepository.captionsToColumn` vs `@tunarr/shared normalizeChannelCaptions`);
  `xmlTvLinkHost` aliasing `publicLinkOrigin`; `subs.m3u8` still fully re-parsed per request while media playlists
  are incremental.
- **Local environment is stale.** `node_modules` dates from Oct 13 and resolves TypeScript 5.9.3; the catalog has
  been 7.0.2 since the merge. Run `pnpm i && pnpm turbo build` before trusting any local typecheck. Ordinary test
  files still carry ~650 type errors (FORK.md:162); the `*.local.test.ts` files now typecheck clean.
- **Not run in CI.** The real-ffmpeg local tests, the Meilisearch local test, and the worker smoke test against the
  pkg binary. Wall-clock perf tests (250 ms limits) do run and could flake on busy runners.
- **Docs drift.** FORK.md:9 (`.1` tags exist), :370 (offset prints `-0500` not `-05:00`), :733/:930 (migration
  numbers swapped after the merge: audio tracks is now 0054, captions 0055), :1208 (promised re-measure never
  recorded), :1976 (label "not yet checked" but confirmed at :1782), :2133 (says 7.1.1, image ships 8.1.3), :2188
  (preset applies at session start, not next process); 16 entries lack an **Upstream:** line; Video Preset is
  undocumented; `docs/configure/ffmpeg/index.md:10` still recommends ErsatzTV ffmpeg; the captions review's status
  line omits #56/#58.
- **Private details in committed files** (fork policy forbids): FORK.md:1898-1899 names an artist and albums;
  FORK.md:1243 names the private grid script; FORK.md:821, `plans/channel-save-guide-reuse.md:9,15` and
  `server/src/services/XmlTvWriter.ts:286` name a deployment channel.
- **Working tree.** `.claude/settings.json` has an uncommitted line adding `Bash(gh pr merge:*)` to the allowlist.
  Decide on it before launching subagents that merge.
- **Orphan branch.** `prototype/loudness-fixed-gain` (one commit, +6,080) adds a migration `0055` that collides with
  `main`'s; `plans/loudness-measured-once.md` already concluded the feature isn't worth it.

## Per-category detail

### 1. CEA-608 closed captions (~75%)

**Landed from yesterday's review:** A1 codec gate (transcode only), A2 `pairForPts` call sites plus
`tsconfig.local-test.json` and a `typecheck:local-tests` script, A3 `ConcatStream.captioned` reads
`subtitlesEnabled`, `exactFrameRate` removed, unreachable hls_direct_v2 branch removed, FORK.md lines cleaned,
timing logs at debug per segment with an info summary per session, upstream merge with the `0053` collision resolved.
Partly landed: the shared merge moved to `@tunarr/shared`, but the server's save path still has its own copy.

**Good:** fallback order (selected track, then candidates by language with regular before SDH, then the notice);
~10 `captionedSegment` tests covering the 33-bit PTS wrap, frame-spacing mismatch, a missing frame; a test that the
per-channel override schema and the global schema have the same fields; no style-rule violations.

**Needs work:**
- bug `ConcatStream.ts:29-35`: no H.264 gate (see cross-cutting). `MpegTsCaptionInserter.ts:115,214-216` adds the
  608 descriptor to any video type.
- bug `HlsSession.ts:471-482, 591-601, 604-611`: a program's caption window runs to its planned end. If ffmpeg stops
  early, the next item (gap, error screen, commercial without subtitles) plays inside the old window and
  `captionEntryAt` sends the previous program's remaining dialogue over it.
- bug `HlsSession.ts:625`: the PMT language label comes from the newest timeline entry, so a previous program's
  trailing segments carry the next program's language.
- bug `ProgramCaptions.ts:282`: subtitle files are read as UTF-8 only. A CP1252 sidecar turns `café` into `caf`
  because the encoder drops U+FFFD. The burn-in path rendered it correctly.
- risk `StreamModule.ts:88-92` vs `FfmpegStreamFactory.ts:161`: the CC switch is read at tune-in by the wrapper but
  per program by the transcode; toggling mid-session loses subtitles until re-tune.
- risk `HlsSession.ts:637-642`: refusals logged at debug only; `streamApi.ts:414-418` warns with a stack per
  failing request per viewer.
- perf `HlsSession.ts:620`: the segment rewrite runs synchronously once per viewer per segment (a 4 MB segment is
  ~22k packets on the main thread). `HlsSession.ts:605, 662-675`: `toReversed()` per frame and a spread rebuild
  per frame, quadratic per segment.
- quality: `FfmpegStreamFactory.ts:823-829` info line per program; `:841-843` `loadCaptions` accepts `undefined`
  with a guard no caller needs; `BasicChannelRepository.ts:133-151` duplicate normaliser.
- open from yesterday: pipeline-reported frame rate (FORK.md:566-572); the segment-cache decision (timing numbers
  exist in the log, nobody has read them); non-Latin text dropped silently (`Cea608Encoder.ts:204-216`); the label
  is the first preferred language, not the chosen track's (`ProgramCaptions.ts:299` is kept but overwritten by
  `ConcatStream.ts:23,44`); hardware pipelines; CC2/CC3; appearance plan step 2.

**Missing before done:** the four bugs; chosen-track language; one hardware pipeline or the reported frame rate;
Apple TV and Plex Mac test-pattern results recorded, then appearance step 2; the cache decision; a burn-in fallback
for non-Latin text.

### 2. Sidecar / external subtitles (~90%)

**Good:** atomic temp-file-then-rename with the old copy kept on failure (`ExternalSubtitleDownloader.ts:139-199`);
the live file preferred over a downloaded copy (`ProgramStreamDetailsFetcher.ts:162-174`); the self-heal leaves
things alone when the server still lists the stream and runs at most hourly per program
(`SubtitleExtractorTask.ts:357-501`); the forced-flag fixer is one idempotent UPDATE; `notFoundIsExpected` quiets
only subtitle fetches; all of `plans/plex-stale-subtitle-404-2026-10-16.md` §2 landed; upstream #2324 merged
cleanly, the fork's escaping intact.

**Needs work:** `ProgramStreamDetailsFetcher.ts:137` embedded tracks always marked not-SDH, so "regular before SDH"
only works for sidecars; `LocalSubtitlesService.ts:38,44,48` case-sensitive name and extension matching; the
"no longer has subtitle stream" message built in four places; `isInsideFolder` exported and untested;
`MediaSourceScanner.ts:87,102` "Plex hides paths" flag shared across concurrent scans.

**Missing before done:** the five items above; a check in the deployment log that the hourly refresh and heal lines
actually fire (record at FORK.md:858).

### 3. Switchable audio (~85%)

**Good:** slot rules are a pure function (`AudioTrackLayout.ts:46-67`); without a layout the builder's arguments are
unchanged (`ComplexFilter.ts:154-211`); `-ac` only when channel counts differ; gaps and placeholders share the layout
via `withAudioSlots`; strict validation treats B and T codes as the same language; the web field never blocks saving
when disabled; docs complete.

**Needs work:** a fallback slot repeats the main audio but is labelled with the slot's language, unlogged
(`AudioTrackLayout.ts:63-66`, `FfmpegStreamFactory.ts:628`); the same source in two slots runs the full filter chain
twice including loudnorm (`ComplexFilter.ts:167-176`, measure first); FORK.md migration numbers stale; no recorded
on-device Plex check after the code shipped (FORK.md:924-926 predates it).

### 4. Gap music and now-playing text (~85%)

**Good:** drawtext availability checked with a test; unsupported glyphs give no line rather than boxes; the font is
copied out atomically and re-copied if lost; `bundle.ts:33-36` and `make-bin.ts:64` ship it in the pkg binary with its
OFL licence; fades after loudnorm; every failure falls back to silent placeholder audio with a warning; the text
filter is tested in all four pipelines.

**Needs work:** missing drawtext logged at debug per gap (`FfmpegStreamFactory.ts:1210`); font size from height only
(`NowPlayingTextFilter.ts:34`, `nowPlayingText.ts:17`, picture assumed 1920×1080 at `:1192`) so square or portrait
cards clip; `GapMusicPicker.ts:58` loads every track with relations on the tune-in path; upstream's dead "Soundtrack"
field still shown (`ChannelFlexConfig.tsx:531-537`); `escapeDrawtextValue` duplicates `escapeFilterOptionValue`; no
real-ffmpeg drawtext test and local ffmpeg tests fail rather than skip without a filter; `musicListId` not cleared
when its list is deleted; `flex.md:15-16` paragraph break; FORK.md:2133 stale version.

### 5. HLS session, playlist and tune-in (~85%)

**Good:** `MediaPlaylistReader` uses one handle, anchor-checks both ends, re-parses on shrink, never reads a
half-written entry; `MediaPlaylistIndex.discardSegmentsBelow` bounds memory; equivalence tested against a frozen
oracle (`testing/hls/ReferenceHlsPlaylistTrim.ts`) with randomised playlists; upstream #2288 touched only the
subtitle path, no overlap or duplication; `TranscodeSpeedWatcher` handles stop-during-poll and unrefs its timer;
`ensureSubtitlePlaylist` writes with `wx`; readiness poll tested with fake timers; `SessionStartPts` has a
real-ffmpeg test and subtitle offsets follow it; the three HLS settings are wired end to end and documented.

**Needs work:** speed warning names the boosted thread count (16) not the config's (`HlsSession.ts:386-389,
459-462`; `TranscodeSpeedMonitor.ts:186-193`); the boost lasts the whole program with no off switch
(`readAheadThreads.ts:24-35`) on a host with a hard thread limit; readiness poll doesn't bail on stop and the ENOENT
line is unthrottled (`BaseHlsSession.ts:203-273, :226`); served window 20 / keep-before 10 are segment counts, so 1 s
segments give a 20 s window (`HlsSession.ts:97, :188`); `stream.m3u8` and ffmpeg's in-memory list grow for the
session's life (`hls_list_size 0` + `append_list`, ~5.6 MB rewritten per segment after 24 h at 2 s); `trimPlaylist`,
`parsePlaylist`, `toLines` have no production caller; settings wiring untested; gap tune-in now does three serial
lookups (`ProgramStream.ts:221-228`) and the 1.0 s figure predates gap music; docs say "HLS stream mode" but the
setting also applies to Direct v2 and alt; `injectTimestampMap` comment says PTS starts at 0 (now 90,000);
`transcodeSession!` at `HlsSession.ts:489` (pre-existing).

### 6. `.ts` wrapper (~85%)

**Good:** `+initial_discontinuity` via `-hls_segment_options` in both HLS formats (min ffmpeg 7.1 guarantees it);
`ProbeWindowInputOption` small with named constants and a position test; teardown unpipes and drains after SIGTERM
while still ending the stream for clients, tested with a genuinely blocking writer; `outputSink` hook minimal;
burst gated on ffmpeg support.

**Needs work:** the caption gate (cross-cutting); "first output" info line fires per program in MPEG-TS and HLS-alt
modes (`FfmpegProcess.ts:221-226`); unpipe-on-every-kill drops the stdout tail on a server-initiated stop
(`:267-268`, document or scope); a track with no packets now fails after 15 s instead of at once and the trigger
was never reproduced (FORK.md:446-449).

### 7. FFmpeg pipeline fixes (~75%)

**Good:** `outputFrameRate.ts` is pure and tested, NTSC rates go out as exact fractions; `escapeFilterOptionValue`
is two-pass per ffmpeg's docs with round-trip tests against an `av_get_token` port and survived the #2324 merge in
all four pipelines; `TonemapxFilter.nextState` matches `TonemapFilter`, capability-gated, reachable from VAAPI/QSV
software fallbacks; the 10-bit fix seeds state like the hardware builders; `FfmpegInfo` reads the path live; preset
validated against a known set; Dockerfile pins the jellyfin-ffmpeg sha256 and fails without `tonemapx`.

**Needs work:** `deinterlacerDoublesRate` copies each builder's logic (`FfmpegPlaybackParamsCalculator.ts:178-201`),
e.g. CUDA with an interlaced VC-1 the GPU can't decode falls back to `yadif=1` at 59.94 while `-r 29.97 cfr` drops
fields; nothing tested on hardware (`-r`/`-fps_mode cfr` with GPU frames, QSV `fps`, `tonemapx` after `hwdownload`,
static jellyfin build with GPUs, read-ahead threads); `QsvPipelineBuilder.ts:196-207` dead branch; thread count
reaches only libx264 (`Libx265Encoder.ts:16-34`); preset UI lists up to `medium` while the server accepts
`slow`/`slower`/`veryslow` and shows "veryfast (default)" for them (`TranscodeConfigVideoSettingsForm.tsx:65-80`);
local files use ffprobe `r_frame_rate`, which VFR files report as 60 or 120, and captions pin it
(`FfprobeStreamDetails.ts:80`, `outputFrameRate.ts:65-80`); `SoftwarePipeline.local.test.ts:458` fails without
libass; no local test for the `-r 30000/1001` pin or the side-data strip; Video Preset undocumented.

### 8. Logging and observability (~70%)

**Good:** tune-in lines at info, one or two per tune-in; per-segment caption timing at debug; speed monitor at most
two lines per program; "still waiting" throttled; `CountingPassThrough` doesn't touch flow; no new line logs a
secret; offset fix tested.

**Needs work:** `FfmpegProcess.ts:180-192, :206-208` (and raw stderr at `:120-122`) log ffmpeg's stderr tail at
error, write it to `ffmpeg-error-log-*.log` and `process.stderr` unredacted, and ffmpeg prints input URLs there, so
`X-Plex-Token` leaks. This is upstream's code, unchanged by the fork; the deployment redacts outside the repo. The
args redaction at `:76-79` also misses Emby's `?X-Emby-Token=` query form and `api_key=`, which
`HttpStreamSource.redact` (`stream/types.ts:91-104`) already handles. Also: FORK.md:370 format claim wrong; the
tune-in, close, failed, "HLS session ready" and first-output lines have no route-level tests;
`streamApi.ts:21` import order.

### 9. Scanner worker threads (~85%)

**Good:** every job end path releases the lock, ends progress and drops the abort controller in one place
(`MediaSourceScanCoordinator.ts:309-329`); worker start has a timeout, main-thread fallback, and gives up after 3
failures (`WorkerScanJobRunner.ts:76-138`); jobs re-read their library at start (`ScanJobExecutor.ts:62-82`);
`workerTerminateReleasesLock.test.ts` proves with a real thread that killing a worker mid-write rolls back and frees
the lock; `withImmediateTransactions` is applied once (`DBAccess.ts:141`) and covers all ~32 Drizzle transaction
sites with no Kysely or raw transactions found; the WAL checkpoint no longer blocks; the worker reads the Meilisearch
key and indexes over HTTP with awaited calls; a cancelled custom-show sync leaves content unchanged; the pkg build
starts workers from the entry script upstream's pool workers already use.

**Needs work:** a final `scan-done`/`scan-failed` that fails validation is logged and ignored, the job never ends,
nothing times it out, and the one-at-a-time queue blocks every later scan and sync until restart
(`WorkerScanJobRunner.ts:211-219`); no protocol version in worker messages (`worker_schemas.ts:110-141`); the
worker role is set only when no `workerData` was passed (`TunarrSubprocessService.ts:82`), so a pool-style start
"boots" then ignores the scan; no `error` listener after a job finishes (`WorkerScanJobRunner.ts:259-265, 306-321`)
so late crashes reach only `console.error`; creating a synced show or Sync Now waits behind any running scan
(`customShowsApi.ts:222,320`); "already queued" logged at error (`MediaSourceScanCoordinator.ts:283`); the worker
smoke test never runs in CI or against the pkg binary; PR #1's "after" production measurements never recorded
(main-thread writes can still wait 5 s on the worker's lock, `DBAccess.ts:93`).

### 10. Database and request latency (~85%)

**Good:** connection settings in one tested function (`DBAccess.ts:50-75`); `readIntoFileCache` never throws, is
capped and logged; the guide warmer shares an in-flight read with a 10-minute cooldown; the streamed JSON response
turns an error before the first page into a 500, cuts the connection on a later error so the client never gets a
short list, stops paging on disconnect, and buffers one page, all tested over a real connection
(`tests/libraryProgramsResponse.test.ts`); the page query is prepared once and pages by uuid; the custom-show
lookup reads only ids; perf tests run in CI and pass.

**Needs work:** the 256 MiB private cache with mmap off is forced with no switch or docs (`DBAccess.ts:62-67`), and
SQLite discards the whole private cache whenever another connection commits, which worker scans do per item, so the
cache rarely helps during scans and the file warmer is what actually prevents stalls (FORK.md:274 confirms); the
guide warmer reads the whole DB and WAL with no cap (`databaseFileWarmer.ts:19-20`, deliberate per its comment but
unbounded on a multi-GB DB); the 512 MiB startup read has no opt-out (`bootstrap.ts:87-96`); the page query filters
`library_id = ? AND uuid > ? ORDER BY uuid` with only single-column indexes (`ProgramSearchRepository.ts:23-36`),
unverified query plan; nothing stops a future Kysely or raw transaction from being DEFERRED again; two test style
slips.

### 11. Guide / XMLTV / Plex (~80%)

**Good:** guide written to a temp file and renamed (`XmlTvWriter.ts:162-174`); public media folder matches a strict
name-and-version pattern so nothing outside is served (`PublicMediaService.ts:79-97`), publishes only image bytes
with size and time caps, logs failures without tokens, keys by program not channel, skips basic auth on purpose
with `nosniff`, and only new bytes change an address; the channel-save reuse keys on exact object identity plus
redirect targets and render settings (`TvGuideService.ts:1196-1279`) and a metadata-only save replaces the channel
object; `getDvrs` tells 404 from failure; user docs thorough.

**Needs work:** bug `schedulingUtil.ts:107-120`: hours stop at midnight by design ("every 4 h from 12" gives 12,
16, 20: a 16-hour gap; "every 6 h from 23" runs once a day, locked in by the test at `:64`), and each rebuild
covers only `programmingHours` ahead (12 by default) with nothing extending the guide in between
(`TvGuideService.ts:317-324` only warns), so Plex shows an empty guide for hours each day; no DST test;
`PlexGuideNotifier.ts:150-189` retries 401/403, fixed 5 s delay, a thrown client lookup skips the remaining
servers, `flush()` has no timeout (~6 min per server worst case); retry timer not unref'd or cancelled;
`PublicMediaService.ts:363,405-420` relists the artwork folder per picture with new bytes; temp files in `media/`
never cleaned (`:539-549, 638-646`); reused channels don't refresh "last referenced", safe only because a full
rebuild always happens within 30 days (undocumented); `POST /api/xmltv/flush` undocumented; `xmlTvLinkHost`
alias; uploads depend on a setting labelled for guide pictures.

### 12. Search / smart collections (~90%)

**Good:** index-path names accepted for text fields only, longest match first (`searchUtil.ts:132-178`);
parentheses added only where grouping changes meaning (`:1495-1517`), documented; the fixer is idempotent (moves
pre-keyword filters once, clears exact copies to `''` not NULL); the Meilisearch key is 32 random bytes in an
owner-only file, passed via environment, never logged; workers read and never create it.

**Needs work:** mode 0600 applied only on create and the write isn't atomic (`MeilisearchService.ts:659`); the
local test never runs in CI and nothing covers a keyless index after upgrade (FORK.md:1831 claims it); the key file
isn't in `docs/misc/faq.md` or `docs/configure/system/backup.md`; an unparseable filter with keywords warns on every
start forever (`FixSmartCollectionFIlters.ts:30-36`).

### 13. Build, CI, docs, tooling (~75%)

**Good:** "newest tag moves `:latest`" is correct (`git tag --sort=-v:refname`, so `.18.10` beats `.18.4`);
Dockerfile pins the ffmpeg checksum and copies `.pnpmfile.cjs` in both stages (`.18.3` failed for lack of it,
`.18.4` passed); local tests typechecked in CI; the dev OpenAPI spec (119 paths) and `web/src/generated/sdk.gen.ts`
are in sync including every fork field; scripts have usage headers and `scripts/test-channel/README.md` exists; no
seedbox hostnames or home paths in fork files.

**Needs work:** `docs/generated/tunarr-latest-openapi.json` was hand-edited by one line (commit `09db0a67`) and is
now neither upstream's nor the fork's; that commit says the generator "would not shut down on this box"
(`GenerateOpenApiCommand.ts:43-63`), which the `regen-api` skill depends on; `fork-image.yml:21-23` concurrency
keeps one waiting run, so three quick tags cancel the middle one (no image, no rollback target); `:127` `gh release
create` fails on a re-run; `:31` checkout v6 (upstream on v7); `:6-7` comment says docs workflow disabled but
"Publish Docs" ran on `main`; FORK.md drift and private details (cross-cutting); the loudness prototype branch;
real-binary tests not in CI.

## The plan

### How every task runs

Each task below is one branch, one PR into `oliviacpu/tunarr` `main`, owned end to end by one Opus subagent
(`Agent` with `model: "opus"`, `isolation: "worktree"`), as the user asked on 2026-10-18. The main session
orchestrates, reviews, labels and merges; no release tag until the user asks.

The subagent brief, the same for every task:

1. **Process.** Follow the `agent-engineering:deliver-change` skill: `plan-change` (acceptance criteria from this
   document), `implement-change`, `verify-change` (run the checks), `review-change` (a fresh reviewer, not
   self-review), `remediate-findings` (at most three rounds), `publish-change` (commit, push, PR). Then post
   `@codex review` on the PR and run the `code-review:code-review` plugin on the PR number as a second independent
   pass. The subagent stops at "PR open, CI green, reviews addressed"; merging is the main session's.
2. **Environment first.** `pnpm i && pnpm turbo build` (node_modules is stale). Node 22 via nvm. Local ffmpeg lacks
   drawtext and libass; `pnpm test:local` needs `TUNARR_TEST_FFMPEG` pointing at a jellyfin-ffmpeg build.
3. **Rules.** CLAUDE.md: pnpm only; no `as any`; no inline `import()` types; `!== undefined` for `T | undefined`;
   no unguarded `!`; Drizzle for new queries; every change ships a test that fails without it; docs updated when
   behaviour changes; `pnpm lint-changed`, `pnpm turbo typecheck`, `cd server && pnpm test` green. No deployment
   details (hostnames, paths, script names, media or channel names) in anything committed.
4. **Records.** A FORK.md entry in the existing format (date, what, why, evidence, **Upstream:** line, PR number)
   placed at the top of "Changes in this fork". FORK.md conflicts between parallel tasks: the later PR rebases.
5. **PR.** `gh pr create --repo oliviacpu/tunarr --base main`, the repo's PR template, the attribution footer. Labels:
   the main session sets `approved` or `changes requested`; only `approved` PRs merge.

Parallelism: tasks in the same wave touch different files unless noted ("after Tn"). `HlsSession.ts` and
`FfmpegStreamFactory.ts` are the contention points; tasks that touch them are sequenced.

### Wave 1: bugs and risks (do first)

Status (2026-10-19, evening): wave 1 is merged: T3 #60, T1 #61, T9 #62, T6 #63, T4 #64, T2 #65, T5 #66. In
parallel the user ran Codex on the plan; its PRs merged the same day: #67 T15, #68 T23, #69 T21, #70 T19+T20
(migration 0056), #71 T22, #72 T16 (preset UI) + T14 (Soundtrack field), #73 T24+T25+T28 (`fork-runtime.yml`),
#74 T12+T36, #75 T29+T16+T17+T14 (now-playing sizing). #77 (T7, T8, T10, T18, T31, T33) and #76 (T26 docs) merged too. An independent review of #77 found ten
items (warn-once key embeds per-segment values; NFD combining marks counted as dropped; a contradictory wrapper
log; the read-ahead clause in the speed warning; a missing docs row; a process-wide warn-once set; a `string`
parameter; a double subtitle read on the tune-in path); their fixes merged as PR #79 (`fix/playback-review-round-2`). Found along the way, not fixed: the two
`videoPreset wiring` tests in `FfmpegStreamFactory.test.ts` fail on `main` under `vitest --sequence.shuffle`
(seeds 4 and 7), fixed in PR #80: the cause was a production bug, `FfmpegState`
deep-merging caller fields into the shared `MpegTsOutputFormat`/`StdoutOutputLocation` constants, so one HLS
session rewrote the MPEG-TS format for every later state in the process. Upstream has the same code; a
candidate for an upstream bug report if contribution resumes. T13 was covered by #75. #80 (`FfmpegState` shared-constant bug), #81 (T32, shared audio filter chain:
5% stereo, 16% 5.1 CPU saved) and #82 (T34 report) merged. Released as `oliviacpu-2026.10.19` and deployed on the
user's go. Still open: T11 (needs the log read), T27 (needs the user), T35 (deferred), T37 and T38 (from T34).

| Id | Task | Size | Files | Done when |
|---|---|---|---|---|
| T1 | **One HDHomeRun caption gate for transcode and wrapper** | S | new `server/src/stream/captions/hdhrCaptionsEnabled.ts`; `ConcatStream.ts`; `StreamModule.ts`; `FfmpegStreamFactory.ts:813`; `ConcatStream.test.ts`; `FfmpegStreamFactory.test.ts`; `docs/configure/ffmpeg/index.md:123` | One predicate (setting + HLS mode + `subtitlesEnabled` + `videoFormat === h264`) used by both. An HEVC and an MPEG-2 channel with subtitles on get no `captions=1`, no `CaptionLanguageStream`, and the inserter is never called; both tests fail on current `main`. The per-program info line becomes once per session. |
| T2 | **A program's captions end where the next item starts, and segments carry their own program's language** | S–M | `HlsSession.ts` (`transcode`, `addCaptions`, `captionedSegment`, `captionEntryAt`); `HlsSession.test.ts` | Captions for A (30 s) then B without captions starting at A+10 s: a segment at A+12 s gets padding only. A (jpn) then B (eng): A's trailing segment's PMT says jpn. Both tests fail on current code. |
| T3 | **Subtitle files in Latin-1 / CP1252 keep their accented letters** | S | `ProgramCaptions.ts:282`; `ProgramCaptions.test.ts` | Read as bytes; honour a BOM; decode as UTF-8 when valid, else `windows-1252` via `TextDecoder`. A CP1252 `café` fixture produces `é` in the 608 units; the test fails on current code. Check what the burn-in path does (ffmpeg `charenc`) and match it. |
| T4 | **Guide rebuild hours wrap past midnight** | S | `server/src/util/schedulingUtil.ts`; its test; `xmltvSettingsApi.ts`; `XmlTvSettingsPage.tsx`; `docs/configure/channels/epg.md`; FORK.md:244 | Hours are `(start + k·step) mod 24` sorted; "every 6 h from 23" gives 5,11,17,23; start 0 unchanged; the longest gap never exceeds the interval; DST tests for start hour 2 in America/Chicago on 2026-11-01 and 2027-03-14; the API refuses an interval longer than `programmingHours` or the UI warns. |
| T5 | **Redact media-server secrets in all ffmpeg logging** | M | new `server/src/util/redactSecrets.ts`; `FfmpegProcess.ts:76-79, 120-122, 180-208`; `stream/types.ts:91-104` (reuse); tests | Plex `X-Plex-Token=`, Emby `X-Emby-Token:` header and `?X-Emby-Token=` query, and `api_key=` never reach the logger, the error-log file or `process.stderr`; tests feed real ffmpeg-style stderr lines. Pre-existing upstream behaviour; note it as upstreamable in FORK.md. |
| T6 | **Scan worker watchdog and protocol hardening** | M | `WorkerScanJobRunner.ts`; `worker_schemas.ts`; `TunarrSubprocessService.ts:82`; `ScanWorker.ts`; `StartWorkerCommand.ts`; `MediaSourceScanCoordinator.ts:283`; tests | A malformed final message fails the job; a protocol version in `workerData` and the `started` event, mismatch falls back to the main thread; the role is always set; a worker-lifetime `error` listener logs through the logger; an optional max job time (setting or env, default off) terminates the worker; "already queued" logs at info; each test fails on old code. |
| T7 | **HLS session hardening: accurate speed warning, poll stops with the session** | S | `HlsSession.ts:386-389, 459-462`; `TranscodeSpeedMonitor.ts:186-193`; `BaseHlsSession.ts:203-273`; tests — *after T2* | A read-ahead transcode that falls behind names the config's own thread count and says read-ahead was active (test with `realtime: false`); a session stopped while waiting resolves within one poll; the ENOENT line is throttled with `ReadyLogEvery`. |
| T8 | **Read-ahead thread cap as a setting** | M | `types/src/schemas/settingsSchemas.ts`; `readAheadThreads.ts`; `HlsSession.ts`; `FfmpegSettingsPage.tsx`; `docs/configure/ffmpeg/transcode_config.md`; regen API — *after T7* | `hlsReadAheadMaxThreads`, 0 disables, default 16, tests for 0/4/16; the deployment's thread limit is the stated reason. |
| T9 | **Plex guide notifier: error classes, backoff, bounded flush** | M | `PlexGuideNotifier.ts:91-101, 150-189`; `api/index.ts:279-282`; tests | 401/403 are not retried and log one hint; one failing server doesn't skip the others; exponential backoff; `flush` gives up after 30 s; timers unref'd and cleared at shutdown. |
| T10 | **Caption failures are visible, hot path cleaned** | S–M | `HlsSession.ts:605, 637-642, 662-675`; `Cea608Encoder.ts:204`; `FfmpegStreamFactory.ts:841`; `BasicChannelRepository.ts:133-151`; `streamApi.ts:414-418`; `FfmpegProcess.ts:221-226`; tests — *after T2, T7* | Warn once per session per refusal reason; a dropped-character count per program above a threshold; `toReversed()` and the spread rebuild replaced by index loops; "Could not caption segment" rate-limited; `captionsToColumn` calls `normalizeChannelCaptions`; `loadCaptions` takes a required track; the first-output info line only for the wrapper. |

### Wave 2: quality, gaps, docs

| Id | Task | Size | Files | Done when |
|---|---|---|---|---|
| T11 | **Segment caption cache** (measure first) | M | `HlsSession.ts:620`; tests — *after T10*; needs the user to read a day of per-segment timing from the deployment log (debug level) | One rewrite per segment regardless of viewers; cached `Buffer` keyed by file name, evicted with `deleteOldSegmentFiles`; bounded by segment count; a test counts one `insertCaptions` for three requests. Skip if the log shows rewrites under a few ms. |
| T12 | **Sidecar subtitles: SDH on embedded tracks, case-insensitive local matching, tidy** | S–M | `ProgramStreamDetailsFetcher.ts:137`; `LocalSubtitlesService.ts:38-48`; `SubtitleExtractorTask.ts:59-67, 382, 428, 494`; `ExternalSubtitleDownloader.ts:51-60`; `MediaSourceScanner.ts:87,102`; tests | SDH taken from the matching `program_subtitles` row by index (regular wins over SDH, test fails on old code); `Movie.MKV` + `movie.en.srt` match; one message builder; `isInsideFolder` tested; the hides-paths flag per library. |
| T13 | **Switchable audio: log fallback slots, fix docs and FORK numbers** | S | `AudioTrackLayout.ts:63-66` or `FfmpegStreamFactory.ts:616-630`; `docs/configure/channels/transcoding.md`; FORK.md:733, :930; tests | A program missing `jpn` logs once per program that the slot repeats the main track under the slot's label; docs say so plainly; migration numbers corrected. |
| T14 | **Now-playing text fits any picture; drawtext absence is visible; dead Soundtrack field** | M | `NowPlayingTextFilter.ts:8-10, 34`; `nowPlayingText.ts:17`; `FfmpegStreamFactory.ts:1192, 1210`; `ChannelFlexConfig.tsx:531-537`; new `NowPlayingTextFilter.local.test.ts`; `SubtitleFilter.local.test.ts`; `SoftwarePipeline.local.test.ts:458`; `docs/configure/channels/flex.md:15`; FORK.md:2133 | `fontsize=min(h/30, w/34)` and a 1080×1080 test keeps the longest line inside; `escapeDrawtextValue` replaced by `escapeFilterOptionValue`; a local test runs quotes, `:`, `%`, `\` and Japanese through real ffmpeg and skips when drawtext is missing; the libass tests skip, not fail; missing drawtext logs at info once per ffmpeg path; the Soundtrack field is removed or redirected to Gap music; docs fixed. |
| T15 | **Lightweight gap-track query** | S–M | `IFillerListDB` + `FillerListDB.ts:329-354`; `GapMusicPicker.ts:58`; tests | A query returning only uuid, type, duration, state and artist name; timed against ~5,000 tracks in a test; `musicListId` cleared or validated when its list is deleted (`StreamProgramCalculator.ts:102-118`). |
| T16 | **FFmpeg pipeline small fixes: libx265 threads, preset UI and docs, QSV dead branch** | S–M | `Libx265Encoder.ts:16-34`; `BasePipelineBuilder.ts:858-863`; `TranscodeConfigVideoSettingsForm.tsx:65-80`; `QsvPipelineBuilder.ts:196-207`; `docs/configure/ffmpeg/transcode_config.md`; FORK.md:2188; `docs/configure/ffmpeg/index.md:10`; tests | libx265 gets the thread count (`-x265-params pools=N` or `-threads:v`); every server-accepted preset is listed and a stored `slow` displays as `slow`; Video Preset documented, FORK's timing claim fixed, a fork note on jellyfin-ffmpeg in `index.md`; the dead branch gone. |
| T17 | **Frame-rate source for variable-rate local files** | M | `FfprobeStreamDetails.ts:80`; `outputFrameRate.ts:65-80`; tests | Prefer `avg_frame_rate` when it disagrees with `r_frame_rate`; the 48→59.94 case still passes; a VFR fixture reporting 120 pins 29.97 or 59.94, not 120. |
| T18 | **HLS settings wiring tests, docs, retire the test-only playlist API** | S | `SessionManager.test.ts`; `FfmpegStreamFactory.test.ts`; `HlsPlaylistMutator.ts:36-61`; `MediaPlaylistIndex.ts:283-309`; `testing/hls/`; `docs/configure/ffmpeg/index.md`; `streamApi.ts:29-33`; FORK.md | Segment seconds, initial count and burst asserted from settings to session and wrapper state; `trimPlaylist`/`parsePlaylist`/`toLines` live under `testing/`; docs name Direct v2 and alt; the PTS comment says 90,000; a FORK note on porting upstream trim changes into `trimIndex` and the oracle. Also derive the served window and keep-before from seconds (`HlsSession.ts:97, :188`) or document the effect. |
| T19 | **Database cache, mmap and warm-up become switches, with a cap** | M | `DBAccess.ts:62-67`; `databaseFileWarmer.ts:19-20`; `readIntoFileCache.ts`; `bootstrap.ts:87-96`; `util/env.ts`; `docs/getting-started/run.md`; `databaseFileWarmer.test.ts:11`; `ProgramDB.test.ts:2933` | Three env vars (cache size, mmap size, warm-up cap with 0 = off) read and documented; defaults keep today's behaviour; the warmer skips above the cap and logs it; the two test style slips fixed. Record in FORK.md that the private cache is emptied by every worker commit, so a re-measure with mmap on is pending (user). |
| T20 | **DB hygiene: page query plan, DEFERRED guard** | S | `ProgramSearchRepository.ts:23-36`; a test running `EXPLAIN QUERY PLAN` on a seeded DB; `.oxlintrc.json`; CLAUDE.md | A composite `(library_id, uuid)` index via the `new-migration` skill only if the plan shows a sort; a lint rule or restricted-syntax check against Kysely or raw `transaction()`; a CLAUDE.md line. |
| T21 | **Custom-show Sync Now doesn't block behind a running scan** | M | `customShowsApi.ts:222,320`; `MediaSourceScanCoordinator.ts`; the web custom-show page; `tests/customShowSync.test.ts` | With a job running, create and Sync Now answer within 2 s with `isSyncing: true`; the UI polls; the idle path is unchanged. |
| T22 | **Public media folder: one listing per publish, temp cleanup, docs** | S | `PublicMediaService.ts:363, 405-420, 539-549, 600, 638-646`; `TvGuideService.ts:1250-1279` (comment); `XmlTvWriter.ts:95`; `api/index.ts`; `docs/configure/channels/epg.md`; tests | A test counts at most 2 folder listings for 100 new pictures; temp files older than an hour under `media/` are removed; the 30-day invariant is a comment; `POST /api/xmltv/flush` documented; `xmlTvLinkHost` removed in favour of `publicLinkOrigin`. |
| T23 | **Meilisearch key: atomic write, docs, CI upgrade test** | M | `MeilisearchService.ts:659`; `MeilisearchService.local.test.ts`; `docs/misc/faq.md`; `docs/configure/system/backup.md`; `.github/workflows/main.yml` (a job using `server/scripts/download-meilisearch.ts`); `FixSmartCollectionFIlters.ts:30-36` | Key written to a temp file with mode 0600 and renamed; an existing loose file gets its mode fixed; a keyless-index-then-restart test passes in CI; the key file is in the backup docs; the unparseable-filter warning fires once. |
| T24 | **Restore upstream's `latest` spec and fix the generator hang** | S–M | `docs/generated/tunarr-latest-openapi.json` (`git checkout upstream/main -- …`); `GenerateOpenApiCommand.ts:43-63` | The file matches upstream; `pnpm generate-openapi` exits on its own with the dev spec unchanged; the `regen-api` skill works without a manual kill. |
| T25 | **Image workflow fixes** | S | `.github/workflows/fork-image.yml:6-7, 21-23, 31, 127`; `docs.yml` | Concurrency block removed (the newest-tag check already prevents races); a re-run edits an existing release instead of failing; checkout v7; the docs comment is accurate or `docs.yml` is disabled. Verify with a dry run on a throwaway tag only if the user approves a tag push. |
| T26 | **FORK.md, docs and privacy cleanup** | S–M | FORK.md:9, :29-33, :370, :733, :821, :930, :1208, :1243, :1898-1899, :1976, :2133; `plans/channel-save-guide-reuse.md:9,15`; `XmlTvWriter.ts:286`; `plans/closed-captions-review-2026-10-18.md:243`; `docs/configure/ffmpeg/index.md:123` | Every stale claim fixed; every entry has an **Upstream:** line and a PR or commit reference; no media titles, artist names, private script names or channel names remain; the review's status line records #56 and #58. Keep the lines the user wants (ask only about the channel name, which is borderline). |
| T27 | **Archive the loudness prototype** | S | branch `prototype/loudness-fixed-gain` (`ef57c0b4`); `plans/loudness-measured-once.md:3` | An annotated tag `archive/loudness-fixed-gain-2026-10-17` pushed; the plan points at it; the branch deleted locally and on origin. **Needs the user's explicit go, since it pushes a tag and deletes a remote branch.** |
| T28 | **Real-binary tests in CI** | M | `.github/workflows/main.yml` or a new nightly workflow; `fork-image.yml`; `server/scripts/worker-smoke-test.ts` | A nightly or on-label job runs `pnpm test:local` with jellyfin-ffmpeg 8.1.3 and Meilisearch; the built image runs a local scan and CI fails unless the log shows `"worker":true` and the programs are saved. |

### Wave 3: larger work and decisions

| Id | Task | Size | Files | Done when / decision |
|---|---|---|---|---|
| T29 | **The pipeline reports its output frame rate** | L | pipeline builders; `FfmpegPlaybackParamsCalculator.ts:178-201`; `FfmpegStreamFactory.ts`; `outputFrameRate.ts`; per-builder tests — *after T17* | Captions are laid out at the rate the built pipeline reports (from `FrameState` after the deinterlace step); `deinterlacerDoublesRate` is deleted; a test per builder, including the CUDA software-fallback case. This closes the "A4" item from yesterday's review and the #38 churn. |
| T30 | **Caption label from the chosen track's language** | M | `CaptionLanguageStream.ts`; `ConcatStream.ts:23,44`; `StreamModule.ts:92`; `HlsSession.ts:624-628` — *after T2* | **Decision first:** does Plex re-read a changed PMT label mid-session? If yes, label per segment from the segment's entry (T2 already does this in the PMT path); if no, label the session from the first program's chosen track. A channel captioning from a `jpn` fallback is labelled `jpn`. |
| T31 | **Gap tune-in: parallel lookups, re-measure** | S–M | `ProgramStream.ts:221-228`; stream-repro | Gap music, font and picture resolved concurrently; the 1.0 s figure re-measured with gap music on and recorded at FORK.md:642. |
| T32 | **Audio: measure, then share the filter chain between repeated sources** | M | `ComplexFilter.ts:167-176`; `BasePipelineBuilder.test.ts`; stream-repro | With `eng, jpn` on an English-only program and loudnorm on, one `loudnorm` in the command (`asplit` after the filters); stream-repro still shows matching tracks. Skip if the measured CPU difference is under 5%. |
| T33 | **Non-Latin captions fall back to burn-in** | M | `Cea608Encoder.ts:204-216`; `FfmpegStreamFactory.ts` (track choice) — *after T10* | When more than a threshold of a program's cues would lose characters, the program burns in instead and logs why once; tested with a Japanese SRT. |
| T34 | **Investigate `stream.m3u8` growth** (report only) | L | a dated report in `plans/` | Measured write volume and ffmpeg memory at 12–24 h with 2 s segments, and a design (e.g. a bounded `hls_list_size` with Tunarr's index keeping the history) before any code. |
| T36 | **Subtitle charset for downloaded and burned-in subtitles** (follow-up from T3, PR #60) | M | `ExternalSubtitleDownloader.ts:159`; the Plex, Jellyfin and Emby clients' subtitle fetch (raw bytes instead of text); `SubtitleFilter.ts` (`charenc=`); tests — *after T12* | A Windows-1252 subtitle served unconverted by the media server keeps its accents in the cached copy; burn-in passes the detected encoding as `charenc` so ffmpeg no longer drops non-UTF-8 lines (T3 found burn-in dropped them all along); a local-ffmpeg test burns a CP1252 line. |
| T37 | **Playlist reader keeps history by segment number** (from T34, `plans/hls-playlist-growth-2026-10-19.md`) | M | `MediaPlaylistReader.ts`; `MediaPlaylistIndex.ts`; `MediaPlaylistReader.test.ts`; `HlsPlaylistMutator.test.ts` | The reader anchors on segment numbers so it can read a sliding window (`MEDIA-SEQUENCE` = first entry, no `DISCONTINUITY-SEQUENCE` in the file) and keeps its own history; a windowed oracle test against `ReferenceHlsPlaylistTrim` passes for L in 5..40 and fails on today's reader; behaviour-neutral with `hls_list_size 0` (existing randomised tests unchanged); per-request read stays under 8 KiB. |
| T38 | **Bound ffmpeg's HLS list to 15 minutes of segments** (after T37) | S | `HlsOutputFormat.ts`; `HlsDirectOutputFormat.ts`; `HlsSession.getHlsOptions`; new `HlsAppendWindow.local.test.ts`; `repro.mjs` continuity poller | `-hls_list_size` = 15 min / segment seconds (450 at 2 s), `append_list` kept, `delete_segments` off; a real-ffmpeg local test pins numbering and `MEDIA-SEQUENCE` across a restart on 7.1/8.x/9.x (goes in the T28 CI job); the 30-minute stream-repro check in the report passes its five criteria. Measured today: 2 s segments rewrite ~136 GB/day and jellyfin-ffmpeg 8.1.3 holds ~585 MB per program after 24 h; on ffmpeg 7.1 program starts grow quadratically (54–76 s at 24 h). |
| T35 | **Hardware pipeline verification** | M–L | VAAPI, QSV, NVIDIA `*.local.test.ts` | **Deferred.** The deployment has no GPU and no GPU host is known. Schedule only if one appears; until then, T29 removes the main hardware-specific risk. |

### User tasks (no code, nothing to delegate)

- Watch the test pattern on channel 99 on the Apple TV and Plex Mac; record per-sample results in
  `docs/configure/ffmpeg/index.md`. This unblocks appearance plan step 2 and the "works in Plex" labels.
- Run the CC2/CC3 second-track experiment (`plans/test-channel-99.md`).
- Check switchable audio on the Apple TV: per-account language, a fallback program, a gap. Record in FORK.md.
- Grep one day of the deployment log (through the box's redaction pipeline) for: the subtitle refresh and heal lines
  (T12's evidence, FORK.md:858); the per-segment caption timing at debug (T11's go/no-go); any "Could not set up the
  font" warning (the pkg font copy); forced-scan stall numbers with `probe-latency.mjs` (FORK.md:1208, PR #1's
  "after").
- Decide on the uncommitted `.claude/settings.json` line allowing `gh pr merge`.
- Approve or decline T27 (tag push plus remote branch delete).

### Not recommended now

- Upstream contribution: tabled by the user on 2026-10-18; the readiness list in yesterday's review still applies and
  T1, T2, T29 and the quiet period come first.
- Splitting FORK.md into one file per entry (would cut merge conflicts, but it is the user's changelog format).
- Bounding `stream.m3u8` before T34's measurements.

## Verification

- Per task: the acceptance test fails on `main` before the change and passes after; `pnpm lint-changed`,
  `pnpm turbo typecheck`, `cd server && pnpm test` green; CI Build green on the PR; Codex and the `code-review`
  plugin pass with findings addressed; the FORK.md entry present; the main session sets `approved` and merges.
- Stream-level evidence where behaviour changes on the wire, with the `stream-repro` skill: T1 (HEVC channel with
  captions on shows burned-in subtitles and no A53 captions in the capture), T2 (program A then captionless B, no A
  dialogue after the join), T3 (CP1252 sidecar shows accented letters), T14 (now-playing line on a square card),
  T31 (gap tune-in timing), T32 (track layout unchanged).
- After wave 1 merges: one release tag when the user asks, then a day of the deployment log (redacted) to confirm
  no new warn-level noise from T10 and that T5 leaves no token in `ffmpeg-error-log-*.log`.
- The whole-fork `code-review` pass is re-run after wave 2 to confirm the ten findings are closed.
