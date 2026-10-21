### Checked channel deletion outcomes (2026-10-21, PR #169)

- **What you saw:** Code inspection found that existing deletion helpers log some lineup and redirect-cleanup errors without surfacing them to callers. A resolved delete promise cannot establish which cleanup work succeeded.
- **Cause:** SQLite deletion, lineup-file marking/restoration and redirect updates have separate failure boundaries.
- **Fix:** Add a checked deletion operation for the following C7c route. It verifies committed channel-row removal, reports pre-commit failures with any restoration outcome, and keeps deletion successful when later redirect cleanup fails. Checked same-ID calls serialize. Checked filesystem/redirect helpers surface errors after finishing their work; legacy single-channel deletion retains its behavior. This prerequisite adds no route or UI.
- **Tests:** Real SQLite/filesystem cases cover marking failure, rollback/restoration failure, missing rows, ignored deletes, same-ID concurrency, relation cleanup, and partial redirect-cleanup failure after commit. Existing repository/lineup regressions and typechecks pass.
- **Upstream:** C7c in the approved `plans/channel-update-and-bulk-followups-2026-10-20.md`; no migration, runtime dependency or stream/session behavior change.
