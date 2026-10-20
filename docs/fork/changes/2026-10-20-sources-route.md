### Media sources live at one address (2026-10-20)

- **What you saw:** media sources opened at both `/media_sources` and `/settings/sources`. The second copy sat inside
  the Settings layout with no matching tab (a MUI "invalid Tabs value" warning), a second page heading, and a loader
  that prefetched scanner settings it never used. The in-app links to the sources page (the library table, the
  channel programming picker and the connect-sources prompt) pointed at the Settings copy.
- **Cause:** `routes/settings/sources.tsx` rendered the same page as `routes/media_sources_/index.tsx`.
- **Fix:** the `/settings/sources` route is gone (no redirect; the page was never linked from the nav), and the three
  in-app links point at `/media_sources`. The page files moved to `pages/media_sources/MediaSourcesPage.tsx` and
  `pages/system/TasksPage.tsx` (the tasks page was routed under `/system` but lived in the settings folder); the
  components were renamed to match. The two `knownIssues.ts` entries for the Settings copy are gone.
- **Tests:** `router.test.tsx` checks that `/settings/sources` now renders the not-found page; the route is removed from
  `e2e/tests/routes.ts` so the coverage test matches the regenerated route tree.
- **Design:** `plans/ui-primitives-and-settings-audit-2026-10-19.md`, issue C6.
- **Upstream:** not sent.
