### Every page has the same loading, error and not-found screens (2026-10-20)

- **What you saw:** while a page loaded, Settings and System showed a progress bar and most other pages showed
  nothing until the data arrived. Spinners came in three kinds: a rotating arrow icon, MUI's circle, and a bar. A
  failed load showed the "Oops!" page with the error only inside the stack trace, and its one button reloaded the
  browser. An unknown address showed a bare "Not found!" link, a deleted filler list or custom show showed the error
  page instead, and a server error on a channel page showed "Not found!". On System › Troubleshoot, adjacent report
  sections were split by a doubled 2px line.
- **Cause:** the router had no `defaultPendingComponent`, `defaultErrorComponent` or `defaultNotFoundComponent`, so each
  page handled these itself or not at all. Pages that read with `useSuspenseQuery` kept `isPending`/`error` branches
  that could never run. The filler list and custom show loaders had `TODO handle not found`, and the channel loader
  turned every failure, a server error included, into "not found". The Troubleshoot sections are flat bordered Paper
  since the D1 theme, and each drew its own border plus MUI's divider line.
- **Fix:** issue D7 of `plans/ui-primitives-and-settings-audit-2026-10-19.md`.
  - `web/src/routerDefaults.ts`, spread into `createRouter`: a centred progress bar in place of the page
    (`PagePending`), shown after 300ms and kept for at least 300ms so it doesn't flash; the error page
    (`RouteErrorPage`), which now shows the server's message and a "Try again" button that clears the failed queries
    and reruns the route's loaders; and a "Not found" page with a link to Channels. They render inside the app shell
    (and inside the Settings and System tabs), so the per-route error component on `/settings` and the `Suspense`
    wrappers in the Settings and System layouts are gone.
  - One spinner: `components/base/LoadingIcon.tsx` is an icon-sized `CircularProgress` with a "Loading" label.
    `RotatingLoopIcon` is gone; its 15 uses and the page-level circles in the guide, the media grid and the redirect
    dialog use `LoadingIcon`. Spinners inside buttons and input adornments stay as they were.
  - Skeletons: the Channels, Filler Lists, Custom Shows, Smart Collections, Media Sources and Tasks routes show a
    `TableSkeleton` with the table's column count while they load. The channel summary's now-playing card has a
    card-shaped skeleton.
  - The unreachable loading and error branches are gone from the XMLTV, HDHR, FFmpeg and channel edit pages. General
    and Features read their settings with suspense queries that their route loaders prefetch, so the router's
    screens cover them.
  - The channel, filler list and custom show loaders throw `notFound()` when the server answers 404 or 400 for the
    id, and pass any other failure to the error page.
  - Troubleshoot's sections stack as one group with a single 1px line between them.
  - The e2e fixture finds ffmpeg and ffprobe through `TUNARR_TEST_FFMPEG` / `TUNARR_TEST_FFPROBE`, then the `PATH`,
    then `/usr/bin` (`e2e/fixture/ffmpeg.ts`), and sets them on the fixture server before it scans, so the sweep runs
    on macOS.
- **Tests:** `router.test.tsx` renders the app's route tree at `/does-not-exist` and gets the not-found page; a loader
  that throws gets the error page with its message, and "Try again" reruns the loader; a loader that throws
  `notFound()` gets the not-found page. `routeLoaders.test.ts` checks each entity loader throws `notFound()` on 404 and
  400 and passes a 500 on. `TableSkeleton.test.tsx`, `LoadingIcon.test.tsx`, `apiError.test.ts` (missing-entity check,
  error message), and `stackedAccordionSx.test.tsx` (the second and third of three stacked accordions have no top
  border; it fails without the style). The e2e `notFound.spec.ts` visits an unknown address and missing channel,
  filler list and custom show ids; the route sweep checks for the new not-found heading.
- **Upstream:** not sent.
