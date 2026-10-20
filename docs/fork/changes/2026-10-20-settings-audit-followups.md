### Failed FFmpeg probes report a failure (2026-10-20)

- **What you saw:** unavailable FFmpeg returned a successful capability response with empty encoder lists. Default tuner settings also shared one mutable object between settings instances.
- **Cause:** the API replaced failed probe results with empty arrays, and the default settings factory returned the exported tuner defaults by reference.
- **Fix:** approved S6/B6 audit follow-ups. Return a structured server error when a capability probe fails; keep successful results intact. Create an independent tuner configuration for each settings file. S6 removes the obsolete reset route and its readonly cast separately.
- **Tests:** 18 focused server tests pass, covering real API success/failure cases and independent default-settings instances; regenerated API contract adds only the FFmpeg error response.
- **Upstream:** not sent.
