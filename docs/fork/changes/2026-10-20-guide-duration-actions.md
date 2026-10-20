### Make guide minus reduce hours and plus add hours (2026-10-20, PR #150)

- **What you saw:** The guide controls were ordered minus / duration / plus, but minus increased the displayed hours and plus decreased them.
- **Cause:** Their handlers and accessible names followed zoom direction rather than the displayed duration.
- **Fix:** Connect minus to decreasing the duration and plus to increasing it. Name the controls “Show one hour less” and “Show one hour more”, retaining the one-hour minimum, eight-hour maximum and existing order. The existing date-navigation/reset tooltips are unchanged; these duration buttons had no individual tooltips.
- **Tests:** The two focused unit tests reject the old handler assignments and verify rendered/persisted hours, icon order, both limits and re-enabling plus after decreasing from eight hours. The existing guide browser case checks 3 → 2 → 3 and minus/duration/plus order at 390px and 1440px in both themes, with four captures. Web/e2e typechecks and quick preflight validate the scoped change.
- **Upstream:** Fork-only guide-controls follow-up under the audit plan (PR #85), explicitly requested by the user; no upstream submission.
