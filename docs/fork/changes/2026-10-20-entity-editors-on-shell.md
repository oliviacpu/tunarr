### Entity editors share the settings form shell (2026-10-20)

- **What you saw:** channel, filler-list, custom-show and slot editors each managed their own save controls and dirty-state behavior. Slot Save stayed enabled without changes; library drafts lacked consistent navigation protection.
- **Cause:** separate form scaffolding mixed React Hook Form fields with program drafts held in the editor store.
- **Fix:** audit row C3. Reuse `SettingsForm` and `useSettingsMutation`, count program drafts and refreshed previews as unsaved changes, reset fields and drafts together, and preserve drafts when visiting Add Media. Channel tabs retain validation indicators. Creation and draft saves lock their fields while pending; Reset changes is disabled during a save. Settings-page behavior remains covered by the shared-shell tests.
- **Tests:** editor regression suites cover clean/dirty Save, validation, request payloads, failed saves, creation locks, tab navigation, draft reset and navigation protection. Shared-shell, mutation and guard suites cover their common behavior. Classic slot behavior is recorded in the infinite-schedules parity checklist.
- **Upstream:** not sent.
