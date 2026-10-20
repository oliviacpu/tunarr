### Advance calendar preview timestamps for repeated cycles (2026-10-20)

- **What you saw:** in the local seeded seven-hour calendar preview, start times repeated the first cycle and React emitted duplicate key warnings in Day and Week. This was a test-fixture finding, not a reported production incident.
- **Cause:** the preview loop wrapped its program index without advancing the cycle's start timestamp.
- **Fix:** advance that timestamp by the channel duration whenever the index wraps. Program order, existing first-partial/final-day clipping, server scheduling, API contracts and calendar layout stay unchanged.
- **Tests:** three hook regressions fail before the fix; all five now pass, covering single/mixed cycles, first partial programs, ordinary non-repeating cycles and same-day launches. The GET-only seven-hour browser case and seed pass, with two inspected 1440px Day/Week captures and distinct day labels. Existing route-specific known issues remain unchanged. Types, changed-file lint, formatting and quick preflight pass.
- **Upstream:** not sent; bounded correction to the existing web preview.
