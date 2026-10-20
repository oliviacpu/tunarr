### The nav highlights the right section on every page, and Settings and System pages have breadcrumbs (2026-10-20)

- **What you saw:** the drawer highlighted an item only on its exact path. The scanner and features settings, the
  FFmpeg config editor, System tasks and troubleshoot, and every detail page (channel programming, filler edit, source
  pages) left the drawer with nothing selected. The mobile bottom bar used a different rule, so the two disagreed.
  Settings and System sub-pages had no breadcrumbs.
- **Cause:** `useNavItems` compared the last matched route's path to each item with `===`, and hidden child entries
  patched a few settings and system pages. `BottomNavBar` compared the first path segment.
- **Fix:** issue D6 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`. `navItemForPath` in
  `web/src/hooks/navMatch.ts` picks the visible item whose path is the longest segment-wise prefix of the current
  route; both navs use it. The Settings item now points at `/settings` (which redirects to General), and the hidden
  settings and system child entries were removed. `SettingsLayout` and `SystemLayout` render `Breadcrumbs` with an
  explicit `trail` built from their tab definitions (for example Settings › XMLTV, System › Tasks). The FFmpeg config
  pages keep their own trail.
- **Tests:** `navMatch.test.ts` maps every `fullPath` in `routeTree.gen.ts` to one top-level item and checks the
  settings, system, filler edit and time-slot-editor cases; `Breadcrumbs.test.tsx` covers the trail for a settings and
  a system page.
- **Upstream:** not sent.
