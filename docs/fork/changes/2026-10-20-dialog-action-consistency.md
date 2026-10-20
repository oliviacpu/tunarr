### Use shared dialog action labels (2026-10-20, PR #147)

- **What you saw:** Manage Libraries used a primary Close button even though each toggle saves immediately. Some dismissal buttons and delete tooltips defined the same localized action labels separately.
- **Cause:** Those sites predated the shared action vocabulary.
- **Fix:** Make Manage Libraries' Close outlined and add Close to `useActions`. Reuse shared Cancel/Close labels in existing dialogs and the selected-program drawer, and shared Delete labels in existing table tooltips. Keep descriptive accessible names, destructive styling, primary commit actions and operation-specific toasts. Disabled Delete section headings and the running trash job's Cancel remain separate.
- **Tests:** All 40 focused tests pass, covering immediate library toggles, non-committing Close, locale changes and affected consumers. The outlined-Close regression fails with the old contained variant. Web typecheck, changed-file lint and quick preflight pass. No locale catalogs or behavior/API/schema changes.
- **Upstream:** Fork-only D3 follow-up under the approved audit plan (PR #85); no upstream submission.
