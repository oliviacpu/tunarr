### Batched channel deletion API (2026-10-21, PR pending)

- **What you saw:** The Channels table deletes selected channels individually, with an XMLTV/M3U refresh for each deletion and no separate result for suppressed cleanup errors.
- **Cause:** The single-channel endpoint combines committed deletion and derived work behind one promise.
- **Fix:** Add `POST /api/channels/bulk/delete` for 1–100 distinct UUIDs. Process checked deletions sequentially, continue after individual failures, retain input order and expose cleanup separately from committed removal. Publish XMLTV and M3U independently once after any successful deletion. Existing single-channel routes are unchanged; the table integration follows separately.
- **Tests:** HTTP cases cover invalid inputs, ordered mixed outcomes, sequential calls, per-item continuation, missing IDs, committed deletion with failed cleanup, and independent publication failures. The checked-deletion prerequisite supplies real SQLite/filesystem failure evidence.
- **Upstream:** C7c in the approved `plans/channel-update-and-bulk-followups-2026-10-20.md`; no migration or runtime dependency added.
