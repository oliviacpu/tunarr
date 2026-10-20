### Keep week-calendar days aligned inside a bounded viewport (2026-10-20, PR pending)

- **What you saw:** at phone width, week headers expanded the page to 1048px while the separately scrolling body clipped later days.
- **Cause:** headers and body used separate width/overflow rules, and their leading gutters differed by the divider width.
- **Fix:** put both rows and the hour gutter inside one native horizontal scroll viewport, share day sizing and gutter alignment, keep the time axis and divider visible while scrolling, and allow the toolbar to wrap. All seven days remain reachable; desktop columns fill the available width. The scroll region is named and keyboard focusable. Scheduling, date selection, navigation, zoom and palette behavior are unchanged.
- **Tests:** the new browser regression fails on the old 1048px document at a 390px viewport. GET-only synthetic programming starts on Tuesday with a 24-hour cycle; checks cover bounded page width, all seven header/column pairs before and after scrolling, keyboard scrolling with persistent hour labels, reachable Tuesday/Saturday programs and selecting a later day. Captures cover 390px/1440px in both schemes. A component regression preserves date callbacks and week navigation across zoom changes; existing calendar palette tests remain covered.
- **Upstream:** not sent; scoped correction to the existing web preview.
