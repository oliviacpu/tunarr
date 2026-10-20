### Stream Selection Profile management stays internal (2026-10-20, PR #123)

Design: plans/ui-primitives-and-settings-audit-2026-10-19.md, issue P1, approved by the maintainer 2026-10-19 (PR #85).

- **What you saw:** generated API documentation and the web client exposed profile CRUD and CEL validation despite
  there being no profile editor in the UI.
- **Cause:** the routes had public OpenAPI schemas.
- **Fix:** mark the six routes internal with the existing Swagger `hide` metadata and regenerate the spec/client.
  The public Latest specification mirrors the regenerated development specification; historical specifications stay unchanged.
  Server routes, persistence, profile resolution and stream evaluation remain functional; a profile UI needs its
  own design.
- **Tests:** `streamSelectionApi.test.ts` checks that every route remains registered while runtime and public Latest OpenAPI omit them, then
  exercises profile CRUD and expression validation against a migrated database. Existing resolver/evaluator tests
  verify stream selection still works.
- **Upstream:** not sent.
