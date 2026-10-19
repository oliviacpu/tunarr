# Closed captions in the fork: review and upstream readiness (2026-10-18)

## Context

Between 2026-10-13 and 2026-10-18 the fork went from "Plex Live TV can't toggle subtitles" to CEA-608 closed captions
in the HDHomeRun `.ts` stream with exact frame timing, a language label, styling and placement from the subtitle file,
overlap handling, an appearance settings surface with a 39-sample test pattern, and per-channel settings for a test
channel. Fourteen of the fork's 51 PRs are caption work, and another six fixed things captions exposed (frame rate,
continuity counters, forced flags, filter escaping).

The user asked for a whole-picture review on two questions: where it can still improve, and when it would be
significant enough to contribute to chrisbenincasa/tunarr. This document is that review. The "plan" part is the
ordered list of follow-ups at the end; nothing here changes code until approved.

Sources: every caption entry in `FORK.md`, the plan docs in `plans/`, a read-only map of the code, and upstream's
issue tracker and contribution policy as of today.

## What exists

| Part                                                                                                                     | Where                                                                                      | Size                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Text → 608 encoder: character sets, styles, placement, overlaps, pop-on/roll-up/paint-on, keyframe-aware scheduling      | `server/src/stream/captions/Cea608Encoder.ts`                                              | 1,726 lines, ~97 tests + golden snapshot |
| TS segment rewriter: A/53 SEI per frame, PES re-split, continuity counters, PMT descriptors                              | `MpegTsCaptionInserter.ts`                                                                 | 678 lines, 11 tests                      |
| Slot → frame mapping that survives missing or doubled frames                                                             | `pairsForFrames.ts`                                                                        | 77 lines, 7 tests                        |
| Cue parsing (SRT/VTT/ASS), track choice, "No captions" notice, playlist marking                                          | `ProgramCaptions.ts`                                                                       | 445 lines, 29 tests                      |
| PMT language relabel on the wrapper's output                                                                             | `CaptionLanguageStream.ts`                                                                 | 68 lines, 6 tests                        |
| Test pattern, per-channel merge                                                                                          | `CaptionTestPattern.ts`, `channelCaptions.ts`                                              | 243 lines, 15 tests                      |
| Wiring                                                                                                                   | `FfmpegStreamFactory.ts` (+434), `HlsSession.ts` (+328), `streamApi.ts`, `ConcatStream.ts` | ~37 integration tests                    |
| Settings: global on/off, alignment, appearance (13 fields), test pattern; per-channel `captions` column (migration 0054) | `types/src/schemas/settingsSchemas.ts`, `channelSchema.ts`                                 |                                          |
| Web: shared appearance fields, channel section with Copy to all / Reset                                                  | `CaptionAppearanceFields.tsx`, `ChannelCaptionsField.tsx`                                  | ~580 lines, 16 tests                     |
| Real-ffmpeg round trip                                                                                                   | `CaptionInsertion.local.test.ts` (runs only via `test:local`)                              | 10 tests                                 |

Code quality: no `as any`, no lint suppressions, no unguarded `!` in the caption modules. Every entry in `FORK.md`
names a test that fails without its fix.

### What has been verified, and what hasn't

Verified end to end with stream-repro and FFmpeg's own 608 decoder (the family Plex's decoder comes from):

- captions on every frame, each equal to its cue, on the frame, through program and segment joins;
- tune-in: no fragment of a loading caption, no flash of a cue's tail;
- language label "English" in Plex's CC menu on the Apple TV (2026-10-14);
- box colour holding to the end of a caption in jellyfin-ffmpeg 8.1.3.

Not verified:

- **What Plex honours of the appearance options.** The test pattern exists to answer this, channel 99 carries it,
  but the Apple TV and Plex Mac viewing is still open (`plans/hdhr-caption-appearance.md` step 2, the "works in
  Plex" labels and the preview, is blocked on it). `FORK.md` still says "untested until the test pattern is watched".
- **The CC2/CC3 second-track experiment** (`plans/test-channel-99.md`).
- **Hardware pipelines end to end.** The output frame rate for VAAPI/QSV/CUDA is worked out by mirroring each
  builder's choices, not reported by the pipeline (`FORK.md`, "Still open"). Only the software pipeline has been
  checked with a capture.
- **Any player other than Plex.** Jellyfin and Emby read Tunarr as an HDHomeRun too.

## Where to improve

Ordered by what I'd do first. Each item names the file so it can become its own small PR into the fork.

### A. Correctness gaps found in this review

1. **HEVC or MPEG-2 output silently loses subtitles.** `captionsOn` (`FfmpegStreamFactory.ts:806-812`) checks the
   setting, the stream mode and the channel's subtitles flag, but not the transcode config's video format. When a
   text track is chosen for captions, the burn method switches to the WebVTT sidecar (`:660-664`). Then the inserter
   refuses every segment because the stream type isn't H.264 (`MpegTsCaptionInserter.ts:420-425`), logged only at
   debug. Plex gets neither burned subtitles nor captions. Fix: gate on `playbackParams.videoFormat === H264` before
   loading captions, so other formats keep burn-in; test in `FfmpegStreamFactory.test.ts`. Document the limit.
2. **The real-ffmpeg test is broken and nothing runs it.** `CaptionInsertion.local.test.ts:66,154,244,453` still pass
   `pairForPts`, an option replaced by `pairsForFrames` in PR #39. The file is excluded from `pnpm test`
   (`server/vitest.config.ts:22`) and from typecheck (test files are excluded from `tsconfig.build.json`), so CI can't
   see it. Fix the four call sites; consider a typecheck config that covers `*.local.test.ts` so this can't recur.
3. **Every HLS channel's segments are rewritten when the global switch is on**, including channels with subtitles
   off: `ConcatStream.captioned` (`ConcatStream.ts:26-28`) looks at the mode and the setting only, so the wrapper asks
   for `captions=1` and each segment goes through the inserter to carry padding. Harmless to viewers, wasted CPU on a
   shared server. Fix: pass `channel.subtitlesEnabled` into the gate.
4. **Let the pipeline report its output frame rate.** The follow-up already named in `FORK.md`: the builder knows
   whether it deinterlaced at field rate or fell back to software decoding; the caption layout should take the rate
   from it instead of predicting it. The 1% spacing check protects viewers today, but a hardware user would get
   padding-only captions with one warning line and no obvious cause.

### B. Performance (measure before changing)

Nothing here is known to hurt on the deployment, and no unbounded cache was found. These are the costs on the hot
paths, for when a capture or profile says they matter:

- **Per segment request**, synchronous in the Fastify handler and never cached: a full TS parse, one object per
  188-byte packet, a byte-by-byte NAL scan, fresh buffers for every re-split, several full passes and a final concat.
  Two viewers of a channel do it twice; the output is deterministic, so a small LRU keyed on segment path plus
  timeline version would halve it. First step: log the rewrite time per segment at debug and read it off a day of the
  deployment's log.
- **Per program start**, synchronous and before ffmpeg is spawned, so on the tune-in path: read and parse the whole
  subtitle file (the fallback loop may read several), then build the whole program's schedule. `layoutCaption`
  recomputes a line's width per word; `clearBetween` is O(captions × clears) when a box colour is set. Likely tens of
  milliseconds for a film, worth a timing log before deciding.
- **`CaptionLanguageStream`** copies every chunk of the whole `.ts` stream and recomputes a bitwise CRC per PMT. Fine at
  one stream; worth a look if the server ever carries many.
- `#captionTimeline` keeps the last 10 programs' schedules as Maps of every non-padding pair. Capped by count, not
  bytes; a feature film with dense subtitles is tens of thousands of entries. Acceptable, just note it.

### C. Features and limits still open

- **Record the Apple TV and Plex Mac test pattern results**, then finish step 2 of the appearance plan: the "works in
  Plex" labels and the ffmpeg-rendered preview. Until this is done the appearance settings are a research surface, not
  a feature, and the docs say so.
- **CC2/CC3 second track** experiment, per the test channel plan.
- **Non-Latin text is dropped** (`Cea608Encoder.ts:210`). Transliteration beyond the extended table is possible but
  608 fundamentally can't carry CJK; a per-program fallback to burn-in when most cues would be lost is the realistic
  improvement.
- **The caption language is the first language preference**, not the chosen track's language. Right for the
  deployment; wrong for a channel whose fallback track is in another language. The track's language is known at
  selection time and could travel with `ProgramCaptions.language`.
- **Once captions are chosen, nothing ever burns in again.** A frame-spacing mismatch or a refused segment serves the
  segment without caption text. Correct as a fail-safe; just make sure the one warning per program is loud enough.
- **QSV's one-second keyframes** aren't planned around by the keyframe-aware loader (documented).
- **hls_direct modes and `mpegts` mode** get no captions (documented, by design).

### D. Housekeeping

- `FORK.md:219-226`: the "Tuning in no longer puts the rest of a loading caption on screen" entry has duplicated,
  garbled lines left by a formatter. Clean it before anyone reads it as a changelog.
- `exactFrameRate` (`ProgramCaptions.ts:31-51`) is used only by its tests; production uses `outputFrameRate.ts`. The
  hls_direct_v2 keyframe branch in `HlsSession.ts:561-564` is unreachable because captions are never built for copied
  video. Remove both or say why they stay.
- `web/src/helpers/channelCaptions.ts` re-implements the server's merge in `channelCaptions.ts`; move the pure part
  to `@tunarr/shared` so the two can't drift.
- The golden snapshot (`__snapshots__/cea608-defaults.txt`, 3,942 lines) counts as non-test code under upstream's
  policy bot (it matches neither the test nor the generated pattern). Fine in the fork; relevant to the next section.

## Upstream: tabled (user, 2026-10-18)

The user decided to keep the work fork-only for now. The notes below stay as the record of what contributing would
take, for whenever the question comes back. Nothing in this section is planned work.

### Facts that bound the decision

- **You're an outside contributor** (`oliviacpu` is not in `.github/CODEOWNERS`), so the bot and the policy apply in
  full: a `design approved` issue before code for any PR with a migration, a new shared type, a new settings area, or
  more than 500 non-test / 1,500 total lines; at most 5 open PRs; an "AI use" section that matches the commit trailers;
  and you must be able to answer review questions about every line without an AI.
- **Size.** The caption-scoped diff is about 11,100 non-test lines plus 6,500 test lines (the encoder alone, with its
  snapshot, is about 5,700 non-test). This can't go up as one PR under any reading of the policy; it needs a design
  issue and a split.
- **Upstream has no caption work at all.** No issue or PR mentions CEA-608 or closed captions. The nearest request is
  #1480, "expose multiple audio tracks and soft subtitle options to the viewer in Live TV" (open, `idea`, 4 👍, 7
  comments). The maintainer's position there, 2026-06-02: a continuous channel would have to list every possible
  rendition in the master playlist, which is "infeasible", tracked as #2185. Captions inside the video stream sidestep
  exactly that problem, which is the one-paragraph case for the approach. Demand measured in reactions is small
  (about 9 👍 across the five related issues).
- **Conflict risk is real.** Live upstream `main` is 21 commits past the local `upstream/main` ref. It touches
  `HlsPlaylistMutator.ts` (#2288, which the fork also changes by 372 lines), `SubtitleFilter.ts` (#2324), and adds
  migration `0053_real_raza.sql`, which collides with the fork's `0053` and sits next to the caption `0054`. Open
  upstream PRs #2134 and #2190 touch `HlsSession.ts`; the maintainer's #1874/#1876 touch subtitle selection and add
  yet another `0053`. The fork needs `git fetch upstream && git merge upstream/main` and the
  `resolve-drizzle-migrations` skill soon regardless of any contribution.
- **The caption path depends on four other fork changes** that upstream doesn't have: the standard output frame rate
  (`outputFrameRate.ts`, `pinFrameRate`), `SessionStartPts`, `+initial_discontinuity` through `-hls_segment_options`,
  and the `outputSink()` hook on the stream sessions. Each is a bug fix on its own terms and would have to land first.

### What "significant enough" should mean

I'd treat the work as ready to propose when all of these hold:

1. **It has stopped moving.** Ten of the fourteen caption PRs are fixes to the previous ones, the last on
   2026-10-18. Two to three weeks on the deployment with no caption-related fix is the signal that the design is
   settled. A design issue written while the timing model is still changing will be reviewed against code that no
   longer exists.
2. **The Apple TV test pattern results are recorded** and the defaults follow them (for example whether `apart`
   becomes the overlap default). A reviewer will ask "what does Plex actually show", and today the answer is "we
   built the instrument to find out".
3. **The codec gate (A1) is fixed**, so turning the feature on can never remove subtitles a viewer had.
4. **It works on more than one player and one pipeline.** At least one hardware pipeline captured end to end, and a
   look at Jellyfin or Emby as the HDHomeRun client. Upstream's users are mostly not on this deployment's exact
   setup.
5. **The prerequisite fixes are already upstream** (next section), so the caption PRs are about captions.

None of these is far off. Items 2–4 are days of work; item 1 is a waiting period that starts after the last fix.

### How it would split, if and when

Each of these stands alone and is reviewable on its own. Line counts are rough non-test lines.

**Phase 0, no design issue needed: bug fixes captions depend on or exposed.** Each goes straight to issue then PR,
each under 500 lines, each already has a test that fails without it:

- forced flag kept on embedded subtitle streams, with the backfill fixer (PR #44);
- `+initial_discontinuity` passed through `-hls_segment_options` (part of PR #41);
- filter option value escaping for burned-in subtitle paths (PR #40). Note upstream's #2324 changed
  `SubtitleFilter.ts` since; rebase first;
- `subs.m3u8` written before an HLS Direct v2 program starts (PR #6);
- the first program's output clock starting at an exact offset (`SessionStartPts`, PR #18). This one changes the
  WebVTT timing of upstream's own sidecar feature too, which is a selling point;
- the standard output frame rate and the "Normalize Frame Rate" fix. This is the largest and the one most likely to
  get design questions, because it changes every transcode's `-r` when the source rate isn't standard.

Doing phase 0 alone shrinks the fork and is worth it even if the captions never go.

**Phase 1: design issue.** "CEA-608 closed captions in the HDHomeRun stream." Problem (#1480's ask, why the master
playlist can't carry it), approach (encode on Tunarr's own H.264 output, after the encoder, in TypeScript),
rejected alternatives (DVB bitmaps, teletext, libcaption addon, a custom ffmpeg filter, inserting into the source),
what changes, and the PR plan below. Use `.github/ISSUE_TEMPLATE/design_proposal.yaml`. The user writes and defends
it; this document is the source material.

**Phase 2: PRs under the approved design**, in order:

- **2a. Encoder and inserter**, pure modules with their tests and the golden snapshot, no wiring. ~2,400 lines plus
  the snapshot, so covered by the design issue rather than the size limit.
- **2b. Wiring and the on/off switch**: `FfmpegStreamFactory` track choice and burn policy, `HlsSession` layout and
  segment route, `streamApi`, `ConcatStream`, `CaptionLanguageStream`, the "No captions" notice, the global setting
  and alignment, docs. This is the feature as a user sees it.
- **2c. Placement and overlaps** (ASS styles, `\pos`, stacking).
- **2d. Appearance settings and the test pattern**, only after the Plex results are in and with the preview.
- **2e. Per-channel caption settings** (migration). Honestly, this one serves the test channel and may never be
  wanted upstream; keep it fork-only unless the maintainer asks.

### My recommendation

Not yet, and not all of it. The core (2a + 2b, with phase 0 underneath) is a real feature nobody else has built and
it answers an open upstream request in a way the maintainer said he couldn't. That's worth proposing once the
readiness list is met, probably in a few weeks. The appearance surface, test pattern and per-channel settings are
tools for finding out what Plex does; they can stay in the fork.

Phase 0 can start whenever you like, piece by piece, with no design issue and no commitment to the rest. It's the
lowest-anxiety way to find out how the maintainer reviews, and every piece it lands makes the eventual caption PRs
smaller.

## The plan: fork-only follow-ups

Each its own branch and PR into `oliviacpu/tunarr` (CI, Codex review, own review, then merge; no release until the
user asks), in this order:

1. **A1** codec gate: captions only for H.264 output; other formats keep burn-in. `FfmpegStreamFactory.ts`
   (`captionsOn`/`loadCaptions`), a test for HEVC with captions on, a docs line, a `FORK.md` entry.
2. **A2** fix the four `pairForPts` call sites in `CaptionInsertion.local.test.ts`; run `test:local` with
   jellyfin-ffmpeg; add a typecheck config that covers `*.local.test.ts`.
3. **A3** pass `channel.subtitlesEnabled` into `ConcatStream.captioned`; test in `ConcatStream`/`StreamModule` tests.
4. **D** clean `FORK.md:219-226`; remove `exactFrameRate` and the unreachable hls_direct_v2 branch; move the channel
   caption merge to `@tunarr/shared`.
5. **B** add debug timing for the per-segment rewrite and the per-program schedule build; read a day of the
   deployment's log before deciding on a cache.
6. Merge live `upstream/main` and resolve the `0053` migration collision with the `resolve-drizzle-migrations` skill.
7. Copy this file to `plans/closed-captions-review-2026-10-18.md` as the point-in-time record.

**Status (2026-10-18):** items 1-3 are done: item 1 in #53, item 2 in #55, item 3 in #54. Items 4 and 7 are #57.

Waiting on the user, not code: watch the test pattern on the Apple TV and Plex Mac and record the per-sample result
in `docs/configure/ffmpeg/index.md`; then the CC2/CC3 experiment and step 2 of the appearance plan (labels and
preview).

## Verification

- Items 1–4: `cd server && pnpm test`, `pnpm lint-changed`, `pnpm turbo typecheck`; the golden snapshot unchanged;
  for A1 a stream-repro run with the transcode config set to HEVC and captions on shows burned-in subtitles and
  `hasA53Captions` absent from the capture.
- Item 2: `TUNARR_TEST_FFMPEG=<jellyfin-ffmpeg> pnpm test:local` passes all 10 caption tests.
- Item 5: the debug lines appear per segment and per program on a stream-repro server.
