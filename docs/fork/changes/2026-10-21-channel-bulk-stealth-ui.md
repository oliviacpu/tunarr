### Batched channel visibility controls (2026-10-21, PR pending)

- **What you saw:** The Channels table sent one full-channel update per selected visibility change, with repeated derived-file work.
- **Cause:** The bulk control used the single-channel GET/PUT flow and could not distinguish committed changes from a lost batch response or a failed publication.
- **Fix:** Use the dedicated stealth API in sequential chunks of at most 100, preserving named selection snapshots and busy controls. Report item failures, publication warnings, unknown current-chunk outcomes and unsent later chunks separately. Stop after an unconfirmed response, refetch and never automatically replay the mutation. Existing channel deletion and other list operations stay on their existing paths until C7c.
- **Tests:** Helper/page/legacy bulk suites cover chunking, mixed results, stale selection names, busy state, exact single invalidation/refetch and no retry after lost or malformed responses. A real seeded browser hide/show/reload case verifies M3U output, unchanged channel data and no whole-channel writes; before/after captures are in `docs/dev/channel-bulk-actions-gallery.md`.
- **Upstream:** C7b in the approved `plans/channel-update-and-bulk-followups-2026-10-20.md`; no migration or dependency added.
