### Settings tests follow the integrated loading and navigation behavior (2026-10-20)

- **What you saw:** full CI exceeded the isolation test's one-second initial executable-field wait while system state was still loading. The combined browser sweep also waited for the transcode editor's retired breadcrumb name.
- **Cause:** the isolation helper retained Testing Library's default wait despite the neighboring FFmpeg harness already allowing ten seconds for initial fields, and the transcode test targeted an old navigation name plus its first link.
- **Fix:** T1 follow-up under the approved UI audit (PR #85). Give only the playback helper the existing bounded ten-second initial-field wait. Keep the unresolved optional-flags assertions intact. Target the current breadcrumbs' explicit Playback link and check its destination before exercising the unchanged unsaved-dialog and save assertions. No runtime code or global CI limits change.
- **Tests:** the failures were observed in full CI and the combined browser sweep. Focused settings suites and the real transcode browser file verify the corrected waits/locator; e2e typecheck, changed-file lint and formatting checks cover the test-only change.
- **Upstream:** not sent.
