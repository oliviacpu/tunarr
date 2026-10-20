### Deleting a channel, filler list or custom show asks the same question as everything else (2026-10-20)

- **What you saw:** four different delete confirmations. Media sources, smart collections, transcode configs and the
  Trash page used one dialog; channels, Filler Lists and Custom Shows each had their own copy with a different layout.
  The Filler Lists copy said "Deleting a Filler will remove all programming from the channel", which is wrong. Their
  Delete button was blue, not red, and Filler Lists and Custom Shows showed no message when the delete worked.
- **Cause:** the shared `DeleteConfirmationDialog` was added after the page-local ones and nobody went back for them.
- **Fix:** issue C5 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `DeleteConfirmationDialog` is the only delete dialog. The title names the thing ("Delete Filler List "Ad Breaks"?"),
    the body is one sentence on the consequence, Cancel is outlined and the confirm button is red and reads the verb
    (Delete, or "Empty trash"). It takes an optional `details` node under the body and an optional `busy` flag that
    disables both buttons, shows a spinner on the confirm button and stops the dialog being dismissed.
  - Filler Lists and Custom Shows use it, say "Deleted" on success and "Could not delete: <reason>" on failure, and
    their copy now describes what happens (the list or show is removed from every channel that uses it).
  - `ChannelDeleteDialog` is gone. It only deleted the channel and warned about its programming, so the channel menu
    now uses the shared dialog directly and shows the same "Deleted" and "Could not delete" messages.
- **Tests:** `DeleteConfirmationDialog.test.tsx` (title and consequence, details, outlined Cancel and red confirm,
  busy state, confirm then close in order). `CustomShowsPage.test.tsx`, `FillerListsPage.test.tsx` and
  `ChannelOptionsMenu.test.tsx` check that nothing is deleted until the dialog is confirmed, that Cancel deletes
  nothing, and that "Deleted" shows afterwards.
- **Upstream:** not sent.
