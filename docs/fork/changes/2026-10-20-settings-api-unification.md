### Settings share one API shape (2026-10-20, PR pending)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue S6, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** settings routes mixed `/ffmpeg-settings`, `/system/settings` and `/settings/media-source`, with
  different error bodies. Some partial writes reset omitted fields to defaults or replaced whole nested objects.
- **Cause:** each settings router had its own update schema, merge behavior and errors.
- **Fix:** canonical GET/PUT routes use `/api/settings/{ffmpeg,xmltv,hdhr,media-source,system,feature-flags}`.
  Update schemas have no implicit defaults; nested values are preserved when omitted, arrays replace whole lists,
  and documented optional system values can be cleared with null. Errors use `{message}`. The web and e2e fixture
  use canonical routes. Old GET/PUT routes remain deprecated aliases for one release; unused POST reset routes are
  removed explicitly. The UI still stages Restore defaults locally. The shared media-source schema now requires
  whole-hour rescan intervals of at least one; old files normalize legacy values without losing other settings.
- **Tests:** contracts for all six sections, legacy aliases, partial/invalid/nested writes, consistent errors,
  extraction and scheduling effects, removed resets, update-schema coverage and legacy settings-file reads.
- **Upstream:** not sent.
