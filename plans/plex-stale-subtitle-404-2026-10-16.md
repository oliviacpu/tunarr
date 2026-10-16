# Plex sidecar subtitles: stale copies, and the 404s (2026-10-16)

The parked item was "Plex 404 for stale subtitle streams". The user asked: "Fix 404s or improve correctly."

## What's real (production, read-only checks, 2026-10-16 ~13:30 UTC)

All 3,805 sidecar subtitle rows in production's `program_subtitles` come from Plex.

**404s: none pending.**
- Every row's `source_key` (`/library/streams/<id>`) was compared with the streams Plex lists for its item now:
  - 3,781 still match;
  - 24 belong to items Plex no longer has, and all 24 programs are already in state `missing`;
  - no row has a stale key on a live item.
- No 404 lines are in the current logs (four rotated files, a few hours).
- So the stale-key 404 heals on its own: Plex rescans the item, then Tunarr's next scan picks up the new key. Until then
  it's one info line (`missingSubtitleMessage`, `stream/ExternalSubtitleDownloader.ts:51`).

**Stale subtitles: 132 programs.** Each row's cached copy was compared with the file Plex now reads:

| Result | Rows |
| --- | --- |
| Identical bytes | 3,524 |
| **The file on disk is newer and its text differs: Tunarr serves an old subtitle** | **132** |
| Same text; Plex re-encoded it or changed line endings when serving it (harmless) | 120 |
| Program already `missing` | 24 |
| Couldn't compare | 5 |

The 132 are most likely Bazarr's later replacements and re-syncs, such as the 17 replacements of 2026-10-14. The cache
copy never refreshes, so Tunarr's captions and burned-in subtitles keep the old timing or text indefinitely.

**Shared storage is never used.**
- Every row has `source_path` NULL and `path` in the subtitle cache (`/config/tunarr/cache/subtitles/…`).
- That's so although Tunarr mounts `/home/nebulaaa/media` read-only at the same path Plex uses.
- It includes rows written by today's 11:30 UTC scan on `.16`, e.g. "Happy Trails", stream 244194.

## Root cause

**Plex leaves out a sidecar subtitle's `file` when the request comes in over its remote address.**
- Tunarr's Plex media source URI is the `plex.direct` public address (`https://185-203-56-41.<hash>.plex.direct:10099`).
- Same item, same token (Tunarr's), same parameters as `getItemMetadataInternal` (`external/plex/PlexApiClient.ts:693`):

  | Request via | Part `file` | Sidecar stream `file` |
  | --- | --- | --- |
  | `http://127.0.0.1:10099` | present | present |
  | the `plex.direct` URI | present | **absent** |

The code is right as long as `file` arrives. Checked by running the real Plex JSON through it:
- the schema keeps it (`types/src/plex/index.ts:318`);
- `plexMediaStreamsInject` maps it to `fileName` (`PlexApiClient.ts:2229`);
- `mintSubtitles` maps it to `sourcePath` (`db/converters/ProgramMinter.ts:327`).

Over the remote URI, what follows is:
1. `downloadExternalSubtitleStreams` (`services/scanner/MediaSourceScanner.ts:172`) has no `sourcePath`, so
   `PathCalculator.findLocalPath` (:189) finds nothing and the subtitle is downloaded over HTTP.
2. The copy is named after the stream key (`util/subtitles.ts:77`, `getSubtitleCacheFilePath`).
   `downloadSubtitlesIfNecessary` downloads only when that file doesn't exist (`stream/ExternalSubtitleDownloader.ts:115`).
   When Bazarr rewrites the `.srt` and Plex keeps the stream id, the copy is never refreshed.
3. **Skipped on rescan:** a rescan re-mints the rows only when the item's canonical id changes. Plex's episode hash
   includes stream ids (`PlexMediaCanonicalizers.ts:165`) but not the subtitle's contents, so a rewrite in place
   changes nothing.
4. **The hourly top-up doesn't refresh either** (`tasks/SubtitleExtractorTask.ts:194`). It skips any row whose `path`
   exists (:204), which a stale copy does.
5. **Playback also prefers the copy** (`stream/ProgramStreamDetailsFetcher.ts:144-179`). It uses `subtitle.path` when
   it exists and only then tries `sourcePath` (:164).

## Proposed change

### 1. Deployment: point Tunarr's Plex source at `http://127.0.0.1:10099` (no code)

- Tunarr runs on the host network, and Plex listens on 127.0.0.1:10099.
- **Effect:** Plex then reports each sidecar's `file`, the scanner finds it on the shared mount, and `path` becomes the
  live file. No copies, nothing to go stale, no HTTP at stream start, so no 404.
- **What else reads the URI:**
  - server-side: API calls, artwork caching, and the stream fallback for files Tunarr can't see;
  - client-facing, only the web UI's "open in Plex" links (`api/programmingApi.ts:666-709`). Those already fail from
    outside, since the direct port was unpublished on 2026-10-15.
- **Then one forced scan** of TV Shows and Movies. Unchanged items are otherwise skipped, so the rows keep their stale
  copies until something changes. Re-minting replaces the rows (`ProgramMetadataRepository.ts:395-407`), and
  `removeSubtitleCacheFiles` (:422) deletes the replaced cache copies, since they sit inside the cache folder.
- **Do it when nobody watches.** The forced scan runs in the scan worker. A URI change via the API re-checks the source.
- Check afterwards:
  - `source_path` set on new rows, and `path` under `/home/nebulaaa/media`;
  - the stale count above drops to 0.

### 2. Code (fork PR), for any setup where the media server's files aren't visible or `file` isn't reported

**a. Playback prefers the live file.** In `ProgramStreamDetailsFetcher` (:146-179), when a sidecar's `sourcePath`
resolves locally, use it ahead of a cache copy. A few lines.

**b. The hourly top-up refreshes cache copies of programs airing in the next hour.** In `topUpExternalSubtitles`:
- **Which rows:** sidecars whose `path` is inside the subtitle cache, whose `sourcePath` doesn't resolve, and whose copy
  is older than a threshold (6 h).
- **How:**
  - fetch again, to a temporary file;
  - replace the copy with a rename only if the content changed, so a running ffmpeg never reads half a file;
  - keep the cache name, since it's derived from the key.
- **Cost:** a few dozen small requests an hour at most, only for channels with subtitles on.
- **Code:** `ExternalSubtitleDownloader` gets a `refresh` option that bypasses the exists check at :115 and writes
  atomically.

**c. A 404 heals at once instead of waiting for two rescans.** When the top-up's fetch answers `not_found`:
- re-fetch the item (`getEpisode` / `getMovie` by `program.externalKey`);
- re-mint its subtitles with `ProgramDaoMinter.mintSubtitles` (:295);
- save them with `ProgramMetadataRepository.upsertSubtitles`. That replaces the sidecar rows and cleans up the replaced
  cache copies.
- download the sidecar that now matches the old row's language, forced and SDH flags. Retry once, no loop.
- if the item itself is gone (404), leave it to the scan, which marks the program missing.

**d. Tell the user when Plex hides file paths.** In the Plex scanner: when an item's Part has a `file` but its sidecar
streams don't, log once per scan, at info level:

> Plex didn't report subtitle file paths (Tunarr connects through a remote address), so subtitles are downloaded
> instead of read from shared storage. Use a local address for the Plex server to read them directly.

Optional, not proposed now: match sidecars next to the video's local file with `LocalSubtitlesService` (correct since
PR #21) to recover `sourcePath` without Plex's help. It's a heuristic and not needed once item 1 is done.

## Tests (each fails without its change)

- **`ProgramStreamDetailsFetcher.test.ts`:** a sidecar with both an existing cache `path` and a resolvable `sourcePath`
  uses the `sourcePath`.
- **`ExternalSubtitleDownloader.test.ts`:**
  - `refresh` re-fetches an existing copy and replaces it when the content differs;
  - it leaves the file untouched when the content is the same;
  - a failed fetch keeps the old copy.
- **`SubtitleExtractorTask.test.ts`:**
  - a stale cache copy (old mtime) of a program airing soon is refreshed; a fresh one isn't;
  - on `not_found` the item is re-fetched, its rows re-minted, and the new key downloaded, all once;
  - an item that 404s itself is left alone.
- **Plex scanner test:** the "no file paths" info line is logged once per scan when sidecar streams lack `file` but the
  Part has one.

## Size

- **Item 1:** a settings change plus one forced scan of TV Shows and Movies, when nobody watches.
- **Item 2:** about 150-250 lines plus tests, one PR. a and d are small; b and c are most of it.

Item 1 alone fixes production. Item 2 makes the 404 self-healing and keeps copies fresh where shared storage isn't
available.
