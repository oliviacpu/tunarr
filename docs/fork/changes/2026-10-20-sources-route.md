### Media sources live at one address (2026-10-20)

- **What you saw:** media sources opened at both `/media_sources` and `/settings/sources`. The second copy sat inside
  the Settings layout with no matching tab (a MUI "invalid Tabs value" warning), a second page heading, and a loader
  that prefetched scanner settings it never used. The in-app links to the sources page (the library table, the
  channel programming picker and the connect-sources prompt) pointed at the Settings copy.
- **Cause:** `routes/settings/sources.tsx` rendered the same page as `routes/media_sources_/index.tsx`.
- **Fix:** `/settings/sources` now redirects to `/media_sources`, so old links keep working, and the in-app links point
  at `/media_sources`. The page files moved to `pages/media_sources/MediaSourcesPage.tsx` and
  `pages/system/TasksPage.tsx` (the tasks page was routed under `/system` but lived in the settings folder); the
  components were renamed to match. The two `knownIssues.ts` entries for the Settings copy are gone.
- **Tests:** `router.test.tsx` checks that `/settings/sources` lands on `/media_sources`; the e2e route sweep still
  lists the route and follows the redirect.
- **Design:** `plans/ui-primitives-and-settings-audit-2026-10-19.md`, issue C6.
- **Upstream:** not sent.
