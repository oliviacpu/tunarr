# Closed caption appearance settings, with a test pattern and a preview

## Context

Plex Live TV gets Tunarr's subtitles as CEA-608 closed captions in the HDHomeRun `.ts` stream (`Cea608Encoder.ts`, CC1,
pop-on). Today the only settings are on/off (`hdhrClosedCaptions`) and alignment (`hdhrCaptionAlignment`). Italics,
underline and top placement come from the subtitle file.

Plex draws captions itself on the Apple TV. It burns them in with a decoder from the FFmpeg family: its own font and an
opaque near-black box, with the text size set in the Plex app. In an Oct 13 test, Plex ignored 608's semi-transparent
and transparent background codes.

The user wants every 608 presentation feature as a global setting, so we can find out what Plex honours, plus a
preview. The user picked:
- **Captions:** closed captions only (not burn-in).
- **Settings:** global.
- **Preview:** rendered by ffmpeg.
- **Delivery:** two steps.

**What FFmpeg's `cc_dec` (8.1) does with each feature.** This is our best predictor of Plex.

| Feature | `cc_dec` |
| --- | --- |
| Text colour | Honoured, as `\c` |
| Background colour | Honoured as the box colour (`\3c`), opaque only |
| Semi-transparent background | Dropped |
| Transparent background | Ignored |
| Flash | Ignored |
| Black text code | Mis-decoded as white italics, so it's not offered |
| Italics | Always white |
| Rows and indents | Honoured; later rows stack under the first row |
| Roll-up | Works |
| Paint-on | Needs `real_time` |

CR must never be sent in pop-on mode, and identical consecutive control pairs are collapsed.

**Why not change the decoder:** the captions Plex shows are drawn by the Plex Transcoder, Plex's own closed build of
FFmpeg. It runs inside Plex Media Server on the box. Tunarr can't change it. Stock `cc_dec` is a stand-in for it: it
drives the preview and the expectations. The Apple TV test shows where Plex's copy differs. What Tunarr controls is
which 608 codes it sends.

## Step 1: every option as a setting, plus a test pattern

### Settings

Settings live in `types/src/schemas/settingsSchemas.ts`, inside `FfmpegSettingsSchema`.

- **`hdhrCaptionAppearance`:** a new `CaptionAppearanceSchema`, defaulted with
  `CaptionAppearanceSchema.default(() => CaptionAppearanceSchema.parse({}))`. That's the `SettingsDB.ts` featureFlags
  pattern; Zod 4's `.default(obj)` doesn't parse the object. Fields:
  - `textColor`: white*, green, blue, cyan, red, yellow, magenta.
  - `backgroundColor`: `player`*, black, white, green, blue, cyan, red, yellow, magenta. `player` sends no code, as
    today.
  - `backgroundOpacity`: opaque*, semiTransparent, transparent.
  - `bottomRow`: 1–15, default 15.
  - `topRow`: 1–15, default 1.
  - `maxLines`: 2*–4.
  - `lineWidth`: 20–32*.
  - `upperCase`: default false.
  - `mode`: popOn*, rollUp2, rollUp3, rollUp4, paintOn.
  - `keepStyles`: default true.
  - `keepTopPlacement`: default true.
- **`hdhrCaptionTestPattern`:** a flat boolean, default false.
- **Alignment:** `hdhrCaptionAlignment` stays where it is.
- **Migration:** Zod fills in missing fields, so existing `settings.json` files need none.
- **API client:** regenerate it with the regen-api skill.

### Encoder (`server/src/stream/captions/Cea608Encoder.ts`)

**Options**
- Add `CaptionAppearance`: the schema fields, plus `alignment` and `flash`, which is test-pattern only.
- `CaptionScheduleOptions.layout` becomes `appearance?: Partial<CaptionAppearance>`.
- `CaptionCue.appearance?` lets a single cue override it. Resolve per cue as `{...Default, ...options, ...cue}`.

**Layout:** `layoutCaption(text, appearance)`, which reuses the threading from the reverted `ee980567`.
- `keepStyles` and `keepTopPlacement` filter what `parseCueText` returns.
- Upper case is applied before any width is measured (ß becomes SS).
- `lineWidth` replaces `Columns` in wrapping. `lineColumns` still centres on the 32-column screen.
- `maxLines` replaces `MaxRows`.

**Colour**
- `lineUnits` tracks an attribute byte: italics is 0x2E/0x2F, otherwise `0x20 + 2*colour`, plus 1 for underline.
- White gives exactly today's codes.
- Any other colour opens each line with a mid-row code, costing one column. A run of italics shows white, and the code
  that ends it restores the colour.
- No colour PACs.

**Background**
- One leading unit per line: a space, then `0x10 0x20+2*idx(+1 semi)`, or `0x17 0x2D` for transparent. This uses the
  existing fallback-code path and costs one column.
- The line order is PAC, TO, background, colour, flash (`0x14 0x28`), then text.

**Rows**
- Bottom captions start at `clamp(bottomRow − n + 1, 1, 16 − n)`.
- Top captions start at `clamp(topRow, 1, 16 − n)`.

**Modes:** split `loadSequence` into `lineAtoms`, plus one wrapper per mode.
- **Pop-on:** unchanged, except that a caption is only replaced in place by a pop-on caption. A mode change forces the
  clear first.
- **Paint-on:** `RDC 0x14 0x29`, then `EDM` on the start frame, then the lines. EDM is what makes `cc_dec` time the
  event from that frame.
- **Roll-up:** `EDM` and `RU2/3/4 (0x14 0x25–27)` go first in a schedule and on each mode change. Each line is
  `CR 0x14 0x2D`, a PAC on the base row (`max(bottomRow, n)`), then the text. Line 0's CR goes on the cue's start
  frame. No CR is ever sent after RCL. Top placement is ignored.
- **All modes:** clear at the cue's end, unless the next cue in the same mode follows at once. Skip a cue whose first
  frame is at or after its end, as pop-on already does.

**No-captions notice:** `noCaptionsNoticeStartMs(fps, appearance)` computes the lead from a new
`captionLoadFrames(text, appearance)`, as `max(23, load + 5)` frames and never under 1 s. The defaults stay at 23
frames.

### Test pattern (`server/src/stream/captions/CaptionTestPattern.ts`)

**Hook**
- `captionTestPattern(base: ProgramCaptions)` runs at the end of the caption decision in `FfmpegStreamFactory`, when
  captions are on and `hdhrCaptionTestPattern` is set.
- Programs that would get the notice get the pattern instead. Burn-in decisions don't change.

**Samples**
- Each sample sets its own complete appearance, so results don't depend on the user's settings. Each one's text begins
  with its number:
  - 1–7: text colours.
  - 8: red with an italic word, to show italics forcing white.
  - 9–10: italics, underline.
  - 11–18: box colours.
  - 19–21: semi-transparent black, semi-transparent blue, and transparent boxes.
  - 22–25: rows 1, 5, 11 and 13.
  - 26–27: three and four lines.
  - 28–29: left and each-line-centred.
  - 30: flashing.
  - 31: paint-on.
  - 32–34: roll-up 2, 3 and 4 rows.
- Upper case and line width aren't samples: Tunarr applies them before sending, so every player shows them.

**Timing**
- The first sample starts after the notice lead.
- Pop-on samples show for 4 s; roll-up and paint-on for 6 s.
- There's a 1 s gap between samples, or 2 s at a mode change.
- The pattern loops for the program's length, about 170 s per loop.

### Plumbing and UI

- **`HlsSession.addCaptions`:** passes `{alignment, ...hdhrCaptionAppearance}` for each program, so a change applies
  from the next program.
- **`FfmpegSettingsPage.tsx`:**
  - A "Caption appearance (experimental)" accordion goes under Alignment.
  - It has nested `Controller`s: selects for colours, opacity, mode, lines, width and rows, and switches for upper case,
    keep styles, keep top placement and test pattern.
  - Everything is disabled unless captions are on.
  - Opacity is disabled while the background is `player`. Lines and top placement are disabled in roll-up.
  - Help text says that changes apply from the next program.

### Order of commits (branch → PR into the fork's `main`)

1. **Golden test first, before any encoder change:** `Cea608Encoder.golden.test.ts`.
   - It covers italics, underline and reset tags, a top cue, a 3-line split, extended characters and `♪♪`, a cue under
     way, the left-out cue, back-to-back cues, and the notice.
   - It runs for each alignment, at 15, 23.976 and 29.97 fps, with `toMatchFileSnapshot`.
   - Later commits never change that file. Also: an explicit default appearance gives the same pairs as none.
2. **Spike,** in `CaptionInsertion.local.test.ts`: confirm the EDM and CR timing that paint-on and roll-up rely on, and
   that roll-up keeps n rows, through jellyfin-ffmpeg 8.1.3.
3. **Schema and regenerated client.**
4. **Layout, colour, background and rows.**
5. **Test decoder:** `server/src/testing/captions/Cea608TestDecoder.ts`.
   - It keeps displayed and hidden memories with attributes, plus the mode, cursor and roll-up window, and returns
     `screens(pairs)` with labels like `[red]` and `[bg blue semi]`.
   - The old `decodeCaptions` stays.
6. **Paint-on and roll-up.**
7. **Notice lead.**
8. **Plumbing and the stream factory.**
9. **Test pattern.**
10. **UI.**
11. **Docs:** `docs/configure/ffmpeg/index.md` (the options, the sample list, and what's known about Plex), and a
    FORK.md entry.

## Step 2: preview and Plex labels (after the Apple TV test)

**Preview endpoint:** `POST /api/ffmpeg-settings/caption-preview` takes the form's unsaved caption settings and returns
`image/png`.
- **Base clip:** a short 640×360 H.264 clip, generated once per process into a temp directory.
- **Captions:** sample captions built with the requested settings and inserted with `insertCaptions`.
- **Rendering:**
  - ffmpeg decodes them with `cc_dec` to ASS, using `-real_time 1` for paint-on.
  - A second ffmpeg run burns that onto frames, tiled, and returns the PNG on stdout.
  - This uses `spawn` and collects a Buffer, because `ChildProcessHelper.getStdout` returns text.
- **Limits:** one render at a time, with a timeout.

**Page:**
- The image shows only when captions are on, so the e2e route sweep of `/settings/ffmpeg` never triggers it.
- It's fetched as a blob through the generated client and updates 500 ms after the last change.
- Its caption says it's ffmpeg's rendering, which Plex's player is built on, and that Plex uses its own font and box.

**Labels:** each control gets "Plex on Apple TV: works / ignored", taken from the user's test results, in the help text
and the docs.

## Verification

- **Server tests:** `cd server && pnpm test`. Only the 3 known macOS failures are allowed.
  - The golden snapshot is unchanged.
  - Each option is checked with the test decoder.
  - Mode transitions are covered, along with the notice lead under heavy appearances, and the stream factory's switch
    to the pattern.
- **Local ffmpeg tests:** `TUNARR_TEST_FFMPEG=…/jf/ffmpeg pnpm test:local`, for the captions tests. These check `\c`
  and `\3c`, row positions, roll-up rows, and paint-on with `real_time`.
- **Other checks:**
  - `tsgo` build and test configs;
  - `pnpm lint-changed`, prettier and commitlint;
  - the web typecheck;
  - the e2e sweep for `/settings/ffmpeg`.
- **End to end on a stream-repro server** (the `cc_run.sh` harness from the timing fix): with the pattern on, decode
  the captioned segments with ffmpeg and check that every sample appears in order with its expected tags. With default
  settings, the captions must be identical to `main`.
- **PR:** CI, Codex 👍 and my own review, then merge.
- **Release:** a tag only when the user says so, then deploy while nobody is watching.
- **Apple TV:** the user turns the test pattern on, turns on CC on any channel in Plex, notes which numbered samples look
  right, and turns it off. Those results drive step 2's labels.
