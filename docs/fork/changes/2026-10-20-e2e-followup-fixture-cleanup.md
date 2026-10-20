### E2E follow-up locators and fixture cleanup (2026-10-20)

- **What failed:** the library delete opener and tuner input locators also matched older or broader accessible names. Saved channel names and logging categories leaked into later specs that expected the seed baseline.
- **Fix:** target the filler delete button's descriptive name and the tuner input's exact label. Restore the channel's edited name, guide title and watermark in `finally`; preserve other current channel fields and omit start-time/on-demand resets. General and timing tests establish their logging-category baseline and restore only their own category values, including absent values with explicit `null` updates.
- **Scope:** existing T1/follow-up work in the approved UI audit (fork PR #85). Test-only changes; no runtime API, schema, dependencies or new test infrastructure.
- **Checks:** the five affected specs pass together with one worker (16 tests including seed), alongside e2e typecheck, scoped lint and quick preflight.

The channel update API does not clear omitted optional fields. Cleanup restores an existing guide title/watermark exactly; an originally absent title or watermark is normalized to the editor's equivalent blank title/disabled watermark state.
