### The transcode config page uses the settings form shell, and one form library is left (2026-10-20)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C4, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** on a transcode config page, Save was enabled with nothing changed and stayed enabled while a save
  was in flight. Leaving the page, reloading or closing the tab with unsaved changes did not warn. After creating
  a config the page stayed on "New transcode config", so saving again created a second config. A failed save said "See
  console log for details" instead of the server's reason. "Reset changes" after turning loudness normalization on or
  off left the select showing the new choice.
- **Cause:** the transcode config form was the only form on TanStack Form. It had its own save bar and mutation
  callbacks, no unsaved guard, kept the create mode after a create, and held the loudness normalization choice in
  local state beside the form.
- **Fix:** issue C4 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `TranscodeConfigSettingsForm` and its sections (video, advanced video, audio, error) are on React Hook Form inside
    `SettingsForm`, with the same fields, defaults, sections and "Show Advanced" toggle as before: the device path only
    for VA-API and QSV, the video preset only for software H.264 and HEVC, the hardware switches only with advanced
    settings and an accelerator, the loudness targets only with advanced settings and loudness normalization on. The
    preset list still runs to veryslow and a saved preset outside it is kept.
  - The form validates with `zodResolver(TranscodeConfigSchema)`, the schema the server checks the config against, so
    the form refuses what the server would.
  - `useTranscodeConfigForm` (replacing `useTranscodeConfigFormOptions`) saves through `useSettingsMutation`: a new
    config is POSTed without an id, then the page replaces itself with the new config's edit route; an existing one is
    PUT to its id. Both refetch the transcode config queries and toast "Saved" or "Could not save settings" with the
    server's reason. While a create is in flight the fields are locked (a disabled, `inert` fieldset), so nothing
    typed after Save is lost when the page moves to the new config.
  - `NumericFormControllerText` takes an opt-in `rawValue`: the field keeps what was typed and the resolver turns it
    into a number. The transcode form uses it for every number, so an empty field saves as 0, decimals (a 44.1 kHz
    sample rate) are kept, and text after the digits ("4000k") is refused rather than dropped. Other pages are
    unchanged.
  - The loudness normalization select follows the form, so "Reset changes" puts it back, and it has an accessible
    name.
  - `SelectFormController` options take `disabled`, for the audio formats FFmpeg lacks an encoder for.
  - Removed: `web/src/hooks/form.ts`, `web/src/components/form/BasicTextInput.tsx`, `BasicSelectInput.tsx`,
    `BasicCheckboxInput.tsx`, `BaseTranscodeConfigProps.ts`, and the `@tanstack/react-form` and
    `@tanstack/react-form-devtools` dependencies.
  - `docs/configure/ffmpeg/transcode_config.md` says when Save is available, that saving a new configuration opens it,
    and that leaving with unsaved changes asks first.
- **Tests:** `TranscodeConfigSettingsForm.test.tsx` keeps the New and Edit titles and adds: an empty name, a bitrate
  or thread count that is not a number, and a loudness target outside -70 to -5 LUFS cannot be saved (these fail
  without the schema resolver); typed numbers and a decimal loudness target are saved as numbers; a resolution picked
  as WxH is saved as its width and height; only the accelerators FFmpeg has are offered; the device path, video preset
  and hardware switches show only for the accelerators they apply to and are saved; a create POSTs without an id and
  opens the new config; an update PUTs to the config's id; the unsaved guard follows the dirty state through an edit,
  "Reset changes" and a save. `TranscodeConfigVideoSettingsForm.test.tsx` runs on React Hook Form and adds that an
  empty, missing or unknown preset shows as veryfast and is kept. `TypedController.test.tsx` covers a disabled select
  option. The e2e spec `e2e/tests/transcodeConfig.spec.ts` creates a config (it is saved once and opens as its edit
  page; this fails if the unsaved guard is not bypassed for that move) and edits one (leaving warns first, the save
  goes to the same config, and only the edited field changes).
- **Upstream:** not sent.
