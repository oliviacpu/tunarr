# Captions follow subtitle placement, and overlapping subtitles show together

## Context

Tunarr's CEA-608 closed captions (what Plex Live TV shows) put each subtitle at the top or the bottom, and nothing
else. Only an inline `{\an7-9}`/`{\a5-7}` tag means top. ASS styles, exact positions (`\pos`, `\move`), middle and
left/right placement are ignored. When two subtitles overlap in time, the later replaces the earlier, which never comes
back. The user asked for captions to follow where the files put text, and for overlapping subtitles to be shown properly.

Survey of the user's library (12,361 subtitle files; read-only, counts only):
- **SRT** (3,779 sidecar, 8,063 extracted): the only position tag is `{\an8}`, which already works.
- **ASS** (519 extracted; extraction keeps ASS whole). Dialogue lines by placement:
  - 169,370 bottom-centre (the default);
  - **43,786 with `\pos`/`\move`** (signs);
  - **4,336 styled top** and 699 inline top;
  - **~1,085 styled left or right**;
  - no middle styles in use;
  - **1,448 vector drawings** (`\p1`), which come out as garbage text today.
- **Overlaps:** 20,339 overlapping pairs in about 1,400 SRT files. **20,224 are two bottom lines**; only 115 are a top line
  over a bottom one. In 2,183 pairs the earlier line outlasts the later by at least 1 s.
- **WebVTT:** none, so WebVTT cue settings are out of scope.

User's choice: overlapping subtitles are shown **together, stacked**, by default, with "show the newest" as the
alternative.

Risk: FFmpeg's 608 decoder (Plex's is from the same family) positions only a caption's **first row**; later rows stack
under it. Stacking in one block of consecutive rows works on every decoder. A top block plus a bottom block in one
caption might show both at the top. The user remembers Plex putting two things in two places. That may have been Plex
drawing text subtitles itself, which takes another path. So both behaviours are built:
- **together:** one block, the default;
- **apart:** each part where the file puts it.

Test-pattern sample 38 shows which works in Plex, and the default can switch to `apart` after that.

## Approach

### 1. Placement model (`server/src/stream/captions/Cea608Encoder.ts`)

- `CaptionLayout` becomes `{ placement: { vertical: 'top' | 'middle' | 'bottom'; horizontal: 'left' | 'center' | 'right' }; lines }`.
- Schedule items carry `blocks: CaptionLayout[]`, normally one.
- `captionLines` and `loadSequence` flatMap over the blocks. Paint-on uses `captionLines`; `rollUpLines` uses `blocks[0]`
  and stays at the bottom.
- `firstRow`:
  - top starts on `topRow`;
  - bottom ends on `bottomRow`;
  - middle is `floor((topRow + bottomRow + 1 - n) / 2)`, clamped (row 8 for one line, rows 7-8 for two).
- `lineColumns`:
  - left is column 0;
  - right is `32 - width` for each line;
  - centre uses the alignment setting, as today.
- The `keepTopPlacement` key stays, and now means placement from the file in general. Off: everything bottom and
  centre-by-setting.

### 2. Reading positions

**Inline tags** (`parseCueText`):
- The first `\an` gives the numpad position: 7-9 top, 4-6 middle, 1-3 bottom; left, centre or right by column.
- Legacy `\a` maps 1-3 → 1-3, 5-7 → 7-9, 9-11 → 4-6.
- Also read the first `\pos(x,y)`, or `\move`'s start point.
- Text inside `\p1`…`\p0` drawings is dropped.

**ASS files** (`parseAss`, `ProgramCaptions.ts`):
- Track sections. Read `[Script Info]` PlayResX/PlayResY: when only one is given, follow libass (Y = X·3/4, X = Y·4/3);
  when neither is, use 384×288.
- Each `[V4+ Styles]` and `[V4 Styles]` section has its own `Format:`. Legacy V4 alignment values are converted.
- Style names match as libass does: a leading `*` is ignored, and an unknown name falls back to `Default`.
- Each cue gets `ass?: { playResX, playResY, styleAlignment? }`.
- Layered duplicate events (same times, same text) are dropped.

**Precedence** (`resolvePlacement`):
1. `\pos`/`\move`, only with ASS context: the point's third of the screen on each axis.
2. Inline `\an`/`\a`.
3. The style's alignment.
4. Bottom, centred by the alignment setting.

The existing `{\an8}` and `{\a6}` still resolve to top-centre, so default output for current files doesn't change.

### 3. Overlapping subtitles (pop-on only)

**Where:**
- `resolveOverlaps(parts, frameMs)` runs in `buildCaptionSchedule` between the sort and the scheduling loop. The loop,
  `loadAfter`, `replacedAt` and `leaveOut` are unchanged.
- A cluster with any paint-on or roll-up part passes through as today.
- The policy comes from each part's resolved appearance, so test-pattern cues can set their own.
- Overlap is tested with a strict `>`, so exact back-to-back cues and parts of one cue never count.

**`together` (default): show both, stacked.**
- **Clusters:** parts that overlap by at least about 500 ms form a cluster. Shorter overlaps stay sequential, as
  today.
- **Splitting:** inside a cluster, split at every start and end. Fold intervals under about 1 s into their neighbour,
  and merge neighbouring intervals with identical content, so each reload has time to load.
- **One block per interval:** each interval is one caption with one block. Lines go older above newer, at most 4 lines,
  keeping the newest.
- **Where the block goes:** the region of its parts when they agree; when they don't (a sign over dialogue), the bottom.
- **Horizontal:** the parts' own when they agree, otherwise the setting.

**`apart`: each part where the file puts it.** The same clusters and intervals as `together`, but the parts in
different regions keep their own block. Each block goes in its own region and alignment, and the bottom one ends on
the bottom row. Parts in the same region still stack in one block. This needs a decoder that positions every row; sample
38 tests it.

**`newest`: today's behaviour, plus the earlier cue comes back.**
- The latest-started active part wins.
- When an earlier part outlasts a later one, it comes back as a resume segment, but only if:
  - the segment is at least 1 s long; and
  - reloading it still leaves the next segment time to load (load frames come from a `loadFrames(blocks, appearance)`
    helper split out of `captionLoadFrames`).

### 4. Settings, UI, test pattern, docs

- **Setting:** `hdhrCaptionAppearance.overlappingCues: z.enum(['together', 'apart', 'newest']).default('together')`.
  Regenerate the OpenAPI spec and the web client (`TUNARR_DATABASE_PATH` set to a temporary directory for
  `generate-openapi`).
- **UI** (`web/src/pages/settings/FfmpegSettingsPage.tsx`): a "When subtitles overlap" select: *Show both, stacked* /
  *Show each where the file puts it* / *Show the newest*. Its help text says that "where the file puts it" depends on
  the player placing separate blocks (sample 38). The placement switch is relabelled *Placement from the subtitle file (top, middle, left, right)*.
- **Test pattern** (`CaptionTestPattern.ts`): samples are appended so earlier numbers keep their meaning:
  - 35 `{\an5}` middle of the screen;
  - 36 `{\an3}` right-aligned, two lines of different widths;
  - 37 two overlapping lines, stacked;
  - 38 a top sign and a bottom line overlapping with `overlappingCues: 'apart'`: **two blocks apart**. This is the Plex
    check that decides whether `apart` should become the default.

  `Sample` gets an `also?` cue for the overlapping samples.
- **Docs and notes:** update `docs/configure/ffmpeg/index.md` (placement rules, overlaps, new samples) and add a FORK.md
  entry. Copy this plan to `plans/caption-placement-and-overlaps.md`.

## Commit order (branch → PR into the fork's `main`; the golden snapshot must stay unchanged after every commit)

1. **refactor:** `placement` and `blocks[]`, with no behaviour change. Only the two tests that read `.top` change.
2. **feat:** inline `\an` middle/left/right, legacy `\a`, and drawings dropped, with samples 35 and 36. The test "keeps
   other alignments at the bottom" changes on purpose for `\an5`.
3. **feat:** ASS styles, PlayRes, `\pos`/`\move` and layered duplicates. `ProgramCaptions.test.ts` covers V4+/V4,
   Format column order and the PlayRes fallbacks; encoder tests cover the precedence.
4. **feat:** `resolveOverlaps` with `together`, `apart` and `newest`, the setting, and samples 37 and 38. Identity test: input with
   no overlaps comes back as the same array.
5. **feat(web):** the select and the relabel, then docs.

## Verification

- **Unit tests:** `cd server && pnpm test`, where only the 3 known macOS failures are allowed. Through `decodeScreens`
  and `screenAt`:
  - middle rows, left and right columns;
  - style, `\pos` and `\move` precedence;
  - stacked overlaps (older above, 4-line cap, bottom for mixed regions);
  - `apart` blocks in their own regions;
  - `newest` resume, and a resume skipped when too short;
  - paint-on and roll-up unchanged;
  - the golden snapshot unchanged.
- **Local ffmpeg tests:** `TUNARR_TEST_FFMPEG=…/jf/ffmpeg pnpm test:local`. These check that a stacked overlap
  decodes as consecutive rows, that `{\an5}` and right-alignment come out in the right row and column, and they record
  what FFmpeg writes for a two-block caption.
- **Library check:** a throwaway script runs the encoder over about 200 of the library's subtitle files (copied to the
  scratchpad, nothing printed but counts). It compares late and left-out captions, and screen time, before and after,
  so stacking doesn't make dialogue late.
- **End to end:** on a stream-repro server, an ASS clip with styles and `\pos`, and an SRT clip with overlapping cues.
  Decode the captioned segments with ffmpeg and check rows and timing.
- **Other checks:** `tsgo` (build and test configs), the web typecheck, `pnpm lint-changed`, prettier, commitlint, and
  the e2e sweep of `/settings/ffmpeg`.
- **Ship:**
  - The PR goes through CI, Codex 👍 and my review, then merge.
  - Then a release and a deploy through the deployment's guarded deploy script once nobody watches. It rolls back if
    Tunarr isn't ready within 6 minutes.
  - On the Apple TV, the test pattern's samples 35-38 then show what Plex does with middle, right, stacked and two-block
    captions.

## Not in this plan

- **Making `apart` the default:** waits for sample 38 on Plex.
- **WebVTT cue settings:** the library has none.
- **ASS margins.**
- **Reusing hidden memory after End of Caption** to resume without a reload.
- **A local-library bug found along the way:** `LocalSubtitlesService.findExternalSubtitles` passes a filename without
  its extension or directory, so subtitle files next to videos in Tunarr's *local* libraries are never found. The
  user's libraries come from Plex. This would be a separate small PR if wanted.
