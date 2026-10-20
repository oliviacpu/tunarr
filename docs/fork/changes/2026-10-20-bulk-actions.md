### Select several channels, filler lists, custom shows or smart collections and act on them at once (2026-10-20)

- **Design:** `plans/ui-primitives-and-settings-audit-2026-10-19.md`, issue C7.
- **What you saw:** every list deleted one row at a time, each with its own confirmation, and hiding several channels
  from the guide meant opening each channel's settings.
- **Cause:** the four list tables never turned on material-react-table's row selection, and there was no shared bulk
  action.
- **Fix:**
  - Channels, Filler Lists, Custom Shows and Smart Collections have a checkbox per row and a select-all in the header
    that selects the visible page. While rows are selected, the table's toolbar shows `BulkActionsToolbar`
    (`web/src/components/base/BulkActionsToolbar.tsx`): "N selected", an outlined red Delete and, on Channels only,
    "Hide from guide" and "Show in guide". Selection lives in component state only (`useSelectableTableSettings` in
    `web/src/hooks/useTableSettings.ts`), is keyed by id, and clears when an action finishes or the page or page size
    changes. MRT's own selection banner is off.
  - Delete opens the shared `DeleteConfirmationDialog` once: "Delete 3 channels?", the names (the first ten, then "and
    N more"), busy and kept open until every delete settles. There is no bulk endpoint, so the web app sends the
    existing per-item `DELETE` for each row with `Promise.allSettled` (`useBulkAction` / `useBulkDelete` in
    `web/src/hooks/useBulkAction.ts`). The toast is "Deleted" when all succeed, otherwise "1 of 2 deleted; could not
    delete Late Night: <reason>" (up to three names, then "and N more").
  - Hide from guide / Show in guide save only the selected channels whose stealth differs. Each is read with
    `GET /api/channels/:id` first and saved with `PUT` (`toStealthUpdateRequest` in
    `web/src/helpers/channelUpdateRequest.ts`), because the channel list leaves out filler lists and subtitle
    preferences and the update replaces both with what it carries: saving the list's copy would have detached every
    filler list. The update also leaves out `startTime` (keeps a server rebase) and `onDemand` (sending it resets an
    on-demand channel's position). The toast is "Saved" or "1 of 2 saved; could not save Cartoons: <reason>".
  - The Channels table's row actions (edit, menu) moved to the last column, as on the other three tables, so the
    checkbox is the first column.
  - Keyboard: in MRT 3.2.1, Space on the focused select-all checkbox did nothing, because the header cell's shortcut
    read the checkbox's value before it toggled and then cancelled the toggle. The select-all checkbox now keeps its
    key events, so Space selects and clears the page. Row checkboxes already worked.
  - User docs: `docs/configure/channels/index.md` ("Working with several channels") and
    `docs/configure/library/index.md` ("Deleting several at once").
- **Tests:** `BulkActionsToolbar.test.tsx` (count and plural, outlined error Delete, extra actions, busy, names list
  with "and N more"); `useTableSettings.test.ts` (selection keyed by id, cleared on page and page-size change, kept on
  a no-op update); `useBulkAction.test.ts` (`settleEach` order, one failure doesn't stop the rest, server message as
  reason); `channelUpdateRequest.test.ts` (stealth update keeps filler lists and subtitle preferences, leaves out
  startTime and onDemand). Per table, selecting rows and confirming deletes exactly those ids and clears the
  selection: `ChannelsPage.test.tsx`, `FillerListsPage.test.tsx`, `CustomShowsPage.test.tsx`,
  `SmartCollectionsTable.test.tsx`. Channels also covers Hide from guide (full channel saved, filler lists kept), Show
  in guide saving only hidden channels, and a partial stealth failure naming the channel. Custom Shows covers the
  dialog staying busy until the deletes settle and a partial delete failure naming the show. Filler Lists covers the
  labelled checkboxes working from the keyboard.
- **Upstream:** not sent.
