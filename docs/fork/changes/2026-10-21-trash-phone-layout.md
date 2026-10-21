### Keep Trash filters and actions reachable on phones (2026-10-21, PR #160)

- **What you saw:** the local seeded Trash page expanded to 605px at a 390px viewport, clipping later media-type filters and Empty Trash.
- **Cause:** all five labeled filters and the action buttons shared one unwrapped row.
- **Fix:** let the filter buttons wrap with complete individual borders, stack the actions below them on phones, and retain a shared row from the desktop breakpoint. Empty Trash confirmation, multi-select filtering, progress and the active job's Cancel keep their existing behavior.
- **Tests:** the new Chromium regression fails on the old 605px document. It checks 390px/1440px in light/dark themes, bounded document width and every filter/action's bounds, selecting all five types and independently clearing one, cancelling and confirming the destructive dialog, and reaching Cancel while a drain is active. Trash start/status/cancel responses are intercepted so seeded programs are never deleted. Idle/running screenshots are captured for all four cases. Existing Trash unit tests, web/E2E typechecks, lint and the worktree build pass. The browser test reuses the suite's existing known-issue filter; no exclusions were added.
- **Upstream:** not sent; bounded web layout correction found during the fork's seeded gallery capture.
