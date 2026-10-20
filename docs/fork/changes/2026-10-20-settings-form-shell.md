### Settings pages get one form shell: one save bar, the unsaved guard, one way to report a save (2026-10-20)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue C1, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** on the XMLTV page, Save stayed clickable while a save was in flight, so a second click sent a
  second save. "Restore defaults" filled in the defaults without counting them as a change: "Reset changes" did not
  appear to take them back, and leaving the page did not warn that they were unsaved. Each of the other settings pages
  laid out and enabled its save bar differently (section 3 of the plan lists them).
- **Cause:** every settings page wrote its own `<form>`, save bar, mutation callbacks and error toast. XMLTV disabled
  Save on React Hook Form's `isSubmitting`, which a save started with `mutate()` never holds, and its "Restore defaults"
  made the defaults the form's new saved values, behind a separate flag that enabled Save.
- **Fix:** issue C1 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - New `web/src/components/form/SettingsForm.tsx`: wraps the fields in the `<form>` and React Hook Form's
    `FormProvider`, and renders the save bar under them. "Restore defaults" is on the left when the page passes
    `onRestoreDefaults`. On the right, "Reset changes" shows while there are changes, and Save is enabled only when the
    form has changes, they are valid and no save is in flight; while one is, Save shows a spinner. The bar wraps on
    phones. It mounts `UnsavedNavigationAlert` with the form's dirty state and passes `exceptTargetPaths` through.
  - New `web/src/hooks/useSettingsMutation.ts`: wraps the generated client's mutation options. A save that works
    makes the saved values what the form compares against and puts them in every field the user has not changed
    since pressing Save. Fields changed while the save was in flight keep the user's value and stay unsaved. Then it
    toasts "Saved" and refetches the queries the page names. A save that fails toasts "Could not save settings" with
    the server's reason.
  - `SwitchFormController` and `SelectFormController` in `web/src/components/util/TypedController.tsx`, beside the
    numeric and checkbox controllers: a labelled switch or select with help text in one element. The select stores the
    chosen option's own value, so a number stays a number.
  - The XMLTV page is ported as the reference: its fields are unchanged, and the refresh start hour uses the new
    select. "Restore defaults" now counts as a change (Save, "Reset changes" and the unsaved guard all apply) and hides
    once the form holds the defaults. After a save the form shows what the server saved, and the reload of the
    settings that follows no longer resets the form when it brings back those same values.
  - `docs/dev/contributing.md` (Web, "Settings pages") says how a settings page uses the shell and what its save bar
    guarantees. The other settings pages move onto it in C2, the entity editors in C3.
- **Tests:** `SettingsForm.test.tsx` (Save disabled when clean, enabled when dirty and valid, disabled when invalid
  and while saving; "Reset changes" only with changes and puts the saved values back; "Restore defaults" only when
  offered; the unsaved guard follows the dirty state and gets the exempt paths). `useSettingsMutation.test.tsx` (a save
  leaves the form clean with the server's values and toasts "Saved", refetches the given queries, runs the page's own
  `onSuccess`; a field changed while the save is in flight keeps its value and stays unsaved; a refused save toasts
  the server's reason and keeps the changes). `TypedController.test.tsx` covers both new controllers.
  `XmlTvSettingsPage.test.tsx` adds "Restore defaults" (fills in the defaults but keeps the output path, can be undone,
  saves with Save), the start hour saved as a number, Save disabled while a save is in flight, a field changed during
  a save surviving the save and the reload after it, and saved settings that fail validation staying unsaveable after
  another change; the restore and in-flight tests fail on the old page. The e2e spec `e2e/tests/xmltvSettings.spec.ts` saves a start hour and reloads (nothing
  else moves), and checks that restored defaults can be undone, warn before leaving and save.
- **Upstream:** not sent.
