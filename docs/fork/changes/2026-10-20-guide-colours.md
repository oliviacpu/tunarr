### Guide programs are muted tints keyed by show, and only "now" is teal (2026-10-20)

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
  - `typeStyle(palette, type)` encodes the type without relying on colour. Flex gaps and "No programming scheduled"
    take the page background, `text.secondary` and a dashed divider outline. Redirects are the secondary colour at 16%
    over the paper with an arrow before the title. Only programs open the details dialog, so only they get the hand
    cursor.
  - The now-playing cell gets a 2px primary ring, and the time marker (now `TvGuideNowMarker.tsx`) keeps primary.
    Nothing else on the grid uses primary. The marker jumps instead of gliding when the system asks for reduced
    motion, and block and column width transitions stop too.
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
  the dashed outline and the arrow, and keep their text at 4.5:1. `TvGuideItem.test.tsx`: the ramp fill, the primary
  ring only on the now-playing cell, the dashed flex outline, and the hand cursor only on programs.
  `TvGuideNowMarker.test.tsx`: the marker animates by default, does not under `prefers-reduced-motion`, and is
  primary. `colorHooks.test.tsx`: `system` on a dark OS picks the dark set (fails on the old code), and on a light OS
  the light set. `theme.test.ts` adds `secondary.contrastText` on `secondary.main` at 4.5:1 and a non-text list with
  `secondary.main` on the paper at 3:1; the contrast helpers moved to `web/src/test/contrast.ts`.
- **Upstream:** not sent.
