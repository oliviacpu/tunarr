### Failed FFmpeg probes report a failure (2026-10-20, PR #136)

- **What you saw:** unavailable FFmpeg returned a successful capability response with empty encoder lists. Default tuner settings also shared one mutable object between settings instances.
- **Cause:** the API replaced failed probe results with empty arrays, and the default settings factory returned the exported tuner defaults by reference.
- **Fix:** approved S6/B6 audit follow-ups. Return a structured server error when a capability probe fails; keep successful results intact. The API reads the hardware probe's Result; existing capability callers keep their empty-list fallback. Create an independent tuner configuration for each settings file. S6 removes the obsolete reset route and its readonly cast separately.
- **Tests:** API success/failure cases, an actual executable failing its hardware probe while the capability fallback stays intact, and independent default-settings instances; regenerated API contracts add the FFmpeg error response while preserving P1's hidden management routes, with the public latest spec synchronized to the versioned spec.
- **Upstream:** not sent.
