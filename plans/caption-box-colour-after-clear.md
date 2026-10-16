# Caption box colour drops back to black at the end of a caption

## The report

User, 2026-10-16: "I set magenta background and saw it in Plex Mac. However sometimes (often) the background went
back to black for the end, or a music note character, almost like it was drawing the magenta over black or the timing
of our codes is off?"

The deployment's settings now have `backgroundColor: "player"`; the user tried magenta and set it back.

## Root cause (confirmed)

Confirmed with jellyfin-ffmpeg 8.1.3 before the fix, a caption following another by 200 ms:
`{\3c&HFF00FF&}Then{\i1} Hey!{\i0} to\Nthe ve{\3c&H000000&}ry end ♪`. The box turns black partway through the
second line, where the previous caption's clear landed in its load. After the fix the box is magenta to the last
character.

**FFmpeg's 608 decoder resets the background on Erase Displayed Memory.**
FFmpeg `libavcodec/ccaption_dec.c` (release/8.0, the family of jellyfin-ffmpeg 8.1.3 in production):

- The background is cursor state (`ctx->bg_color`). `handle_bgattr` sets it (0x10 0x20-0x2f), and `write_char` stamps
  it on every character as it's written (`bg[col] = ctx->bg_color`, around line 353).
- `handle_edm` (0x14 0x2c, around lines 676-690) sets `ctx->bg_color = CCCOL_BLACK` for whatever is written next.
  `handle_eoc` calls `handle_edm` in buffered mode, the default.
- So every character written after an EDM is black until the next background code. The spec keeps background
  attributes per row and doesn't tie them to EDM; FFmpeg's state is global.

**The encoder puts the previous caption's EDM inside the next caption's load** (`server/src/stream/captions/Cea608Encoder.ts`):

- Pop-on loads the next caption into hidden memory while the current one shows.
- The loop places caption _i_'s clear first: `clearFrom(endSlot)`, which takes EraseDisplayedMemory around line 1425.
- Caption _i+1_'s load is placed afterwards, backward from its start (`placeBefore`, around 1246), "stepping around
  commands already placed".
- When the gap between two cues is shorter than the load (about 1-1.5 s for two lines; very common in dialogue and
  songs), the EDM lands inside the load.
- Each line sends its background code once, at its start (`lineUnits` → `backgroundUnit`, around 520). So the part of
  the last line loaded after the EDM, the end of the caption, is stamped black. A closing ♪ is often that part.
- Back-to-back cues (gap ≤ 1 frame) don't get an EDM (`replacedBy`), and a gap longer than the load puts the whole
  load after it. That's why it happens "sometimes (often)" and always at the end.

**Smaller things seen on the way:**

- `handle_bgattr` doesn't back up a column, so the space sent before a background code keeps the previous colour.
  `capture_screen` hides it when all lines share an indent (the default centred block). It can show as an extra cell
  on a line with a deeper indent (centred lines, side placements).
- FFmpeg ignores the transparent-background code 0x17 0x2d (already documented).
- The default box ("player") sends no background codes, so default output isn't affected.

## Fix

A line that carries a background code must not straddle an EDM: everything from that line's background code to its
last character lands on one side of any EraseDisplayedMemory already in the schedule.

- Track the slots where EraseDisplayedMemory is taken (`clearFrom`, paint-on and roll-up entries) as barriers.
- `lineAtoms`: mark the atoms of a line from its background code to the end as one group, only when the line has a
  background unit.
- `placeBefore` (backward): if a group would straddle a barrier, place the whole group before it and continue from
  there.
- `placeFrom` (forward, for late shows): if a group's first atom would be before a barrier and a later one after it,
  move the whole group after the barrier.
- If a group can't fit on either side, fall back to today's behaviour (`placeFrom` showing late), so a caption is never
  left out because of this.
- **Not done:**
  - re-sending the background code after an EDM: a mid-line background code takes a column on spec decoders (they back
    up over the previous character), so it would damage text there;
  - holding the previous caption up through short gaps: that changes caption timing.
- Default output (`backgroundColor: "player"`) has no groups, so the golden snapshot stays byte-identical.

## Tests

- **Encoder unit tests** (`Cea608Encoder.test.ts`):
  - **A small FFmpeg-semantics model:** feed the pairs frame by frame and keep `bg_color` as cursor state. Reset it on
    EDM and EOC, stamp it on each written cell, and capture rows at EOC.
  - **Cases:** two cues with a 0.3 s gap and a magenta box; the second cue has italics and ends with ♪. Every written
    cell of the second caption must be magenta. Also a three-line caption, and the forward (`placeFrom`) path with
    a cue already under way.
  - Each fails without the fix: the tail comes out black.
- **Golden snapshot:** unchanged.
- **Local real-ffmpeg test** (`CaptionInsertion.local.test.ts`): the same cues, encoded into a TS, decoded with
  `movie=…[out0+subcc]` to ASS by jellyfin-ffmpeg 8.1.3. The second cue's dialogue keeps `\3c&HFF00FF&` to its last
  character, with no `\3c&H000000&` after the first character.
- **Test pattern:** append sample 39 (earlier numbers keep their meaning). It's two short cues with a magenta box and a
  short gap: "39 MAGENTA TO THE END ♪", then a second line ending in italics and ♪. Read `CaptionTestPattern.ts` timing
  first; if the pattern's fixed spacing can't make a short gap, add a field to `Sample` for a follow-up cue at an
  offset.

## Docs

- `docs/configure/ffmpeg` (caption appearance): a box colour holds to the end of each line, and FFmpeg-family players
  ignore the transparent box.
- FORK.md entry: what the user saw, the cause with the decoder lines, the fix, the tests.

## Ship

Run lint-changed, the tsgo typechecks (build and test) and the server tests (pre-existing local failures:
ArtworkService x2, imageFileLookup). Then conventional commits with the Co-Authored-By line, a PR into
oliviacpu/tunarr main, "@codex review" and Codex rounds until clean. No release from this task. After a release, the
user checks sample 39 with a magenta box on Plex Mac and the Apple TV.
