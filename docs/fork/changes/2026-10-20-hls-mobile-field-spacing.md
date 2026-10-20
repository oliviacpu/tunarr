### Separate HLS field helpers on phones (2026-10-20, PR pending)

- **What you saw:** At 390px, the HLS segment-length helper overlapped the next field's label, and the segments-before-playback helper overlapped the start-up burst label.
- **Cause:** The field stack defined its column direction only from the `sm` breakpoint, so MUI did not apply its spacing at `xs`.
- **Fix:** Start the column direction at `xs`, preserving the existing row layout from `md`.
- **Tests:** The new geometry regression fails before the fix with a 9px helper/label overlap. It passes afterward at 390px and 1440px in light and dark themes, with viewport screenshots for all four combinations. The ten existing playback settings tests, web/e2e typechecks, scoped lint and quick preflight validate the change.
- **Upstream:** Fork-only mobile layout follow-up under the approved S2/D8 audit scope (PR #85); no upstream submission.
