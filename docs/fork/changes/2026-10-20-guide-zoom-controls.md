### Guide zoom controls sit around the duration (2026-10-20, PR #116)

- **What you saw:** the guide duration and its zoom controls were in separate groups, with Show Stealth between
  them on wide screens and unrelated controls between them when the header wrapped.
- **Cause:** the duration belonged to the start-time group while the zoom buttons belonged to navigation.
- **Fix:** the zoom-in button, duration and zoom-out button share one row that stays together when the header wraps.
  The group and both buttons have translated accessible names.
- **Tests:** `GuidePage.test.tsx` checks the control order, rendered guide range and persisted duration while zooming
  in and out, including the existing one-hour and eight-hour limits.
- **Upstream:** not sent.
