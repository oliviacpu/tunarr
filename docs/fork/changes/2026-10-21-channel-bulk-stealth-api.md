### Batched channel visibility API (2026-10-21, PR #167)

- **What you saw:** Code inspection found that hiding selected channels fetched and replaced whole channel objects and refreshed XMLTV/M3U for each channel.
- **Cause:** The existing channel update route accepts the whole editable channel, and the bulk table has no dedicated visibility operation.
- **Fix:** Add `POST /api/channels/bulk/stealth` with 1–100 unique UUIDs. Update only stealth in an immediate transaction, preserve ordered missing/no-op results, and publish XMLTV/M3U independently once after actual changes. A transaction failure reports no committed success; publication errors remain separate from committed changes. This PR adds the contract and server; the table integration follows separately.
- **Tests:** Real repository checks preserve all unrelated channel columns, filler/subtitle rows, lineup bytes and icons; a SQLite trigger exercises rollback and another proves no-op writes are skipped. HTTP tests cover input bounds, mixed IDs, ordered outcomes, rollback and independent publication failure.
- **Upstream:** C7b in the approved `plans/channel-update-and-bulk-followups-2026-10-20.md`; no migration or dependency added.
