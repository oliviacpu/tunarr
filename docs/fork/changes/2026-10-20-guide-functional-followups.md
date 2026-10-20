### Guide redirect names, mobile times and sliver dividers (2026-10-20, PR #137)

- **What you saw:** Redirect guide cells displayed a channel UUID, mobile cells omitted their times and time left, and compact program dividers used the same hard-coded shadow in both themes.
- **Cause:** The title read the redirect's ID instead of its supplied channel name; the small-viewport condition returned a boolean instead of rendering its children; the compact divider bypassed the active palette.
- **Fix:** Display the supplied channel name, render times under the existing width thresholds, and pass the active theme divider to compact cells. Remove the empty, unreferenced TvGuideTimeControls file. The existing guide ramp, accent and paused styling remain unchanged.
- **Tests:** 40 focused guide tests pass, including light/dark divider regressions. The existing Playwright fixture passes the seed and guide regression, captures both themes at 390px/1440px, and checks names, mobile time text, distinct themed dividers and horizontal containment. Web/e2e typechecks, scoped lint, quick preflight and the production bundle validate the frontend-only change.
- **Upstream:** Fork-only D4 second-pass follow-up under the approved audit plan (PR #85); no upstream submission.
