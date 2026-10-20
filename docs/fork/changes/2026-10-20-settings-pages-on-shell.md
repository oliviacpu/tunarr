### Every settings page saves the same way: one save bar, the unsaved guard, one schedule widget (2026-10-20, PR #112)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C2, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** each settings page laid out and enabled its save bar its own way. Scanner had Save only, so a
  change could not be undone and leaving the page did not warn. General and Features did not warn either. On General,
  Save turned off for an invalid server URL without saying why; saving a new server URL put the old one back in the
  field; clearing the log-roll interval to type a new one made the field vanish and unticked "Roll on schedule"; the
  "Every N / unit / time" inputs had no labels, and the time picker was cut off on a phone. A failed save on General or
  Scanner pointed at the console or the logs instead of giving the server's reason. The Features page left out one flag's type.
- **Cause:** every page wrote its own `<form>`, save bar, mutation callbacks and error toast, and the backup and log
  rolling schedules were two copies of one hand-built widget. General's save reset the form from the settings of the
  render that pressed Save, before the new server URL was stored. "Roll on schedule" was read from the interval
  itself, so any interval that was not positive also meant "off".
- **Fix:** issue C2 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - General, Transcoding (global FFmpeg settings), Scanner, Tuner and Features are now only their fields inside
    `SettingsForm`, saved through `useSettingsMutation`. Each page lost its own mutation, toasts, save bar and unsaved
    guard. Every page now has the same save bar ("Reset changes" while there are changes; Save only when there are
    valid changes and no save is in flight) and the unsaved guard. Tuner keeps "Restore defaults", now as a change that
    can be undone. A failed save says "Could not save settings:" and the server's reason (or the error's own message).
  - Each page loads its settings into the form once, and skips a reload that brings back what the form already holds,
    so a field changed while a save is in flight keeps its value.
  - The settings forms, the guide (XMLTV) page included, validate on `onTouched`: Save turns off as soon as a value
    stops being valid, and the field says why once you have left it. General's server URL field now shows its error.
  - General: the form fills in from the saved settings with the server URL as stored when the save returns, so a new
    URL stays in the field. "Roll on schedule" is its own field; unticking it hides the schedule and leaves it out of
    the save, ticking it again brings the schedule back (a cron schedule included), and with no schedule it starts
    daily at midnight. With log rolling off, its hidden fields no longer hold up Save and neither the schedule nor the
    size limit is sent; turning rolling back on with neither set starts from the defaults (daily at midnight, 50 MB).
    Turning backups off no longer leaves Save disabled by a hidden backup interval.
  - New `web/src/components/settings/general/ScheduleFields.tsx` replaces both schedule copies: a labelled interval
    ("Backup interval" / "Roll interval", required and at least 1), a labelled unit (hours or days; a unit only
    settings.json sets stays listed) and a labelled "Time of day" for daily schedules. It wraps on a phone. A cron
    schedule shows as text. The unguarded `currentBackupSchedule!` is gone. The archive format select has a label, and
    the backup folder row stacks on a phone.
  - Transcoding: the global form uses `SwitchFormController` and `SelectFormController`; the transcode-config table
    sits below the form, outside it. Features: the switches use `SwitchFormController`, a flag an environment variable
    sets is disabled, and the flag type comes from the API, so no flag is missing.
  - Removed: `useUpdateSystemSettings` and the Tuner page's `restoreTunarrDefaults` flag.
  - Docs: `docs/dev/contributing.md` "Settings pages" names the pages and the validation mode;
    `docs/configure/system/backup.md` and `logging.md` describe the schedule fields.
- **16px inputs on phones (decision for a theme issue, not changed here):** measured in the e2e fixture at 390px in
  Chromium: inputs, selects and pickers are 14px, so a floating label shrinks to 10.5px; forced to 16px the shrunk
  label is 12px, no settings page scrolls sideways, and the outlined notch scales with it. iOS Safari zooms into a
  focused field under 16px and stays zoomed (not testable here; it applies to text inputs and likely the pickers'
  editable sections, not MUI's select, which is a `div`). Recommendation: 16px for `MuiInputBase`, `MuiInputLabel` and
  the pickers' input below the `sm` breakpoint only, 14px from `sm` up; never `maximum-scale=1`, which blocks pinch
  zoom on Android.
- **Tests:** new `ScheduleFields.test.tsx` (labels, a cleared or 0 interval stays on screen and says why, unit names
  follow the interval and hours drop the time of day, the time is kept as milliseconds after midnight, a settings.json
  unit and a cron schedule). `LogRollForm.test.tsx` adds the cleared interval, ticking with no schedule and untick then
  tick. `GeneralSettingsForm.test.tsx` adds a saved server URL staying in the field (fails on the old form) and an
  unticked schedule saved as none. New `FeaturesSettingsPage.test.tsx`; Tuner adds "Restore defaults" (undo, then
  save); Scanner adds "Reset changes"; Transcoding adds a select and a switch. Existing page tests pass with two
  updates for the shell: Scanner asserts Save is disabled for an invalid interval instead of clicking it, and Tuner's
  reasonless failure toast carries the error's message. E2E: one round-trip spec per page (`generalSettings`,
  `transcodingSettings`, `scannerSettings`, `tunerSettings`, `featuresSettings`): load, change one field, save, reload,
  the field held and the server's settings moved by that field only. `logRollSettings.spec.ts` moved unchanged into
  `generalSettings.spec.ts`, because both save the whole system settings and Playwright runs files in parallel.
- **Upstream:** not sent.
