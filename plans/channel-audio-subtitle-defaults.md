# Channel audio and subtitle defaults

Status: **approved by Olivia Hunter on 2026-10-20; separate implementation authorized on 2026-10-21**. This is the design deliverable for S5 in the
[approved UI audit](ui-primitives-and-settings-audit-2026-10-19.md), approved through
[PR #85](https://github.com/oliviacpu/tunarr/pull/85). Approval of that audit authorized writing this design,
not implementing it. Olivia subsequently authorized the S5a → S5b → S5c implementation after the screenshot/docs closeout (#162). The design decisions below remain the implementation contract.

## Problem and current behavior

People setting up several channels cannot define subtitle preferences once and make exceptions per channel.
The channel editor currently claims to override global audio and subtitle settings, but those two fields
have different meanings and no corresponding global defaults.

Code checked against fork main `739fa6f4`:

- [`channel.audioTracks`](../types/src/schemas/channelSchema.ts) is a fixed output layout: at most four
  language tracks, in output order, throughout a channel's programs, gaps and commercials. An empty layout
  means one output track. It is unavailable in HLS Direct v2. It is not a preferred input-language list.
- [`ffmpeg.languagePreferences`](../types/src/schemas/settingsSchemas.ts) already chooses input audio
  languages through the legacy profile. Keep that setting and its English default unchanged.
- Channel subtitle preferences live in SQLite `channel_subtitle_preferences`; global FFmpeg settings live
  in `settings.json` at `settings.ffmpeg`. There is no global subtitle preference list or inheritance mode.
- [`StreamSelectionProfileResolver.buildLegacyProfile`](../server/src/services/StreamSelectionProfileResolver.ts)
  uses channel preferences, then a `default` subtitle action when no active preferences remain. Explicit
  profiles take precedence in program → filler list → channel order. The legacy conversion flattens all
  language rows under the first active row's filter and external/image flags.
- HLS Direct v2's `buildPassthroughSubtitles` in `FfmpegStreamFactory` calls `SubtitleStreamPicker` directly.
  Its empty-list behavior is default-or-first subtitle; the profile evaluator's `default` action requires
  a default-marked stream. These existing fallbacks are different and must not change accidentally.
- The existing subtitle API spells its language field `langugeCode`. Do not rename that existing wire key
  as part of this feature. Persistence and internal code use `languageCode`.

## Recommended model

**Add global subtitle preferences; keep fixed audio layouts exclusively per channel.** A global output
layout would change every inheriting channel's track count and language menu, including gaps and commercials,
and can duplicate audio when a language is absent. That is a separate broadcast-output decision, not a
natural extension of input-language preferences. The channel field should explain that it has no global
default. Do not add an audio inherit/override switch or another global audio setting.

All names and shapes below are proposed additions, not existing APIs:

- Add `ffmpeg.subtitlePreferences`, default `[]`, to the shared FFmpeg settings schema and defaults. Each
  row has `languageCode` (known ISO 639-2 code, normalized to terminological form), `filter` (`none`,
  `forced`, `default`, `any`), `allowExternal` and `allowImageBased`. Array order is priority; there are
  no database IDs or explicit numeric priorities. Reuse the existing subtitle filter enum. Require both
  booleans; reject invalid rows instead of silently replacing the settings section with defaults.
- Add channel `subtitlePreferenceMode: 'inherit' | 'custom'` to response and write schemas and SQLite.
  A migration marks channels with saved preference rows `custom`, and channels without rows `inherit`.
  New channels derive the initial mode the same way when an older client omits it. On update, omitted
  mode preserves the stored mode. A custom empty list retains the old per-stream-mode fallback and never
  falls through to global preferences. `subtitlesEnabled: false` remains the way to turn subtitles off.
- Keep custom rows when switching to inherit so switching back restores them. An omitted preference
  list on update preserves those rows; an explicit empty list clears them. Accept `[]` on channel writes
  while retaining the existing optional/nonempty response convention. Adapt the legacy `langugeCode`
  wire spelling at the boundary instead of copying that spelling into the new global schema.
- Include a minimal compatibility change to the existing channel editor in S5a, before inheritance can
  become active in S5b: a deliberate subtitle-list edit sends the rows (including explicit `[]` when
  cleared) and `subtitlePreferenceMode: 'custom'`. An unrelated channel edit preserves the saved mode
  and rows. This does not introduce the inherit/custom control planned for S5c. Older external clients
  omitting the mode or preference list retain the preservation rules above; the server cannot infer
  a deliberate clear from an omitted field.
- Persist global preferences through `SettingsDB` in the existing FFmpeg settings section, with no SQL
  table for globals. Missing fields in an old settings file decode to `[]`; do not bump unrelated config
  versions. During S6's API transition, expose this field through whichever settings routes are current.
  Old replacement PUT clients omitting the new field must preserve its saved value; explicit `[]` clears
  it. A PATCH omission also preserves it. Regenerate OpenAPI and clients in the implementation PR.

## Resolution and compatibility

Add one server helper that resolves the effective list and its source from channel mode, channel rows and
current global settings. Read global settings when selecting streams, rather than caching them per channel.
No default list is copied into channel rows. Changing a global preference affects future selections;
it does not tear down an already playing stream or change an active output-track layout.

1. Keep existing explicit stream-selection-profile precedence and evaluation unchanged. They override
   defaults in the profile-based path; do not extend profile support into HLS Direct v2 in this feature.
2. In the legacy fallback, `inherit` uses the global list and ignores retained channel rows. `custom`
   uses only channel rows. With an empty effective list, retain the current mode's exact fallback.
3. For a nonempty inherited list, try each row in order, respecting that row's language, filter and both
   flags. Skip `none` rows; all-`none` or no matching rows selects no subtitle. Compare language aliases
   through `LanguageService`. Preserve extraction checks and passthrough's text-only output capability.
4. Add a proposed `by_preferences` subtitle action containing the global row array, so the legacy profile
   can carry each row's flags into `StreamSelectionEvaluator`. Share its row matching with the direct
   picker without changing each path's extraction/rendering behavior. Keep existing `by_language` action
   semantics and existing custom-channel conversion unchanged; fixing its first-row flattening requires
   a separate decision. Use the same effective-list helper in the direct picker and troubleshooting.

With global `[]`, migration must preserve all existing playback outcomes, including custom all-`none`
behavior. With a nonempty global list, only inheriting channels change. A channel with custom empty
preferences can deliberately retain its old default behavior. Subtitle enablement, extraction, captions,
burn-in and WebVTT capability gates continue to apply; preferences do not enable those features.

Rejected alternatives: deriving output layouts from audio language preferences conflates input selection
with output structure; copying defaults into channels prevents later global changes from propagating;
using absence of channel rows as the only inherit signal cannot represent a custom empty list; routing
defaults through editable CEL profiles adds an unrelated UI and reopens the approved P1 shelving decision.

## Separate implementation PRs

These rows define the approved implementation split, scheduled in the audit's S5 continuation. S5a is #163, S5b is #164, and S5c contains the controls and acceptance evidence. Each step is reviewed and landed separately.

| Row | Change                                                                                                                                                   | Acceptance                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5a | Shared types, global settings persistence/API compatibility, channel-mode migration, retained custom rows and minimal existing-editor compatibility.     | Old settings files load; omitted PUT/PATCH fields and restart preserve global preferences; restoring defaults clears them to `[]`; channels with/without rows migrate correctly; omitted/empty/custom/inherit writes round-trip; existing-editor additions and clears explicitly select custom, while unrelated edits preserve mode/rows. |
| S5b | Effective-list helper, new inherited-list action/evaluator, direct-picker and troubleshooting integration.                                               | Empty globals preserve existing behavior; inherited nonempty lists honor each row; custom and explicit profiles keep existing behavior; HLS Direct v2 respects text-only output.                                                                                                                                                          |
| S5c | Global list in Captions & audio settings; channel subtitle inherit/custom control with resolved-default preview; accurate per-channel audio-layout copy. | Save/reset/dirty/error handling uses the shared shell; switching modes retains custom rows; disabled subtitles and unsupported stream capabilities are clear; screenshots at 390px/1440px in both themes.                                                                                                                                 |

S5a must include migration tests from a real pre-change schema fixture, existing-channel copy/update tests,
and schema/API tests for invalid language/filter/boolean values and legacy request omissions. S5b must
cover explicit profile precedence, language aliases, differing per-row flags, `none`, no matching language,
unextracted embedded text, external and image tracks, both empty-list fallbacks, and `subtitlesEnabled=false`.
S5c must cover persistence after reload, returning from custom to inherit and back, and routes after S1/P5.
Run focused suites, changed-file lint and typechecks for each code PR, plus the e2e route sweep for S5c.

Ship S5a → S5b → S5c in that order as separate implementation PRs after their reviews. Back up SQLite and `settings.json` before the
migration release; downgrade by restoring both together with the prior image. Add fork notes and public
configuration documentation with the implementation PRs. The original design PR introduced no runtime behavior; the implementation PRs carry tests and public documentation. Release and deployment remain separate from landing the source changes.
