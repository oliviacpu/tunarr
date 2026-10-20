### Every top-level page opens with the same header, and headings follow one outline (2026-10-20)

- **What you saw:** each page set its own title. Channels, Settings, System, Guide and Media Sources used h3; Fillers,
  Custom Shows, Smart Collections, Trash and the channel pages used h4; Library switched to h5 on phones. Search had no
  title at all, only its two inputs, and with no query it listed the whole library. Inside pages, sections were h5 or
  h6 and the Tasks heading was an h4. The top bar's "Tunarr" was the page's `h1`, and after the D1 type scale it read
  at body size.
- **Cause:** there was no shared header component, so every page picked a Typography variant by eye.
- **Fix:** issue D2 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - New `web/src/components/base/PageHeader.tsx`: optional breadcrumbs, the title as the page's only `h1`, an optional
    one-line description (body2, secondary colour, at most 72 characters wide) and actions on the right that wrap
    under the title on phones. It leaves `theme.spacing(2)` below itself.
  - Used by Channels, Guide (its date, zoom and paging controls are the header's actions), Library, Filler Lists,
    Custom Shows, Smart Collections, Trash, Media Sources, Search, the Settings and System layouts, and the channel
    summary, edit, programming, watch and new-channel pages.
  - Search has the title "Search" and, until a query is entered, the line "Type to search your libraries" in place
    of the results. `docs/misc/search/index.md` says so.
  - Section headings inside a page are h2 and groups inside a section h3: General (Web Settings, Server Settings,
    Logging, Backups), FFmpeg, Features, System Status, Debug, Tasks and Troubleshoot.
  - The top bar wordmark is no longer a heading and is set at 18px, weight 600.
- **Tests:** `PageHeader.test.tsx` (title is the `h1`; description, actions and breadcrumbs render when given and
  nothing extra when not). `SearchPage.test.tsx` (title, empty state with the inputs kept, results once there are
  keywords or a filter). `TrashPage.test.tsx` asserts the page has exactly one `h1`. The e2e spec
  `e2e/tests/pageHeadings.spec.ts` checks that every top-level page has exactly one `h1` with its title.
- **Upstream:** not sent.
