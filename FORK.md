# About this fork

This is a personal fork of [chrisbenincasa/tunarr](https://github.com/chrisbenincasa/tunarr), built into a Docker image
for one self-hosted deployment. It follows upstream's `main` and adds the targeted fixes and features listed below.
Upstream's own documentation, `CLAUDE.md` and `AGENTS.md` still apply.

## Builds

- Images are built only for tags named `oliviacpu-…`, by date: `oliviacpu-2026.10.13`, with `.2` for a second one the same
  day. Pushes to `main` build nothing (`.github/workflows/fork-image.yml`). To release:
  `git tag oliviacpu-2026.10.13 && git push origin oliviacpu-2026.10.13`.
- Each build pushes `ghcr.io/oliviacpu/tunarr:<tag>`, `:sha-<commit>` and `:latest` (always the newest) for
  linux/amd64, and creates a GitHub Release for the tag. Its notes list what's new since the previous `oliviacpu-` tag and
  every fork commit on top of upstream. To roll back, deploy an older release's `:<tag>` image.
- The version Tunarr reports is `<upstream version>-<tag>`, e.g. `2026.10.2-oliviacpu-2026.10.13`.
- Upstream updates come in with `git fetch upstream && git merge upstream/main`.
- **ffmpeg:** the image's `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` are jellyfin-ffmpeg (see below). The base image's
  ErsatzTV ffmpeg 7.1.1 stays at `/usr/local/bin/ffmpeg`. To fall back to it without a new image, set the FFmpeg paths
  to `/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe`. The settings page hides them in a container, so use the API
  (`PUT /api/ffmpeg-settings`) or `tunarr settings update`. To bump jellyfin-ffmpeg, change `jellyfin_ffmpeg_version` and
  `jellyfin_ffmpeg_sha256` in the `Dockerfile`. The digest is the release asset's:
  `gh api repos/jellyfin/jellyfin-ffmpeg/releases/tags/v<version> --jq '.assets[] | select(.name | test("portable_linux64-gpl")) | .digest'`.

## Changes in this fork

Newest first. Each one is its own commit with a test, so it could be sent upstream later on its own
(`git cherry-pick <commit>` onto a branch from `upstream/main`).

<!-- Entry format:
### Short title (YYYY-MM-DD, commit)
- **What you saw:** the symptom.
- **Cause:** what in the code produced it.
- **Fix:** what changed, with the files.
- **Upstream:** not sent / issue or PR link.
-->

### Guide posters are served from a public media folder, with versioned addresses (2026-10-15)

- **What you saw:** guide posters loaded slowly in Plex's apps, and a replaced poster kept showing the old picture.
  One poster took 1.4 s and 628 KB per load, with `Cache-Control: no-cache`.
- **Cause:** the guide linked each programme to `/api/programs/<id>/artwork/<type>`, which fetches the picture from
  the media server again on every request and passes the server's caching headers through. The address never
  changed when the picture did, and Plex's image cache (3 days) and its apps key by address.
- **Fix:** each guide write publishes every programme's picture as a file in `<data>/media/artwork/`, and the guide
  links to it (`services/PublicMediaService.ts`, `services/XmlTvWriter.ts`, `Server.ts`).
  - **Address:** `/media/artwork/<id>-<type>.<ext>?v=YYYYMMDDHHMMSS`, served with
    `Cache-Control: public, max-age=31536000, immutable` and `nosniff`. The version is the second (UTC) the bytes were
    saved. A rescan that finds the same bytes keeps the address, and two changes within one second get versions one
    second apart.
  - **One file per version:** each version is its own file, `<id>-<type>.<version>.<ext>`. A small route maps the
    `?v=` to it, so an address always serves the bytes it was published with, even to a client still holding an
    older guide. A replaced version is kept for 30 days. A request without a valid version, or for a version that
    doesn't exist, gets a 404 with no cache header.
  - **Cheap when nothing changed:** the guide already loads each picture's artwork row, so it passes the row's cache
    or source path along. A picture whose source matches what was published needs no lookup. Each picture yields to
    the event loop first. On the guide rebuild perf test (1,375 pictures, all unreachable), the longest request stall
    went from 2.6 s to 15 ms.
  - **Fetching:**
    - A picture is fetched again only when its source changes (a Plex path ends in Plex's own timestamp for the
      image), or after 7 days, with at most 20 such refreshes per write.
    - Only JPEG, PNG, WebP, GIF and AVIF are published, judged by the bytes; an SVG could run script on Tunarr's
      origin.
    - A fetch is cut off at 10 s and 25 MB, and a failed one is retried after an hour.
    - One write spends at most 60 s on pictures. Past that, the rest skip their lookups and keep the files they have,
      and a fetch still running is cut off.
    - Anything not published keeps the artwork route address.
    - A failed fetch is logged with its URL and error code only, never the error object, which carries the
      request's headers and so the media server's token.
  - **Index:** `<data>/media/artwork-index.json`, outside the served folder. It's a JSON file rather than a table, so
    the fork adds no migration to collide with upstream's numbering. If it's lost, a version already on disk with the
    same bytes is adopted, so its address doesn't change.
  - **Cleanup:** pictures no guide write has linked for 30 days are deleted, along with their earlier versions.
  - **Uploads:** an `/images/uploads/…` request carrying `?v=` (every upload URL since the logo fix) gets the same
    year-long immutable header. Without `?v=` it keeps `max-age=0` (`versionedUploadCacheControl`, `util/iconUtil.ts`).
  - **Not changed:** credit images and the web UI keep the artwork routes.
  - **Docs:** `docs/configure/clients/plex.md`.
- **Tests:**
  - **`PublicMediaService.test.ts`:**
    - the file and version;
    - an unchanged source isn't fetched again;
    - a matching source hint skips the lookup;
    - the same bytes from a new source keep the address;
    - new bytes get the next second, and the old URL keeps its bytes;
    - a new format keeps the old one at its old URL;
    - a replaced version is kept 30 days, then deleted;
    - the weekly refresh;
    - an SVG is never published;
    - failed fetches back off for an hour, including a replaced picture whose new source fails;
    - past the budget, later pictures skip their lookups;
    - a lost index adopts the file;
    - the 30-day cleanup;
    - URL-to-file mapping refuses malformed names and versions;
    - load errors are described without headers.
  - **`XmlTvWriter.test.ts`:**
    - the source hints;
    - a write publishes each picture once, and the `<icon>` and `<image>` link to the file;
    - a failed publish still writes the guide.
  - **`iconUtil.test.ts`:** the upload header.
  - **Throwaway server, local movie library:**
    - the guide linked both posters, served with the immutable header (`HEAD` too);
    - a second write kept both addresses;
    - after one poster was replaced and rescanned, its new address served the new bytes and its old address still
      served the old ones;
    - missing, short or unknown versions, `..` paths and `.svg` all returned 404, with no cache header.
- **Upstream:** not sent.

### An HLS Direct v2 channel with subtitles starts even when no one is talking (2026-10-14)

- **What you saw:** an HLS Direct v2 channel with subtitles on never started. Tunarr waited for the subtitle
  playlist (`subs.m3u8`), gave up after 15 s with "Stream not ready yet", and the stream failed. With subtitles off, or
  in another stream mode, the same channel started.
- **Cause:** ffmpeg's segment muxer, which writes the WebVTT subtitle track (`HlsSubtitleOutputFormat`), writes
  `subs.m3u8` only when it closes a subtitle segment, and it closes one only when a cue arrives after the segment's
  end. HLS Direct v2 maps a program's embedded subtitles from the program's own input, which ffmpeg reads at playback
  speed after a 60 s read-ahead. So a stream that started more than about 75 s (the read-ahead plus the 15 s start-up
  wait in `HlsSession.getAdditionalRequiredFiles`) before the next lines of dialogue had no `subs.m3u8` in time, though
  its video segments were ready. That covers opening credits, a quiet scene, or a forced-only subtitle track. The other
  modes burn subtitles in, or read an extracted subtitle file at full speed, so they didn't hit this.
- **Fix:** before a program with a subtitle track starts, `HlsSession` writes an empty live `subs.m3u8` if there isn't
  one. ffmpeg replaces it when it closes its first subtitle segment. A playlist an earlier program left is kept, so a
  client never sees it emptied. Start-up still waits for `subs.m3u8`, which now exists from the start
  (`server/src/stream/hls/HlsSession.ts`).
  - **Docs:** `docs/configure/ffmpeg/index.md` says HLS Direct v2 always serves text subtitles as WebVTT, that its
    subtitle track can be empty until the next line, and that the experimental switch is for the HLS mode.
  - **stream-repro:** `--subs-start S` puts each clip's first cue S seconds in, and `--no-subtitles` turns the
    channel's subtitles off. Cue times past 59 s are now valid SRT.
- **Tests:** `HlsSession.test.ts`: a session whose program has subtitles is ready as soon as its video is, before
  ffmpeg writes a subtitle segment (without the fix, start-up gives up after 15 s with "Stream not ready yet"); a
  playlist an earlier program left is kept; a program without subtitles gets no subtitle playlist. With stream-repro
  (`--mode hls_direct_v2 --layout subs --clips 2 --clip-seconds 150 --subs-start 90`): before, start-up failed after
  15 s with 8 video segments ready and no `subs.m3u8`. After, the channel started in about 1 s, and `subs.m3u8` was
  empty until the program reached its first cue at 90 s, then listed the lines.

### Tunarr warns when a channel's transcode falls behind real time (2026-10-14)

- **What you saw:** a channel paused briefly every so often, for many minutes, and Tunarr logged nothing. Timing the
  segment files by hand showed 2.002 s segments arriving every 2.1 to 2.3 s, about 0.95x real time, so players kept
  running dry. The source was 10-bit HEVC 1080p, transcoded to libx264 `veryfast` with `-threads:v 4`. Raising the
  transcode config's thread count to 8 fixed it.
- **Cause:** nothing measured how fast a transcode produces video. A transcode below real time looked the same as a
  healthy one in the logs.
- **Fix:** while an HLS transcode runs, Tunarr follows its playlist and compares the video it produces with wall-clock
  time. When a program stays below 0.98x over a minute of output, and keeps there for 20 s more, it logs one warning
  naming the channel, the program, the speed and the transcode config's thread count, with the remedies. It logs one
  info line if the program gets back to 0.99x, and nothing more for that program.
  - **Measuring:** `TranscodeSpeedMonitor` (`stream/hls/TranscodeSpeedMonitor.ts`) takes "a segment of N seconds
    finished at T" and reports the change of state. Time counts from the first segment, so ffmpeg's start-up and
    probing don't count. The initial read burst only makes the speed higher. The extra 20 s keeps a stall that ffmpeg
    catches up (a slow disk or network read) from warning.
  - **Following the playlist:** `TranscodeSpeedWatcher` (`stream/hls/TranscodeSpeedWatcher.ts`) reads the end of
    `stream.m3u8` every 2 s. It takes durations from `EXTINF` and finish times from the segment files' mtimes, so the
    poll interval doesn't affect the measurement. Segments of earlier programs, which share the playlist, are skipped.
  - **Wiring:** `HlsSession.transcode` starts a watcher before each program's ffmpeg and stops it when ffmpeg exits.
    `hls_direct_v2` copies the video and isn't watched.
  - **Docs:** `docs/misc/common-issues.md` ("Playback pauses every few minutes"): the warning and the remedies.
- **Tests:** `TranscodeSpeedMonitor.test.ts`: real time gives nothing; 0.95x gives one warning, after 80 s; recovery
  gives one info line and nothing after it; a slow start, a long first segment, a fast initial burst, a caught-up
  stall and a program shorter than the window give nothing; the log line's wording. `TranscodeSpeedWatcher.test.ts`:
  playlist parsing, mtime timing, skipping earlier programs' segments, a playlist longer than the part read, and a
  poll still running when the watcher stops delivering nothing (programs share one playlist, so it would otherwise
  read the next program's segments under this one's name; found by the Codex review).
  `HlsSession.test.ts`: the watcher runs for exactly the life of ffmpeg, the warning reaches the log, and
  `hls_direct_v2` isn't watched. Checked end to end with stream-repro and 2 s segments: a single-thread `medium`
  transcode logged one warning (`Channel 900 (Repro) is transcoding "clip01" at 0.23x real time …`) under two minutes
  after its first segment, matching the segment files' timing. A fast 360p transcode over two programs, the first
  with the 60 s read burst, logged nothing.

### Closed captions say "No captions for this program" when a program has no subtitles (2026-10-14)

- **What you saw:** Plex decides which caption tracks exist at tune-in, so it offers CC for the whole Live TV session.
  On a program without subtitles, a viewer who turned CC on saw nothing and couldn't tell whether captions were broken.
- **Why:** the HDHomeRun `.ts` stream carries the caption track on every frame, whatever is on, but only programs with
  subtitles put any text in it.
- **Change:** a program with no subtitles gets one caption, "No captions for this program", on screen from 1 s to 5 s
  into its stream (`noCaptionsNotice`, `server/src/stream/captions/ProgramCaptions.ts`).
  - **Same pipeline:** `FfmpegStreamFactory` hands the notice to `HlsSession` as the program's captions, so it is an
    ordinary pop-on caption at the bottom, in the default style, with the Caption Alignment setting. No new setting: it
    is on wherever the captions are (**Closed captions for HDHomeRun clients**, an HLS channel with subtitles enabled).
  - **Which programs:** lineup items of type `program` (scheduled programs, custom show episodes, what a redirect
    resolves to) with no subtitle track at all. Filler (`commercial`, from filler lists), flex fallback filler
    (`fallback`), offline and error streams, music tracks and streams under 8 s get none. A program whose subtitles
    can't become captions (image-based, forced only, another language) is left as it was.
  - **Tune-in:** a program's caption clock starts where its stream starts, so a viewer who tunes in partway through a
    program gets the notice too.
  - **Timing:** 4 s is about twice the time its five words take to read. It starts 1 s in rather than at 0 because a
    session's first program has no frames for the first two slots of its caption schedule: the encoder's B-frame delay
    puts its first video frame at PTS 6000 (two frames at 30 fps, with libx264) where the schedule expects 0. A notice
    loaded from the first frame lost its Resume Caption Loading code and never showed. From 1 s, it loads in the 17
    frames before it appears. Below 23.976 fps, 1 s is too few frames for the load after the two lost slots, so the
    notice starts at least 23 frames in (`noCaptionsNoticeStartMs`; about 1.5 s at 15 fps). Found by the Codex review.
  - **Docs:** `docs/configure/ffmpeg/index.md`.
- **Known limit, not changed here:** the same two-frame delay makes a session's first program show its own captions
  two frames early, and a cue already under way at tune-in can be lost on it. Later programs start exactly at their
  offset.
- **Tests:** `ProgramCaptions.test.ts` (which programs get the notice, its cue), `Cea608Encoder.test.ts` (bottom row,
  block-centred, shown on frame 30 and erased on frame 150 at 30 fps), `FfmpegStreamFactory.test.ts` (no subtitles,
  image-based subtitles, filler, fallback, captions off, an offline gap), `HlsSession.test.ts` (served whole on a first
  program whose video starts two frames late). Checked with stream-repro on a throwaway server: an HLS channel of
  `mixed` clips (1 and 3 without subtitles, 2 with), captions and subtitle extraction on, its `.ts` URL captured for
  110 s and decoded with ffmpeg's 608 decoder. The notice showed for 4.0 s after tune-in partway through clip 1, then
  clip 2 had only its own captions, then the notice showed 1 s into clip 3 and into clip 1 again.

### A subtitle the media server no longer has is one info line, not a warning with a stack (2026-10-14)

- **What you saw:** since early October, library scans logged three warnings for each external subtitle that Plex no
  longer had: `Not found: …/library/streams/<id>`, `API client response error: … status 404 …` with Plex's HTML 404
  page and headers, and `Error while requesting external subtitle stream: Request failed with status code 404` with a
  stack trace. The scan skipped that subtitle and carried on, so nothing was broken, but it read like a failure.
- **Cause:** when a subtitle file is replaced or deleted, Plex keeps listing its stream until it rescans the item, and
  answers 404 when asked for it. The API client warned about every 404, Plex's subtitle fetch turned the 404 into a
  generic request error, and the downloader logged every fetch failure as a warning with the error object.
- **Fix:**
  - **The fetch:** the subtitle fetches (`PlexApiClient.getSubtitles`, and `getSubtitles` and `getSubtitlesByPath` in
    `JellyfinApiClient` and `EmbyApiClient`) report a 404 as `not_found` (through `BaseApiClient.requestErrorResult`).
    They pass a new `notFoundIsExpected` request option, so `BaseApiClient.doRequest` logs that 404 as one debug line
    instead of the two warnings. Every other request still warns about a 404.
  - **The log line:** `ExternalSubtitleDownloader` logs a `not_found` at info, as one line without the error. Any
    other failure is still a warning with the error. After the media server rescans the item its streams change, so
    Tunarr's next library scan rescans it and picks up the new subtitle. The line reads:
    `Plex no longer has subtitle stream 173516 for "The Movie" (item 4242); skipped until Plex rescans the item.`
  - **Its text:** `missingSubtitleMessage`. The stream id comes from `externalSubtitleStreamId` (`util/subtitles.ts`):
    Plex's stream id, or the stream index for Jellyfin and Emby, never a query string. The scanner
    (`MediaSourceScanner.ts`) and `SubtitleExtractorTask.ts` pass the program's title for it.
  - **Info, not debug:** the program plays without that subtitle until the media server rescans the item. That is
    worth seeing at the default log level, but it isn't a fault.
  - **Emby:** its subtitle fetches never caught request errors. They checked the return value for an error, which
    `doGet` never returns, so a failed fetch escaped as an exception and the scan logged it with the whole program
    record. They now return a failure like Plex and Jellyfin.
- **Tests:** `ExternalSubtitleDownloader.test.ts` (new): a 404 is one info line with no error and no warning, any other
  failure is still a warning with the error, and the message names Jellyfin and Emby streams by index without the
  query string. `MediaSourceScanner.test.ts` (new): of two sidecars, a 404 on the first logs the one line and the
  second still downloads; a 500 still warns with the error and the second still downloads. `subtitleRequests.test.ts`
  (new): Plex, Jellyfin and Emby subtitle fetches against a local HTTP server; a 404 is `not_found` with only a debug
  line, and a 500 is a generic failure that still warns. `BaseApiClient.test.ts`: a 404 still warns by default, an
  expected one is a single debug line, and other statuses still warn. Nine of the new tests fail without the change.
- **Upstream:** not sent.

### A replaced channel logo gets a new address, so Plex shows it (2026-10-14)

- **What you saw:** after replacing all six channel logos, Plex and its Apple TV app kept showing the old ones, through
  a guide refresh and an app restart.
- **Cause:** an upload keeps its file name (a channel's logo is always `<channel id>_icon.<ext>`), and the upload route
  returned the bare file URL. A replaced logo kept its exact address, and everything that caches images by address
  (Plex's image cache, its apps, Tunarr's own cache for watermarks) went on serving the old picture.
- **Fix:** `POST /api/upload/image` returns the URL with `?v=` and the first 12 hex digits of the image's SHA-256
  (`uploadedImageUrl`, `util/iconUtil.ts`). A different image under the same name gets a new address; the same image
  uploaded again keeps its address. Channel logos, offline pictures and watermarks all go through this route.
  - **What still works:** the file is served without the query string. Clearing an icon still finds its file to
    delete, because `extractLocalUploadFilename` reads only the path. Tunarr's image cache keys by the whole URL.
  - **Docs:** `docs/configure/channels/properties.md` (versioned addresses) and `docs/configure/clients/plex.md` (a new
    logo appears after Plex's next guide refresh, which ends a playing Live TV stream).
  - **Existing logos:** ones uploaded before this keep their old address until uploaded again.
- **Tests:** `iconUtil.test.ts`: the URL's shape, a different image gets a new URL, the same image keeps it, and the
  file name can still be read back. Checked end to end on a throwaway server: two images uploaded under one name got
  different URLs, and each served its own image.
- **Upstream:** not sent.

### The nightly collection sync runs in a scan worker (2026-10-14)

- **What you saw:** nothing specific. It was the last scan work left on the main thread: `SyncCollectionsTask` (daily,
  00:00) read and wrote every remote source's collections there, on the thread that serves streams.
- **Fix:** the task now queues a `collections` job per remote media source with `MediaSourceScanCoordinator`, which
  runs it like a library scan: in a scan worker when there is one, one job at a time.
  - **The job:** `{kind: 'collections', mediaSourceId}` (`types/worker_schemas.ts`). `ScanJobExecutor` re-reads the
    source when the job starts and skips it if the source is gone, local, or has no collection scanner.
  - **Lock:** each source's sync has its own lock (`EntityMutex.getLockForCollections`), so a sync still queued from
    the night before isn't queued twice. It's separate from the source's lock, so its libraries don't show as locked
    and can still be scanned.
  - **No reconcile:** collections change tags, not durations, so a collections job doesn't reconcile channel
    durations.
  - **Cancel:** the collection scanner can't stop partway, so a canceled sync ends when its scan does; in a scan
    worker, the worker is terminated after 30 s.
- **Checked end to end** on a throwaway server with a Plex source: running the task queued the sync, a scan worker
  started, and the collection scan ran in it.
- **Tests:** `ScanJobExecutor.test.ts` (a sync, a gone or local source, no scanner, a cancel),
  `MediaSourceScanCoordinator.test.ts` (queued once, no reconcile, libraries not locked, local refused), and a new
  `SyncCollectionsTask.test.ts` (queues each remote source with a collection scanner, scans nothing itself).
- **Upstream:** not sent.

### A scan A/B bench, and a latency probe for a running server (2026-10-14)

- **Why:** to show that scans in a worker thread stop stalling the main thread, here and on a real server.
- **`pnpm bench:scan-worker`** (`scripts/scan-worker-ab.ts`):
  - **What it runs:** a fresh migrated database per run, a local movie source over 1,500 hard-linked clips, and the
    initial scan, with `TUNARR_SCAN_IN_WORKER` off and on. The arms alternate (A B, then B A), and both use the same
    worker pool.
  - **What it measures:**
    - an HTTP probe every 10 ms, timed from when each probe was due;
    - **main-thread CPU:** the CPU time the scan adds to the server's main thread (`ps -M` on macOS, `/proc` on
      Linux), which a busy machine doesn't distort;
    - **write-lock wait:** a second connection, in its own thread, times `BEGIN IMMEDIATE` every 50 ms, as a main-thread
      write (play history at a program start) would wait on the scan's transaction;
    - the bench's own event-loop lag, to tell a busy machine from a stalled server.
  - **Pass:** the worker arm adds at most 10% of the in-process arm's main-thread CPU, and the write wait's p99 stays
    under 25 ms. Worst cases (probe stall, longest write wait) must stay under 100 ms, judged only when the bench's
    own loop kept up.
  - **Result** on a loaded laptop (1,500 clips, 2 trials, medians):
    - main-thread CPU for the scan: 11.5 s in-process, 0.0 s in the worker;
    - write-lock wait p99: 6.3 ms in-process, 6.6 ms in the worker;
    - worst cases were not judged, because the bench's own loop lagged up to 166 ms.
- **`scripts/probe-latency.mjs`**: plain Node with no dependencies, for a running server.
  - Probes `/api/xmltv-last-refresh` on a cadence and can read a channel's `.ts` the way an HDHomeRun client does,
    timing the gaps between chunks and noting if the stream ends.
  - Basic auth comes from `TUNARR_BASIC_AUTH_USER`/`PASSWORD`, read from the environment or from `--auth-env FILE`, so
    credentials never appear in the process list.
  - **First use, on the in-process build:** a forced 91 s Plex movie-library scan stalled the API for up to 3.4 s (53
    probes over 250 ms, against 1 in the two minutes before). The `.ts` stream's longest gap was 3.5 s, against
    about 2 s, one segment, at idle.
- **Upstream:** not sent.

### The worker smoke test runs a real scan in a scan worker (2026-10-14)

- **Why:** the unit tests drive the scan worker over a `MessageChannel`, but only a real server shows that a scan
  worker boots, scans and reports back. `scripts/worker-smoke-test.ts` already starts the real entry point for the
  worker pool.
- **Change:**
  - **Scan checks:**
    - generates one short clip with ffmpeg, hard-links it into 12 movie folders, points the FFmpeg paths at this
      machine's ffmpeg and ffprobe, and creates a local movie source;
    - checks that its scan runs in a scan worker, with the scanner's log lines marked `"worker":true`;
    - checks that all 12 programs are saved and progress ends as `not_scanning` on the main thread.
  - **SIGTERM:** a forced rescan is started and SIGTERM is sent once it is scanning in its worker. The server must
    exit within 10 s.
  - **`--binary` works through pnpm:** `pnpm test:worker-smoke -- --binary …` forwards the `--`, and `parseArgs`
    read every flag after it as a positional. The binary flag was dropped silently and the dev server was tested
    instead. The leading `--` is now removed, and an unknown flag is an error.
  - **Loopback only:** the test server binds to 127.0.0.1, since it mounts the debug endpoints.
- **Upstream:** not sent.

### Library scans run in a worker thread, so live streams don't stall (2026-10-14)

- **What you saw:** live streams paused while a library scanned. A music rescan stalled the server for up to 3.6 s at a
  time.
- **Cause:** better-sqlite3 is synchronous, and scans ran on the main thread. That thread also serves HLS segments,
  playlists and the HDHomeRun `.ts` stream that Plex reads, so every scan query and write blocked streaming.
- **Fix:** `WorkerScanJobRunner` (`services/scanner/`) runs each scan job in a fresh worker thread with its own
  database connection. The coordinator stays on the main thread and keeps the queue, locks, progress and the
  duration reconcile after each job.
  - **One worker per job:** each job gets current settings and media source credentials, and no memory is held
    between scans. When the job ends, the worker is asked to exit and is terminated if it hasn't within 5 s.
  - **Progress:** the worker's progress messages are applied to the main thread's `MediaSourceProgressService`, so
    the UI is unchanged.
  - **Start-up:** a worker has 60 s to report it started (180 s in dev, where tsx compiles the server first). If it
    doesn't, the job runs on the main thread as before. After 3 failed starts in a row, scans stay on the main thread
    until restart.
  - **Cancel:** the worker gets a `cancel` and is terminated if the job hasn't stopped within 30 s. A job canceled
    while its worker is starting never runs. Terminating a worker mid-transaction rolls the transaction back and
    frees the write lock.
  - **Crash:** a worker that dies mid-job fails that job without running it again; the next scan starts a new worker.
  - **Shutdown:** `MediaSourceScanCoordinator.shutdown(graceMs)` cancels every job and skips the reconcile. `Server`
    gives the running scan 2 s, then its worker is terminated. A worker still starting is terminated at once (found by
    the Codex review).
  - **Switch:** `TUNARR_SCAN_IN_WORKER` (default on) needs `TUNARR_USE_WORKER_POOL` (default on). With either off,
    scans run on the main thread as before. `ServicesModule` picks the runner; worker threads always scan in-process.
  - **Docs:** `docs/getting-started/run.md` adds the switch and corrects the pool's defaults (on, at most 8 threads).
- **Tests:**
  - new `WorkerScanJobRunner.test.ts` (fake worker): progress, a fresh worker per job, start-up fallback, the 3-failure
    limit, a crash, a reported failure, cancels honored and ignored, a cancel during start-up, shutdown during a job and
    during start-up, and a worker that won't exit;
  - new `ScanWorkerRoundTrip.test.ts`: the runner and a real `ScanWorker` over a `MessageChannel`;
  - new `workerTerminateReleasesLock.test.ts`: a real worker thread holding a write transaction is terminated, and
    the lock is free and the row gone.
- **Upstream:** not sent.

### A scan worker role and its message protocol (2026-10-14)

- **Why:** groundwork for running library scans in a worker thread, so they stop stalling live streams. Nothing uses
  it yet; the entry above switches scans over.
- **Change:**
  - **Protocol** (`types/worker_schemas.ts`):
    - `WorkerRole` (`pool` or `scan`);
    - main to worker: `ScanWorkerRequest` (`scan`, `cancel`, `shutdown`);
    - worker to main: `ScanWorkerMessage` (`started`, `scan-progress`, `scan-done`, `scan-failed`).
  - **Starting a worker:** `TunarrSubprocessService.createWorker(opts, role)` passes the role in `workerData` and
    guards a missing entry script instead of using `process.argv[1]!`. `start-worker` starts a `ScanWorker` for
    `role: 'scan'`, and a pool worker otherwise; workers without a role are pool workers.
  - **`ScanWorker`:**
    - runs one `ScanJob` at a time through `ScanJobExecutor`, on its own database connection;
    - relays its `MediaSourceProgressService` events, sanitised and coalesced to whole percents;
    - aborts the job on `cancel`, refuses a second job while busy, and flushes logs before exiting on `shutdown`.
- **Test:** new `ScanWorker.test.ts`, run over a real `MessageChannel`.
- **Upstream:** not sent.

### Write transactions start IMMEDIATE, so a second writer can't fail them (2026-10-14)

- **Why:** library scans are moving to a worker thread, which has its own SQLite connection. That makes the worker the
  second writer to the same database, alongside the main thread. In WAL mode, a DEFERRED transaction (Drizzle's
  default) that reads and then writes fails at once with `SQLITE_BUSY_SNAPSHOT` if the other connection committed in
  between; the busy timeout doesn't apply. better-sqlite3's busy wait also blocks the thread that waits, and the main
  thread serves the streams.
- **Change:**
  - **Immediate by default:** `withImmediateTransactions` (`db/immediateTransactions.ts`, applied in `DBAccess`)
    makes `drizzle.transaction(fn)` start with BEGIN IMMEDIATE unless the caller passes its own `behavior`. The
    write lock is taken up front, so a read-then-write can't fail that way. Applying it in one place keeps the 31
    call sites unchanged, and new transactions get it too.
  - **Busy timeout:** the main thread's connection keeps 5 s; worker threads get 30 s, since they can afford to wait.
  - **Checkpoint:** `ProgramStateRepository.checkpointAndOptimize` runs the TRUNCATE checkpoint with
    `busy_timeout = 0` and restores the timeout afterwards. While another connection holds a transaction, the
    checkpoint just reports busy instead of blocking the main thread for 5 s.
- **Test:** new `sqliteWriteContention.test.ts`, on a pre-migrated database with a second raw connection standing in
  for a worker:
  - a deferred read-then-write fails after another connection commits;
  - Tunarr's transactions hold the write lock before their first write;
  - an explicit `behavior` still applies;
  - the checkpoint returns in under a second while another connection holds a snapshot, and the busy timeout is
    restored.
  - The second and fourth fail on the old code.
- **Upstream:** not sent.

### Scan jobs go through a runner, and re-check the library when they start (2026-10-14)

- **Why:** this prepares for running scans in a worker thread, so the coordinator can hand a job to whichever runner
  is configured. It also fixes a latent problem: a queued job checked whether its library was available only when it
  was queued. A job that waited hours behind others could then scan a library the server no longer reports, which
  marks every program in it missing.
- **Change:**
  - **The job:** `ScanJob` (`types/worker_schemas.ts`, zod) describes a scan by IDs and flags only. A local job is
    `{kind: 'local', mediaSourceId, force, pathFilter?}`; a remote one is `{kind: 'library', libraryId, …}`.
  - **The executor:** `ScanJobExecutor` re-reads the library or media source when the job starts. It skips the job
    if the library is gone or unavailable, wires the abort signal to `scanner.cancel`, and runs the library scan,
    then the collection scan (not after a cancel).
  - **The runner:** `ScanJobRunner` (bound at `KEYS.ScanJobRunner`) runs one job. `InProcessScanJobRunner` runs it on
    the calling thread, as before.
  - **The coordinator:** `MediaSourceScanCoordinator` still refuses unsupported libraries up front and keeps the
    queue, locks and progress. It doesn't reconcile durations after a skipped job.
  - **`awaitAllFinished`:** now also waits for each job's cleanup, not just for the queue to go idle.
- **Tests:** new `ScanJobExecutor.test.ts`; `MediaSourceScanCoordinator.test.ts` now uses a fake runner.
- **Upstream:** not sent.

### A failed or canceled scan no longer leaves its library locked or "scanning" (2026-10-14)

- **What you saw:** nothing obvious yet; found while planning to move scans into a worker thread.
  `MediaSourceScanCoordinator` had several ways to leave a library stuck:
  - **Lock leaks:** if no scanner could be created, the library's lock stayed taken until restart, because the early
    return came after `lock.acquire()`.
  - **Stuck progress:** a scan that threw, or was canceled, stayed "in progress" in the UI, because only a scanner
    that finishes normally calls `scanEnded`.
  - **Cancel ignored:** a job canceled while still queued ran anyway, because the abort listener was added only once
    it started.
  - **Wasted work:** a canceled library scan was still followed by a full collection scan.
  - **Shutdown:** `awaitAllFinished` waited only for the queue to empty, not for the running scan.
- **Fix:** both `add` and `addLocal` now go through one `enqueue` helper.
  - **Order:** the scanner is created before the lock is taken.
  - **Cleanup:** whatever happens to the job, the lock is released, the abort controller is dropped, and progress
    ends.
  - **Cancel:** a job canceled before it starts doesn't run, and the collection scan is skipped after a cancel.
  - **Reconcile:** duration reconciliation runs only after a job that actually ran.
  - **Shutdown:** `awaitAllFinished` uses `onIdle`.
  - **Tidy-ups:** the queue and controllers are instance fields (the coordinator is a singleton), and a local source
    without a media type is refused instead of hitting `mediaType!`.
- **Test:** new `MediaSourceScanCoordinator.test.ts`; 6 of its 7 cases fail on the old code.
- **Upstream:** not sent.

### Movie scans pick up subtitle files added later (2026-10-14)

- **What you saw:** a movie got no captions although Bazarr had added an `.srt` the day before (Star Trek II: Plex
  listed the sidecar, Tunarr still knew only the embedded PGS track after the nightly scan).
- **Cause:**
  - **Wrong comparison:** `MediaSourceMovieLibraryScanner.scanSingleInternal` decided "unchanged" by comparing the
    stored canonical id with the **library listing's**. The episode and other-video scanners compare the full
    metadata's.
  - **No streams in the hash:** the Plex movie hash (`canonicalizePlexMovie`) ignored streams, and Plex's listing
    has none anyway (`Part` without `Stream`).
  - **Plex doesn't mark the change:** adding a sidecar doesn't move the movie's `updatedAt` (03:10 before the `.srt`
    at 05:49, checked).
  - **Result:** the movie was skipped every night. Episodes weren't affected: their hash includes stream ids,
    compared on the full metadata.
- **Fix:**
  - **Hash:** `canonicalizePlexMovie` hashes stream ids, like episodes.
  - **Comparison:** the movie scanner compares `fullMovie.canonicalId`, which was already fetched before the check,
    so it costs no extra request.
  - **One-time rescan:** the first scan after this change re-saves every movie once, because their stored ids
    change.
- **Tests:**
  - `PlexMediaCanonicalizers.test.ts`: a stream id change, and a sidecar subtitle stream added.
  - New `MediaSourceMovieLibraryScanner.test.ts`: a rescan when only the full metadata changed, a skip when it's
    unchanged, and a forced rescan. Three of these four fail on the old code.
- **Upstream:** not sent.

### Closed captions are labelled with their language in the stream Plex reads (2026-10-14)

- **What you saw:** Plex Live TV listed the captions as "Unknown (Closed Captioned)".
- **Cause:** the captioned HLS segments name the language in their PMT, but the HDHomeRun `.ts` stream is ffmpeg's
  `-c copy` remux of those segments (`ConcatStream`, `hls_concat`). ffmpeg writes a PMT of its own and keeps none of
  the segments' descriptors, so the stream Plex reads had no language on its video, where the captions live. Checked
  on the live stream: no descriptors on the video entry.
- **Fix:**
  - **Stream:** `CaptionLanguageStream` (`server/src/stream/captions/`) relabels every PMT in ffmpeg's output on its
    way to viewers. `ConcatStream.outputSink()` supplies it when captions are on, `ConcatSession` hands it to the
    transcode session (`DirectStreamSession.outputSink()`), and `StreamModule` passes the first preferred language.
    Every other byte passes through unchanged; if the stream ever lost TS sync, the rest would pass through
    untouched.
  - **Labels:** `withLanguageDescriptors` (`MpegTsCaptionInserter.ts`) adds an ISO 639 language descriptor to the
    video entry, which ffmpeg-based readers such as Plex's take as the video's language, next to the ATSC caption
    service descriptor, which they ignore. The segment inserter uses the same function, so the segments carry both
    too.
- **Checked:** with Plex's own transcoder on a stream sample from the server, the video read as `(eng)` only with
  the ISO 639 descriptor; the caption service descriptor alone changed nothing. A local server's `.ts` stream (HLS
  channel, captions on) read as English video, with both descriptors in all 157 PMTs and caption data intact.
  Tests: `CaptionLanguageStream.test.ts` (chunk sizes from 1 byte, idempotent, lost sync), the PMT test in
  `MpegTsCaptionInserter.test.ts`, and `CaptionInsertion.local.test.ts` (ffmpeg's remux drops the language,
  the stream puts it back).
- **Confirmed in Plex (2026-10-14, `oliviacpu-2026.10.14`):** on the Apple TV, the CC menu lists the captions as
  English, as does the audio menu.
- **Upstream:** not sent.

### Gaps in the guide show the channel's offline picture (2026-10-13)

- **What you saw:** gaps between programmes (flex, such as "<channel> · back soon") were blank tiles in Plex's "Shows
  On Now" and guide, while programmes had posters.
- **Cause:** `XmlTvWriter.makeXmlTvProgram` only wrote an `<icon>` for real programmes.
- **Fix:** a flex programme gets the channel's guide picture for gaps (new optional `offline.guidePicture`,
  **Guide Picture for Gaps** in the channel's Flex settings), else its offline picture when the offline mode is a
  picture (what airs during the gap), else the channel's logo or Tunarr's default logo. Plex keeps one picture per
  guide entry (`thumb`; `art` stays empty for XMLTV) and crops it to both tall and wide tiles. The guide picture is
  there so a square tile can carry a wide card whole. A picture stored as a path
  (`/images/...`) gets the guide address. (`XmlTvWriter.flexIconUrl`; the writer now passes the channel through.)
  Test: `XmlTvWriter.test.ts` (gaps in the guide).
- **Upstream:** not sent.

### Guide pictures can use a public address (2026-10-13)

- **What you saw:** in Plex's apps, programmes in the guide and "Shows On Now" showed plain titles with no posters.
  A channel logo left at Tunarr's default was missing too.
- **Cause:** `/api/xmltv.xml` fills `{{host}}` with the address it was requested on. Plex fetches the guide from
  `http://127.0.0.1:<port>`, so every picture link pointed at 127.0.0.1. Plex's apps load guide pictures themselves,
  so on a phone or TV that address is the device itself.
- **Fix:**
  - **Setting:** an XMLTV setting, **Public Address for Guide Pictures** (`xmlTvSettings.publicUrl`), in Settings →
    XMLTV. When set, `{{host}}` becomes it (`xmlTvLinkHost` in `XmlTvWriter.ts`); empty keeps the old behaviour.
    `/channels.m3u` already had a `hostOverride` for the same reason.
  - **Docs:** `docs/configure/clients/plex.md` notes that the picture paths must be reachable at that address without
    a login.
  - **Safe to expose:** artwork that needs a media-server credential is always proxied, never redirected
    (`ArtworkService.serveArtwork`), so exposing the picture paths doesn't expose the credential.
- **Test:** `XmlTvWriter.test.ts` (`xmlTvLinkHost`).
- **Upstream:** not sent.

### The search server requires a key (2026-10-13)

- **What you saw:** Tunarr's bundled Meilisearch listened on `localhost:<port>` with no key. Anything that could
  reach localhost could read and change the search index. That includes other users of a shared machine, and other
  containers when Tunarr runs on the host network.
- **Cause:** `MeilisearchService.start` launched Meilisearch without a master key, and `client()` connected without
  one.
- **Fix:**
  - **Key file:** on first start the main thread writes a random 32-byte key to `meilisearch-master-key` in the data
    directory, readable only by its owner (mode `0600`).
  - **Meilisearch:** gets the key through `MEILI_MASTER_KEY` in its environment, not its arguments, so the key
    never shows in a process listing. Every request then needs it.
  - **Clients:** the client and worker threads read the same file.
  - **Existing installs:** an existing index keeps working; Meilisearch only enforces the key on requests.
- **Test:** `MeilisearchService.local.test.ts` runs the real binary. A request without the key gets 401, a wrong
  key 403, Tunarr's client works, and a restart reuses the key.
- **Upstream:** not sent.

### Closed captions keep italics, underline and top placement, with a choice of alignment (2026-10-13)

- **What you saw:** captions dropped the subtitle file's italics (off-screen voices, narration, songs) and its
  top-of-screen placement, and every caption was block-centred at the bottom.
- **Cause:** `layoutCaption` in `server/src/stream/captions/Cea608Encoder.ts` stripped every tag, and `loadSequence`
  always used rows 14–15 with one shared indent.
- **Fix:**
  - **Styles:** cues are parsed into styled characters. `<i>`, `<u>`, ASS `{\i1}`, `{\u1}` and `{\r}` become 608
    mid-row codes. A change at a space takes the space's column; one inside a word takes its own. Punctuation right
    after a styled word keeps its style, so `<i>Hello</i>,` opens no gap. Width counts the codes when wrapping.
  - **Placement:** `{\an7}`–`{\an9}` (or SSA `{\a5}`–`{\a7}`) put the whole cue on rows 1–2. Every part of a long top
    cue stays at the top.
  - **Alignment:** a new FFmpeg setting, **Caption Alignment** (`hdhrCaptionAlignment`): centred block (the default,
    unchanged), each line centred (preamble indent plus Tab Offset 1–3 for exact columns), or left.
  - **Plumbing:** `HlsSession.addCaptions` reads the alignment per program, so a change applies from the next
    program.
- **What the player decides:** text size, font and background have no 608 codes Plex honours. For Plex Live TV on
  Apple TV, Plex burns the captions in: it decodes the 608 itself (`inlineass=…:atsc_cc=1`) and draws them in its own
  style, an opaque near-black box with Noto Sans text. The text size follows the Plex app's subtitle size setting
  (`font_size`, `font_scale`).
- **Background codes tried and removed:** an experimental `hdhrCaptionBackground` setting sent 608's optional
  background attributes: semi-transparent black (`0x10 0x2f`) and transparent (`0x17 0x2d`), each after a space at a
  line's start. On 2026-10-13 both were confirmed in the stream Plex read, and the Apple TV's box stayed solid
  black. ffmpeg's 608 decoder, which Plex's burn-in shares a lineage with, maps background attributes only to the
  box colour and ignores transparent. So the setting and the codes were taken out again.
- **Checked:** with ffmpeg's own 608 decoder (jellyfin-ffmpeg 8.1.3), which Plex's burn-in shares a lineage with,
  italics and underline come out as `{\i1}`/`{\u1}`. The top cue comes out at the top (`\pos(…,28)` against 228/243
  at the bottom), and each centred line gets its own leading spaces. Tests:
  `Cea608Encoder.test.ts` (with a small decoder for rows, columns and styles), `CaptionInsertion.local.test.ts`
  (the ffmpeg round trip), `ProgramCaptions.test.ts`.
- **Upstream:** not sent.

### Music rescans only save tracks that changed, and mark removed tracks missing (2026-10-13)

- **What you saw:** every rescan of a music library took as long as the first scan (about 45 minutes for 7,000 Plex
  tracks), and a track removed from an album on the media server stayed listed as available in Tunarr.
- **Cause:** `MediaSourceMusicArtistScanner.scanTracks` looked up the library's existing programs with
  `ProgramType.Episode`. A music library has none, so no track was ever recognised: each one was saved and
  re-indexed in search on every scan, and none were found missing. Using `ProgramType.Track` alone would have been
  worse: the lookup covered the whole library while the missing check runs per album, so every other album's tracks
  would have been marked missing.
- **Fix:** the lookup asks for this album's tracks only (`ProgramType.Track`, scoped to the album, as the TV scanner
  does for seasons). An unchanged track is skipped, and a track the album no longer lists is marked missing. The
  lookup now also returns each program's `state`. A missing track that comes back unchanged is saved again, which
  returns it to `ok`; previously the save on every scan did that. Applies to Plex, Jellyfin and Emby. Tests:
  `MediaSourceMusicArtistScanner.test.ts` (a rescan only saves tracks that changed; a track Plex no longer lists is
  marked missing, and recovers when it returns).
- **Still fetched:** each track's full metadata is still requested (about 50 ms per track from Plex), because the
  stored content hash includes stream IDs that only the full metadata has. Skipping that needs a hash of the listing.
- **Upstream:** not sent.

### Plex music scans import EPs and singles (2026-10-13)

- **What you saw:** after a full Plex music scan, many releases were missing from Tunarr. In one library, 187 of 797
  releases (459 of 7,314 tracks) never arrived. Artists with only EPs and singles were imported with no albums at all.
- **Cause:** `PlexApiClient.getArtistAlbums` listed `/library/metadata/<artist>/children`. Plex returns only full
  albums there and leaves out EPs, singles and other release types. Neither `excludeAllLeaves=0` nor `includeAll=1`
  brings them back.
- **Fix:** `getArtistAlbums` takes the library section key and lists
  `/library/sections/<section>/all?type=9&artist.id=<artist>`, which returns every release by that album artist.
  `PlexMediaSourceMusicScanner.getAlbums` passes `context.library.externalKey`. Without a section key it keeps the
  old listing. Test: `PlexApiClient.test.ts` (`getArtistAlbums` lists EPs and singles through the library section).
- **Checked** against a real Plex server: the section listing returned all 5 of Foodman's releases (the children
  listing returned 0), and 7 for Air (the children listing missed the EP _Casanova 70_). Its `totalSize` matches, so
  paging is unchanged.
- **After upgrading:** run a scan of the music library. Scans walk every artist's releases, so the missing ones are
  added.
- **Media picker:** the web app picks music from Tunarr's own database, so EPs and singles appear there after the
  scan. The live Plex browse routes (`/api/plex/:id/search` with a parent, `/api/plex/:id/items/:id/children`) still
  use the children listing, but the web app no longer calls them.
- **Upstream:** not sent.

### On/off subtitles in Plex Live TV: closed captions in the HDHomeRun stream (2026-10-13)

- **What you saw:**
  - Plex Live TV viewers couldn't turn subtitles on or off. Tunarr burned them into the picture, and Plex's CC button
    had nothing to show.
  - Turning on the WebVTT sidecar feature made it worse: Plex got no subtitles at all.
- **Cause:**
  - Plex reads a channel as an HDHomeRun, through one MPEG-TS stream (the `.ts` URL, a copy of the channel's HLS
    session). MPEG-TS can't carry a text subtitle track. The only switchable subtitles Plex Live TV offers are CEA-608
    closed captions inside the video.
  - ffmpeg can only read 608 captions, not create them. There is no encoder, filter or bitstream filter for it (checked
    in jellyfin-ffmpeg 8.1.3 and ffmpeg 9.0.2).
- **Fix:** a global FFmpeg setting, **Closed captions for HDHomeRun clients (Plex)** (`hdhrClosedCaptions`, off by
  default), under Settings > FFmpeg > Audio & Subtitle Options.

  - **Captions** (`Cea608Encoder.ts`): cues become one 608 byte pair per frame, in pop-on mode. Each caption loads
    ahead of time and appears with End of Caption on its start frame.
    - **Layout:** the bottom rows, block-centred (every line starts at the same column), 32 columns, with special and
      extended characters.
    - **Long cues:** a cue whose lines are wider than 32 columns is rewrapped as a whole. Only a cue that still needs
      more than two lines is shown as several captions, each for a share of its time in proportion to its text.
    - **Speed:** control codes are sent once, not twice as broadcasters do to survive transmission errors. The stream
      is never damaged in transit, and the second copy delayed captions in fast dialogue.
    - **Padding:** every other frame gets null padding, so players always find the track.
  - **Into the stream** (`MpegTsCaptionInserter.ts`): an ATSC A/53 caption SEI goes before the first slice of every
    H.264 frame of a TS segment. The video PES is re-split into packets, keeping PCR, PTS and continuity counters. The
    PMT gets a caption service descriptor naming the language.
  - **Which subtitles** (`FfmpegStreamFactory`, `ProgramCaptions.ts`, HLS channels with subtitles enabled):
    - When the profile picks full text subtitles, they become captions. They're sent as WebVTT (the sidecar path)
      instead of burned in, so Tunarr's own players keep them.
    - Forced and image-based subtitles stay burned in.
    - Otherwise the full text track in the preferred language (regular before SDH) becomes the captions. One example is
      English audio whose forced subtitles are burned in.
    - An embedded track is read from its extracted copy in the subtitle cache, as burn-in does
      (`SubtitleStreamPicker.getSubtitleDetailsWithExtractedPath`). Embedded tracks have no path of their own, and
      the first version only looked at tracks with one, so only sidecar files became captions.
    - Cues come from the SRT, WebVTT or ASS file on disk, moved onto the program's clock (minus the seek).
    - If they can't be read, the subtitles are burned in as before.
  - **Timing** (`HlsSession`): each program's captions are laid out at the session's `ptsOffset` (the video's
    `-output_ts_offset`). This handles the 33-bit timestamp wrap and uses the exact frame rate (`24000/1001`, not
    23.976).
    - A segment whose frames are spaced more than 1% away from the schedule gets padding only, rather than garbled
      text. Deinterlacing that doubles the rate is one cause.
  - **Continuity:** each captioned segment ends on its original continuity counter. The last frame gets up to 15
    extra packets, keeping the video packet count the same modulo 16, so the next segment continues without a jump.
    Without this, Tunarr's `.ts` wrapper (`-fflags +discardcorrupt`) dropped the frame at every segment join, and the
    frames that depend on it decoded with errors. This was found on the deployment's test copy: 8 of 17 two-second
    pieces of a capture had errors with captions on, 0 of 13 with them off.
  - **Serving:** only the `.ts` stream gets captions. Its reader asks for the playlist with `captions=1`, and those
    segment links are served through the inserter. Any failure serves the segment as it is.

  Tests:

  - `Cea608Encoder.test.ts`: timing, parity, layout, repeated characters.
  - `MpegTsCaptionInserter.test.ts`: SEI placement, packets, counters, PCR, PMT CRC, refusals.
  - `ProgramCaptions.test.ts`: parsers, NTSC rates, track choice, playlist marking.
  - `FfmpegStreamFactory.test.ts`: burn vs captions, forced, fallback, setting off, non-HLS.
  - `HlsSession.test.ts`: frame placement, PTS wrap, rate mismatch, unreadable segment.
  - `CaptionInsertion.local.test.ts`: a real libx264 round trip through ffmpeg's 608 decoder.

  Docs: `docs/configure/ffmpeg/index.md` ("Closed Captions for HDHomeRun Clients").

- **Checked** on a throwaway server: a clip with embedded English subtitles, extracted, channel subtitles on.
  - **The `.ts` URL** Plex uses carried caption data on 603 of 603 frames. ffmpeg decoded the subtitles from it, each
    1.5 s long and 2 s apart, as in the source.
  - **Timing:** in a served segment, the frames showing each caption were within 14 ms (half a frame) of the WebVTT cues
    that the same encode wrote.
  - **Decoding:** after the continuity fix, 0 of 14 two-second pieces of a 30 s `.ts` capture had decode errors.
  - **Not yet checked on the Apple TV:** CC toggling, the label from the caption service descriptor, and whether Plex
    turns captions on by itself for foreign-audio programs.
- **Known limits:**
  - The `mpegts` stream mode and hls_direct modes get no captions; hls_direct copies the source's video, often HEVC.
  - Captions use the player's own style. Non-Latin text is dropped.
  - Two cues closer together than a caption's load time show late: two full lines are 64 characters at 2 per frame,
    plus 4 commands, so 36 frames (1.5 s at 23.976 fps).
  - Captions keep the subtitle file's timing. A sidecar timed for another release of the episode is just as far off
    as in any other player. Tools like Bazarr's subtitle sync fix the file.
- **Upstream:** not sent.

### Changing the FFmpeg path applies without a restart (2026-10-13)

- **What you saw:** after changing the FFmpeg executable path, Tunarr kept probing the old path until it restarted. A
  symlink had to stay at the old path so that nothing broke in the meantime.
- **Cause:** `FfmpegInfo` received both paths once, in its constructor (`KEYS.FFmpegPath`, `KEYS.FFprobePath`).
  Long-lived holders keep one instance:

  - the pipeline builder factory, an Inversify factory binding created once, whose `FfmpegInfo` supplies the encoders,
    filters and options every stream's command is built from;
  - `TroubleshootService`, a singleton;
  - ffprobe for stream details, and the health checks.

  The ffmpeg processes themselves run the current path (`FfmpegProcess`), so commands were built from the old binary's
  capabilities and then run on the new binary.

- **Fix:** `FfmpegInfo` takes the settings DB and reads both paths on every call. Its probe caches are already keyed
  by path, so a new path is probed fresh. The two path bindings and keys are gone.
- **Why it matters now:** the image has two ffmpegs (jellyfin-ffmpeg at `/usr/bin`, ErsatzTV 7.1.1 at
  `/usr/local/bin`). Before this fix, switching to 7.1.1 without a restart kept the stale "has `tonemapx`" capability,
  so HDR programs would have been sent a filter 7.1.1 doesn't have.
- **Checked:**
  - Test: `ffmpegInfo.test.ts` switches one `FfmpegInfo` between two stand-in ffmpeg scripts; version and filters follow.
  - On a throwaway server, with one HDR10 program, no restart: jellyfin-ffmpeg → `tonemapx`; Homebrew ffmpeg (no
    `tonemapx`) → the zscale chain; back to jellyfin → `tonemapx` again.
- **Known limit:** probe results are cached per path for an hour. Replacing the binary behind the same path, for
  example by editing a wrapper script to call another ffmpeg, still shows the old capabilities for up to an hour.
- **Upstream:** not sent.

### Faster tune-in: HLS segment length, segments before playback, and a start-up burst (2026-10-13)

- **What you saw:** a cold channel took 5–10 s to send its first byte to Plex's tuner. It was sped up outside Tunarr by
  rewriting ffmpeg's arguments to 2 s segments and a read-ahead burst.
- **Cause:** Tunarr hard-codes 4 s HLS segments (`HlsOutputFormat.SegmentSeconds`, `hlsTime: 4`). It serves a channel's
  playlist only once 2 segments exist (`initialSegmentCount: 2` in `SessionManager`), so 8 s of video must be encoded
  first. The `.ts` stream HDHomeRun clients read (`hlsWrap`, a copy of the HLS playlist) then reads at `-readrate 1` from
  the first byte.
- **Fix:** three global FFmpeg settings, under Settings > FFmpeg > Global Options. Each is read when a channel's session
  starts.

  - `hlsSegmentSeconds` (default 4, 1–10) reaches `HlsSession` (hls mode only) as `segmentSeconds`. `HlsOutputFormat`
    then writes it as `-hls_time`, with `-g`, `-keyint_min` and `-force_key_frames` scaled to match. The playlist's
    target duration follows. hls_direct_v2 keeps 4 s, because its copied video can only be cut at the source's keyframes.
  - `hlsInitialSegmentCount` (default 2, 1–10) replaces the hard-coded 2 for hls and hls_slower sessions.
  - `hlsTsInitialBurstSeconds` (default 0, 0–60) becomes `-readrate_initial_burst N` on the `hlsWrap` reader, through
    `FfmpegState.readrateInitialBurstSeconds`.

  The defaults keep the old behavior. `defaultHlsOptions.hlsTime` changed from an unused 2 to 4 so it matches the
  sessions. Files: `HlsOutputFormat.ts`, `BasePipelineBuilder.ts`, `HlsSession.ts`, `SessionManager.ts`,
  `FfmpegStreamFactory.ts`, `FfmpegState.ts`, the FFmpeg settings schema and page. Tests: `HlsOutputFormat.test.ts`,
  `BasePipelineBuilder.test.ts`, `HlsSession.test.ts`. Docs: `docs/configure/ffmpeg/index.md` ("HLS Start-up").

- **Checked** on a throwaway server (stream-repro, jellyfin-ffmpeg 8.1.3). The encoder was slowed to about real time
  (1 thread, `medium`) to resemble the deployment. Over 3 cold starts each, the HDHomeRun `.ts` URL's first byte went
  from 7.1–8.1 s (defaults) to 4.1 s (2 s segments, 10 s burst), and the 3 s after it carried 1.87 MB instead of
  1.19 MB. The playlist read `#EXT-X-TARGETDURATION:2` with 2.000 s segments. To match the old wrapper, set segment length
  2 and burst 10.
- **Upstream:** not sent.

### The image ships jellyfin-ffmpeg 8.1.3-1 as its ffmpeg (2026-10-13)

- **What you saw:** the image's only ffmpeg was ErsatzTV's 7.1.1, which has no `tonemapx`. The faster tone mapping ran
  only through a hand-installed jellyfin-ffmpeg and a wrapper script that rewrote Tunarr's command.
- **Cause:** upstream's image builds on `ghcr.io/ersatztv/ersatztv-ffmpeg` and links its ffmpeg into `/usr/bin`.
- **Fix:** a `jellyfin-ffmpeg` build stage downloads the static `portable_linux64-gpl` release, checks its sha256, and
  `ffmpeg-base` copies its `ffmpeg` and `ffprobe` to `/usr/bin` in place of the symlinks. The build fails unless that
  ffmpeg runs and lists `tonemapx`. Tunarr's default paths already point at `/usr/bin`, so it then picks `tonemapx` by
  itself (previous entry).
  - **Checked:** in a local linux/amd64 build of `ffmpeg-base`, `/usr/bin/ffmpeg` reports `8.1.3-Jellyfin` (binary
    sha256 `79a8d05b…`) and has libx264, libx265, ac3, aac, `tonemapx`, `zscale`, `sidedata`, `loudnorm` and `afade`.
  - **Not checked:** hardware acceleration (VAAPI, QSV, NVENC) through the static build. The fork's deployment is
    software-only.
- **Upstream:** fork-only; upstream chose the ErsatzTV build.

### Software tone mapping uses `tonemapx`, with a choice of curve (2026-10-13)

- **What you saw:** HDR tone mapping on the software pipeline was slow, and its look was fixed to Hable. Using
  jellyfin-ffmpeg's much faster `tonemapx`, or trying the BT.2390 curve, meant rewriting ffmpeg's command line outside
  Tunarr.
- **Cause:** `SoftwarePipelineBuilder.setTonemap` always used `TonemapFilter` (`zscale` to linear float RGB, then
  ffmpeg's plain-C `tonemap=tonemap=hable`), and nothing chose the curve.
- **Fix:**

  - A global FFmpeg setting, `tonemapAlgorithm` (`hable` default, `bt2390`, `mobius`, `reinhard`), shown as **HDR
    Tone-map Curve** under Settings > FFmpeg > Global Options. It reaches the builder through `FfmpegState`, like the
    scaling algorithm, and takes effect from the next program.
  - When ffmpeg has the `tonemapx` filter (`KnownFfmpegFilters.Tonemapx`, found by the usual filter probe), `setTonemap`
    uses the new `TonemapxFilter`: `tonemapx=tonemap=<curve>:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=yuv420p`,
    with `hwdownload` first for hardware frames. It reads the peak from the frame's HDR10 metadata, applies Dolby
    Vision RPUs, and drops the HDR10 side data itself. Dolby Vision with no transfer is tagged PQ with `setparams`
    first, as the zscale chain does with `tin=`.
  - Without `tonemapx`, the zscale chain stays, with the chosen curve; `bt2390`, which ffmpeg's `tonemap` lacks,
    becomes `hable`.
  - The VAAPI builder's software fallback goes through the same method.
  - Settings files without the field load as `hable`, so nothing changes until it's set.

  Checked with jellyfin-ffmpeg 8.1.3 on an HDR10 test clip: `tonemapx` output is 8-bit High-profile H.264, bt709,
  without mastering display or light level side data. jellyfin-ffmpeg's version string (`8.1.3-Jellyfin`) parses as
  8.1.3. Tests: `TonemapxFilter.test.ts`, `TonemapFilter.test.ts`, `SoftwarePipelineBuilder.test.ts`,
  `ffmpegInfo.test.ts`. Docs: `docs/configure/ffmpeg/index.md`, `docs/configure/ffmpeg/transcode_config.md`.

- **Upstream:** not sent.

### Tone-mapped HDR10 no longer keeps its HDR metadata (2026-10-13)

- **What you saw:** with HDR tone mapping on, some HDR10 programs never started. ffmpeg exited with code 187 and
  libx264 logged "content light levels out of range". The ones that did play sent an SDR (bt709) picture labeled with
  the source's HDR10 mastering display and light level metadata. This was worked around outside Tunarr by appending
  `sidedata=mode=delete` filters to ffmpeg's command.
- **Cause:** the software tone map (`zscale` + `tonemap`) converts the pixels but leaves the frames' HDR10 side data
  attached. Since ffmpeg 7, libx264 writes that side data into the H.264 stream as SEI, and refuses to open when its
  light levels fall outside 0–65535.
- **Fix:** `TonemapFilter` ends its chain with
  `sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL,sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA`
  (`StripHdr10SideData`). Checked with ffmpeg 8.1: without it the tone-mapped H.264 still carries mastering display and
  content light level side data; with it, neither. Test: `TonemapFilter.test.ts`.
- **Upstream:** not sent.

### Gap music: a channel's music list plays under its offline picture (2026-10-13)

- **What you saw:** during flex gaps a channel showed its offline picture over silence. The channel's
  `offline.soundtrack` setting was stored but never used, and there was no way to use your music library there.
- **Cause:** `FfmpegStreamFactory.createOfflineSession` always used the placeholder audio (anullsrc, sine or noise).
- **Fix:** a channel's offline settings take an optional `musicListId`, a filler list of tracks. It isn't attached to
  the channel as ordinary filler, so its tracks never play as normal programs with album art. When a gap reaches the
  offline picture:

  - `GapMusicPicker` picks a track from the list: never played on this channel first (at random), otherwise the one
    played longest ago (30-day history window).
  - The gap item lasts `min(rest of gap, track length)`, so long gaps play track after track.
  - The play is recorded in program play history with the list's id.
  - The offline session uses the track as its audio, normalized to a TV-like `I=-24 LUFS, LRA=11, TP=-2`
    (`GapMusicLoudnorm`; programs are not normalized). It fades in over 1 s, and out over the last 3 s when the gap cuts
    the track short. The fades go after loudnorm (`AudioState.fades`, `AudioFadeFilter`) so its gain control can't
    undo them.
  - Anything that fails (empty list, unresolvable source, no audio stream) leaves the gap with the old placeholder
    audio, and is logged.

  Files: `StreamProgramCalculator.ts`, `ProgramStream.ts`, `FfmpegStreamFactory.ts`,
  `services/scheduling/GapMusicPicker.ts`, `builder/filter/AudioFadeFilter.ts`, `builder/state/AudioState.ts`, the
  channel offline schemas. Tests: `GapMusicPicker.test.ts`, `StreamProgramCalculator.test.ts`,
  `FfmpegStreamFactory.test.ts`, `BasePipelineBuilder.test.ts`. The channel's list isn't validated on save; a deleted or
  wrong list just gives the silent picture.

- **Where to set it:** the channel's Flex settings, **Gap music**, next to the fallback image (any filler list).
  Documented in `docs/configure/channels/flex.md`.
- **Checked end to end** on a throwaway server (stream-repro, local music library, ffmpeg 9.0.2;
  the deployed image ships 7.1.1, which has the same `loudnorm` and `afade`): three tracks measuring
  -6.2, -22.6 and -47.6 LUFS all came out at -24.0 LUFS. Gap items rotated tracks (never-played first, then the
  oldest), the track cut by the gap's end faded out over its last 3 s, each item faded in over 1 s, and a channel
  without a list still played digital silence.
- **Upstream:** not sent.

### Plex music tracks keep their audio stream (2026-10-13)

- **What you saw:** music tracks imported from a Plex music library couldn't be played; streams failed with "Streams
  with no video" or played nothing.
- **Cause:** `PlexApiClient.plexTrackInjection` called `plexMediaStreamsInject` with its default
  `requireVideoStream = true`. Tracks have no video stream, so the import failed and fell back to an item with no
  streams at all.
- **Fix:** tracks pass `requireVideoStream: false`, so their audio streams are stored. Test: `PlexApiClient.test.ts`
  (`getMusicTrack` keeps an audio-only track's stream).
- **Fixed later:** rescans used to save every track again and never marked removed ones missing. See "Music rescans
  only save tracks that changed" above.
- **Upstream:** not sent.

### "Normalize Frame Rate" works again (2026-10-13)

- **What you saw:** the transcode config's **Normalize Frame Rate** checkbox ("Output video at a constant frame rate")
  did nothing; output kept whatever timing the source had, including variable frame rates.
- **Cause:** when the old ffmpeg pipeline was replaced (#1349), its `fps=<source rate>` filter for this setting wasn't
  carried over. The new calculator only had a commented-out `maxFPS` stub. The builder could already write
  `-r <rate> -fps_mode cfr` when the desired state has a frame rate, but nothing set one.
- **Fix:** with the setting on, `FfmpegPlaybackParamsCalculator` sets the output frame rate to the source's own rate
  (from `24`, `23.976`, `"24000/1001"` or `"25"`, rounded to 3 decimals; nothing for missing or implausible values).
  `HlsOutputFormat` now rounds its keyframe interval to whole frames, since 23.976 x 4 s would otherwise be written as
  `-g 95.904`. Checked with real ffmpeg: a variable-rate input comes out at exactly 24000/1001 with 96-frame segments.
  Off by default, as before. Tests: `FfmpegPlaybackParamsCalculator.test.ts` (its `makeStreamDetails` helper now
  applies its overrides, which it silently ignored), `HlsOutputFormat.test.ts`.
- **Upstream:** not sent.

### Tag the output audio's language (2026-10-13)

- **What you saw:** Tunarr's streams carried no audio language, so Plex logged every program as foreign-language audio
  ("foreign film") and couldn't match audio or subtitle language preferences.
- **Cause:** the stream selector picks the audio track knowing its ISO 639-2 language, but `AudioStream` had no field
  for it and the audio pipeline wrote no stream metadata.
- **Fix:** `AudioStream` carries `language`, `FfmpegStreamFactory` sets it from the selected track's
  `languageCodeISO6392`, and `BasePipelineBuilder.buildAudioPipeline` writes `-metadata:s:a:0 language=<code>`
  (`AudioLanguageOutputOption`) when it's a valid 3-letter code. MPEG-TS turns this into the stream's ISO 639 language
  descriptor, and it survives the `.ts` remux (checked with ffmpeg 7). Test: `BasePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### Pick the software encoder's preset in the transcode config (2026-10-13)

- **What you saw:** software H.264/HEVC always encoded with `-preset veryfast`. Transcode configs have a `videoPreset`
  field, but the settings page didn't show it and the stream code ignored it. Trying a faster preset meant rewriting
  ffmpeg's command line outside Tunarr.
- **Cause:** `FfmpegPlaybackParamsCalculator` hard-coded `VideoPresets.VeryFast` for hardware acceleration "none".
- **Fix:** the calculator uses the transcode config's preset when it's a known libx264/libx265 preset, and keeps
  `veryfast` when it's empty or unknown, so existing configs behave as before. The transcode config page shows a **Video
  Preset** dropdown (ultrafast to medium) under Video Options when Hardware Acceleration is Software and the format is
  H.264 or HEVC. A change takes effect when the next ffmpeg process starts; no restart. Hardware encoders are unchanged.
  Files: `server/src/ffmpeg/FfmpegPlaybackParamsCalculator.ts`, `server/src/ffmpeg/builder/constants.ts`,
  `web/src/components/settings/ffmpeg/TranscodeConfigVideoSettingsForm.tsx`. Tests:
  `FfmpegPlaybackParamsCalculator.test.ts`.
- **Upstream:** not sent.

### The transcode config's thread count now limits the encoder (2026-10-13)

- **What you saw:** setting **Thread count** in a transcode config didn't limit how many threads libx264 used. On a box
  with many cores, or a tight per-user thread limit, each watched channel still started about 1.5x the visible cores
  in encoder threads.
- **Cause:** the value was written only as a global `-threads N` before the inputs, which ffmpeg applies to the first
  input's decoder. `PipelineOptions.encoderThreadCount` was filled in for the main transcode path but never read, and
  the offline, error and `hls_slower` concat sessions didn't pass it at all.
- **Fix:** `Libx264Encoder` takes an optional thread count and writes it as the output option `-threads:v N`;
  `BasePipelineBuilder.setupEncoder` passes `pipelineOptions.encoderThreadCount`, and `FfmpegStreamFactory` now sets it
  for the offline, error and `hls_slower` concat sessions too. The decoder's `-threads` is unchanged. 0 still means
  "let ffmpeg decide". Tests: `Libx264Encoder.test.ts`, `SoftwarePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### 10-bit sources no longer come out as H.264 High 10 (2026-10-13)

- **What you saw:** 10-bit sources (most x265/HEVC files, HDR or not) were transcoded to H.264 **High 10** on the
  software (no GPU) pipeline. Almost no player decodes High 10, so those programs failed or fell back to another
  transcode. It had to be worked around outside Tunarr by adding `-pix_fmt yuv420p` to the ffmpeg command.
- **Cause:** `SoftwarePipelineBuilder.setupVideoFilters` started its frame state from the desired output state without
  the source's pixel format, so it believed frames were already `yuv420p`. `setPixelFormat` then saw no difference and
  never added `-pix_fmt yuv420p`, and libx264 encoded the decoder's `yuv420p10le` frames as High 10. The Nvidia, QSV and
  VAAPI builders already seed the state with `videoStream.pixelFormat`. Tone mapping hid the bug for HDR sources,
  because its filter chain ends in `format=yuv420p`.
- **Fix:** seed the software pipeline's starting state with `videoStream.pixelFormat`, as the hardware builders do
  (`server/src/ffmpeg/builder/pipeline/software/SoftwarePipelineBuilder.ts`). Test:
  `SoftwarePipelineBuilder.test.ts` (a 10-bit source gets `-pix_fmt yuv420p`; an 8-bit source gets no conversion).
- **Upstream:** not sent. Related: upstream PR #1559 (an unconditional `-pix_fmt yuv420p`) was closed on the grounds
  that the pipeline builder already forces 8-bit output; on the software path it didn't.
