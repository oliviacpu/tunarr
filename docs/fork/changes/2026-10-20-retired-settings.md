### Retired settings leave the persisted and generated contracts (2026-10-20)

- **What you saw:** settings files and API documentation retained unused Plex streaming settings and XMLTV image caching; channel and lineup contracts also exposed retired transcoding/dynamic-content fields.
- **Cause:** old schemas and endpoints remained after their runtime consumers disappeared.
- **Fix:** approved audit S3. Settings-file version 2 removes the unused keys on the main-thread startup write, preserving active sections. Remove the Plex settings endpoints and public types, the image-cache flag, the channel transcoding wire field and dynamic-content schemas/store field. Legacy lineup reads tolerate and strip the retired key. The old SQL channel column remains for historical schema compatibility; no SQL migration is part of this row.
- **Tests:** real settings-file upgrade/reload and legacy lineup read regressions, affected schema/API tests, and regenerated OpenAPI/client checks.
- **Upstream:** not sent.
