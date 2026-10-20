### One word per action, and a toast that matches it (2026-10-20)

- **What you saw:** the same action had several names. Saving said Save, Update or Submit; undoing said Reset, Reset
  Changes, Reset Options or Restore Default Settings. The toast after a save was "Settings Saved!", "Feature flags
  saved!", "Channel settings saved!", "Programs saved!" or "Successfully updated Media Source settings.". On slot pages
  and the custom show form the Reset button was as loud as Save (both `contained`).
- **Cause:** every site wrote its own label and message inline, and nothing said which buttons are primary.
- **Fix:** issue D3 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`. `web/src/strings/actions.ts` holds the
  labels (Save, Cancel, Delete, Reset changes, Restore defaults, Add, Create, Remove, Close) and toasts (Saved, Deleted,
  Changes reset, Defaults restored, Could not save settings, Could not delete). Save-bar buttons use them; Update and
  Submit became Save, Reset Options and Reset became Reset changes, Restore Default Settings became Restore defaults.
  Success toasts say "Saved" or "Deleted". Failures open with "Could not save settings" or "Could not delete", then
  the server's reason after a colon. Reset buttons on slot pages and the custom show form are no longer `contained`, so
  Save is the one primary button.
- **Tests:** `web/src/strings/actions.test.ts` (keys, no duplicate labels, reason formatting); the settings page tests
  and the general settings form test follow the new wording.
- **Upstream:** not sent.
