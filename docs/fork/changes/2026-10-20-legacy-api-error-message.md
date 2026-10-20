### Preserve legacy API failure reasons (2026-10-20)

- **What you saw:** channel updates and bulk actions could show a generic HTTP failure instead of the server's reason.
- **Cause:** the shared error helper read plain strings and `{ message }`, while older channel routes still return `{ error }`.
- **Fix:** accept a nonempty string in the legacy error field, prefer a nonempty canonical message when both exist, and ignore empty or malformed fields. Server response shapes and channel update behavior are unchanged.
- **Tests:** focused error-helper tests cover legacy failures, canonical precedence, and empty or malformed response bodies.
- **Upstream:** small client compatibility correction from the C7 follow-up inventory; no API change.
