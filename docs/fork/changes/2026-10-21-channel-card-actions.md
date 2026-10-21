### Separate mobile channel card actions (2026-10-21, PR pending)

- **What you saw:** the local 390px channel gallery emitted React's button-nesting warning. The active-session dot was clickable but had no separate keyboard control.
- **Cause:** the mobile card's navigation `CardActionArea` rendered a button around the options `IconButton` and clickable session status.
- **Fix:** render the channel navigation, labelled options button and labelled active-session button as siblings. Keep the native navigation button's Enter/Space behavior, menu focus restoration, session dialog, compact card layout, pagination and theme colours.
- **Tests:** all nine focused component tests pass. The new structural regression fails against the old code and reproduces its `validateDOMNesting` warning. Seeded browser checks cover 390px cards in both themes, bounded page width, menu keyboard focus and dismissal, session details without navigation, and pointer/Space channel navigation. Build, monorepo and E2E typechecks, changed-file lint and formatting pass. Existing browser health allowances are reused; no new exclusions were added.
- **Upstream:** not sent; scoped fix for the existing mobile channel cards.
