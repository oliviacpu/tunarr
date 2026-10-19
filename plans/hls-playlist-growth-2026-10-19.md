# `stream.m3u8` growth over long HLS sessions (2026-10-19)

**Status: report only** (task T34 in `plans/fork-review-2026-10-19.md`). No code was changed. The recommendation in
section 3 needs its own PRs.

## Summary

An HLS session's `stream.m3u8` lists every segment since the session started, and nothing trims it. Tunarr's own cost
of reading it has been bounded since PR #14. ffmpeg's cost has not, and it is larger than the review assumed:

- **Rewrites.** Every segment, ffmpeg rewrites the whole playlist: about 145 bytes per segment so far. With 2 s
  segments that is 6.3 MB every 2 s after 24 hours, and about 136 GB written in the session's first 24 hours. The
  total grows with the square of the session's age.
- **Memory.** Each program's ffmpeg reads the whole playlist back in when it starts (`append_list`) and keeps every
  entry in memory (`hls_list_size 0`). FFmpeg 8.x, which the fork's Docker image ships, spends about 12.4 KB per entry.
  That is 585 MB per ffmpeg after 24 hours of 2 s segments, against 48 MB for the same ffmpeg with an empty
  playlist. FFmpeg 9.0 shrank the entry to about 170 bytes.
- **Program starts.** The read-back is quadratic in FFmpeg 7.1.x, which upstream Tunarr's image and docs use: 2 s at 6
  hours, 8–11 s at 12 hours, and 54–76 s at 24 hours (2 s segments). That passes the 30–60 s that Tunarr transcodes
  ahead, so a long session would stall at program changes. FFmpeg 8.x adds about 0.5 s at 24 hours.
- **CPU.** About 35 ms of CPU per segment at 24 hours on every version, to format 43,200 entries.
- **Tune-in is not affected.** A new session starts with an empty directory.

These ffmpeg figures come from synthetic playlists of the size a 12-hour and a 24-hour session reaches. The live run
lasted 60 minutes (section 2.1). Byte totals past 60 minutes are linear extrapolation (section 2.3).

**Recommendation:** option (a), a bounded `-hls_list_size`, sized **M** and split into two PRs. Tunarr's playlist
index becomes the only record of the session's history, keyed by segment number. Today's reader cannot read a sliding
window: a probe shows it serves program date-times that are wrong and keep moving, and a discontinuity sequence that
stops advancing. So the reader changes first, then the flag.

## 1. Mechanism

### 1.1 What Tunarr asks ffmpeg for

- `server/src/ffmpeg/builder/options/HlsOutputFormat.ts:39-40` passes `-hls_list_size 0`. `:53` sets
  `program_date_time+append_list+independent_segments`, `:54` adds `omit_endlist`, `:55` adds `discont_start` for
  every program after the first, and `:64-66` adds `mpegts_flags=+initial_discontinuity`. `HlsDirectOutputFormat.ts:29-30, :43`
  does the same for `hls_direct_v2`.
- `HlsSession.getHlsOptions` (`server/src/stream/hls/HlsSession.ts:830-846`) declares `hlsListSize: 0` and
  `appendSegments: true`, but `HlsOutputFormat` hard-codes the `0` and never reads `hlsListSize`.
- Every program is its own ffmpeg process (`HlsSession.transcode`, `:388`; the loop at `:333-353` waits for each
  process at `:526`). All of them write the same file, `<session dir>/stream.m3u8` (`BaseHlsSession.ts:88-92`). The
  directory is per session instance, so a new session starts empty.
- The next program starts once Tunarr is 60 s or less ahead of real time (`HlsSession.ts:339`). It reads ahead (a 60 s
  `-readrate_initial_burst`, `BasePipelineBuilder.ts:960-966`) when Tunarr is less than 30 s ahead (`:340`). So
  Tunarr normally runs 30–60 s ahead of what viewers watch, and a program change is invisible as long as the next
  ffmpeg produces its first segment within that lead.

### 1.2 What ffmpeg does with it (`libavformat/hlsenc.c`)

Line numbers are from FFmpeg `n8.1`, the base of the jellyfin-ffmpeg 8.1.3 build in the fork's image. The same code is
in 7.1.1 and 9.0 except where noted.

- **The old playlist is read back at every start.** The option docs say only that `append_list` will "Append new
  segments into the end of old segment list" and that `hls_list_size 0` makes "the list file … contain all the
  segments" (ffmpeg-formats, `hls` muxer). The source shows what that costs. When `HLS_APPEND_LIST` is set, `hls_init`
  calls `parse_playlist(s, vs->m3u8_name, vs)` (`:3086`). That reads the file line by line and calls
  `hls_append_segment` for every entry (`:1149` onward). It also sets `vs->sequence` from `#EXT-X-MEDIA-SEQUENCE`
  (`:1183`) and counts each entry on top, which is how a new process continues the segment numbering. This happens
  in muxer init, before the first segment file is opened, so it adds directly to the program's start.
- **`hls_list_size 0` keeps every entry.** `hls_append_segment` frees the oldest entry only
  `if (hls->max_nb_segments && vs->nb_entries >= hls->max_nb_segments)` (`:1109`). With 0 it never does, so the
  linked list holds every segment of the session, parsed and new.
- **Each entry is large before FFmpeg 9.0.** `HLSSegment` (`:76`) holds `char filename[MAX_URL_SIZE]` and
  `char sub_filename[MAX_URL_SIZE]` (4096 bytes each) and `char key_uri[LINE_BUFFER_SIZE + 1]` (4097), about 12.4 KB
  per entry. Most of that memory is written, so it all becomes resident. FFmpeg 9.0 stores the strings in a flexible
  array member (`char buf[]`, `n9.0:93`).
- **A duplicate-name check walks the whole list.** `hls_append_segment` calls `find_segment_by_filename` on every
  append in 7.1.x (`n7.1.1:1142`), which makes the read-back quadratic. Since 8.0 it only does so while
  `vs->nb_entries <= 5000` (`n8.1:1068`). That is why 8.x jumps by about 0.3 s between 1,800 and 5,400 entries and then
  grows linearly.
- **Every segment rewrites the whole file.** After each segment, `hls_window` (`:1518`) walks the list twice, once for
  the target duration and once to write. Each entry goes through `ff_hls_write_file_entry` (`hlsplaylist.c:144`),
  which runs `localtime_r` and two `strftime` calls for its program date-time (`:174-179`). The output goes to
  `stream.m3u8.tmp` and is renamed over `stream.m3u8` (`use_temp_file` for a live playlist, `:1529`, `:1651`).
- **No discontinuity sequence is written.** hlsenc never writes `#EXT-X-DISCONTINUITY-SEQUENCE`. The `discont_start`
  tag goes after the header only while the written `#EXT-X-MEDIA-SEQUENCE` equals the start number
  (`hls_window`, `sequence = FFMAX(start_sequence, vs->sequence - vs->nb_entries)`, `:1526`). With `hls_list_size 0`
  that is always true.

### 1.3 What Tunarr does with the file (bounded)

- `MediaPlaylistReader` (`server/src/stream/hls/MediaPlaylistReader.ts:155-202`) reads only the bytes appended since
  the last request. It checks 256-byte anchors at the start (`:218-228`) and end (`:178-184`) of what it has already
  parsed.
- `MediaPlaylistIndex` computes each segment's start as the session start plus every earlier `EXTINF`
  (`MediaPlaylistIndex.ts:221-223`), not from ffmpeg's program date-times. It counts discontinuities from the body
  only. Tags before the first `#EXTINF` count as header (`:101-115`).
- `discardSegmentsBelow` (`:253-279`) drops old entries from memory. `HlsSession.trimPlaylist` calls it every 30 s with
  the deletion floor (`HlsSession.ts:255-264`), and `deleteOldSegmentFiles` (`:991-1035`) unlinks old `.ts` files.
- `TranscodeSpeedWatcher` reads only the last 64 KiB (`TranscodeSpeedWatcher.ts:8-11, 57-70`).
- FORK.md ("Live TV playlist requests no longer slow down…") measured 0.13–0.16 ms per request from 5,265 to 43,200
  segments. The poller in section 2.1 saw the same flat cost live.

Segment files on disk and Tunarr's memory are bounded. `stream.m3u8` and ffmpeg's list are not.

### 1.4 Who pays, and when

| What grows | Who pays | When | Bounded today? |
|---|---|---|---|
| `stream.m3u8` size (≈145 B per segment) | the disk or page cache under the transcode directory | rewritten once per segment | no |
| ffmpeg's entry list (12.4 KB per entry on ≤ 8.x, ≈170 B on 9.0) | each program's ffmpeg process | from its start to its exit | no |
| Read-back at program start (O(n) on ≥ 8.0, O(n²) on 7.1.x) | the next program's first segment | every program change | no |
| Formatting every entry (≈0.8 µs per entry) | ffmpeg CPU | once per segment | no |
| Tunarr's reads | Tunarr's main thread | each playlist request | yes (PR #14) |

On ext4 with default options (`auto_da_alloc`), replacing a file by renaming over it makes the kernel write the new
file's data before the rename commits. That is documented ext4 behaviour and was not measured here. Each rewrite then
reaches the disk, rather than dying in the page cache when the next version replaces it two seconds later. A transcode
directory on tmpfs costs memory bandwidth only.

## 2. Measurements

Machine: an Apple-silicon laptop (14 cores). Node 22.20.0, `pnpm i && pnpm turbo build` on `main` at `6ea6ddef`.

### 2.1 Live session: stream-repro, 2 s segments, 60 minutes

Eight synthetic programs of 15–50 s on a loop (about 110 program changes an hour), output 640×360, Homebrew FFmpeg
9.0.2. Two scripts ran beside the capture. A sampler watched the session directory (one stat every 50 ms; a new inode
is one rewrite) and the session's ffmpeg processes (`proc_pid_rusage`). A poller read the served playlist every 2 s
and checked it. Commands are in the appendix.

**The run.** The capture ran its full 3,600 s: 1,828 segments, 113 programs (one ffmpeg each), 112 discontinuities.
It had no session restarts and no findings: no `pts_gap`, `pts_overlap`, `track_layout_change` or `av_start_offset`.

**`stream.m3u8` over the hour:**

| Minute | Entries | Size | Discontinuity lines | Written to `stream.m3u8` so far |
|---:|---:|---:|---:|---:|
| 0 | 2 | 0.4 KB | 1 | 0 |
| 10 | 333 | 47 KB | 22 | 7.9 MB |
| 20 | 639 | 91 KB | 41 | 29 MB |
| 30 | 942 | 134 KB | 59 | 63 MB |
| 40 | 1,248 | 177 KB | 77 | 111 MB |
| 50 | 1,552 | 220 KB | 96 | 171 MB |
| 60 | 1,854 | 263 KB | 114 | 244 MB |

**One rewrite per segment.**

- At minute 60 the file held 145.3 bytes per entry, counting the discontinuity lines.
- The sampler saw 1,801 rewrites, each a new inode, for 1,852 new entries. Every rewrite added at least one entry.
  The 51 that added more than one came during read-ahead bursts, when segments arrived faster than the 50 ms poll.
- Summing the versions it saw, ffmpeg wrote at least 244 MB to `stream.m3u8` in the first hour: 7.9 MB in the first
  10 minutes and 73 MB in the last 10. The formula 145.3 × n²/2 gives 250 MB.

**The whole file, every time.** Divide each ffmpeg's logical writes (`proc_pid_rusage`) by its segment files plus
every playlist version it wrote, and the ratio stays flat: a median of 1.06 for programs started in the first 10
minutes and 1.05 after minute 50. If ffmpeg only appended each new entry, the same ratio would climb from 1.11 to
1.49. The 50 s program wrote 14.9 MB at minute 0 and 20.9 MB at minute 57. The 6 MB difference is its 24 rewrites
of a file that had grown to about 250 KB.

**ffmpeg's memory.** The median peak RSS was 129.8 MB for the 21 programs started in minutes 0–10 and 129.9 MB for
the 18 started after minute 50. FFmpeg 9.0.2 holds about 170 bytes per entry, so 1,850 entries add about 0.3 MB, too
little to see. On 8.1.3 the same session would add about 23 MB by minute 60 (2.2).

**Program start.** The median time from a program's ffmpeg spawning to its first segment appearing in
`stream.m3u8`:

- 2,828 ms in minutes 0–10 and 2,822 ms after minute 50: no measurable change.
- About 2.8 s of that is a realtime program's pacing (`-readrate 1`) through its first 2 s segment, plus encoder
  start. The two read-ahead programs at the start took 99–135 ms.
- At 1,850 entries the read-back is below this noise. The benchmark puts it at +13 ms on 9.0.2 and +34 ms on 8.1.3.
  It reaches 0.3 s on 8.1.3 after 3 hours and 2 s on 7.1.1 after 6 hours (2.2).

**Tunarr's side.** The poller made 1,497 requests from minute 9 to minute 59 and found **zero violations**.
`MEDIA-SEQUENCE` went from 287 to 1,808 and the discontinuity sequence from 17 to 109, both only forward. No
segment's program date-time or discontinuity number changed between polls. Playlist request latency did not trend
with the session's age:

| Minutes | Requests | Median | p95 | Max |
|---|---:|---:|---:|---:|
| 9–10 | 25 | 1.85 ms | 2.52 ms | 11.9 ms |
| 10–20 | 299 | 2.12 ms | 4.02 ms | 12.3 ms |
| 20–30 | 300 | 1.47 ms | 3.10 ms | 11.4 ms |
| 30–40 | 299 | 1.65 ms | 3.30 ms | 5.4 ms |
| 40–50 | 299 | 1.92 ms | 3.50 ms | 10.7 ms |
| 50–60 | 275 | 1.87 ms | 3.94 ms | 11.8 ms |

**A caveat on CPU.** The same 50 s program used 8–11 s of ffmpeg CPU before minute 22 and 14–16 s after minute 26.
That is a step, not a trend: from minute 26 to 57 the playlist doubled and the CPU stayed flat. The benchmark puts
the playlist's share at this size under 0.1 s per program. The step was the machine, probably the other agent's runs
and which cores macOS chose, so this run's CPU figures say nothing about the playlist. Section 2.2 measures that
directly.

### 2.2 ffmpeg's cost at 12-hour and 24-hour sizes

A playlist of N entries was written in exactly ffmpeg's format: 2 s entries, a discontinuity every 16 entries, program
date-times, Tunarr's base URL. Then an ffmpeg with Tunarr's HLS options appended to it, encoding a tiny synthetic
input as fast as it could. Each N ran with 4 s and 44 s of input. The difference between the two (20 segments, so 20
rewrites) gives the cost per rewrite. Three builds were tested:

- jellyfin-ffmpeg 8.1.3, `/usr/bin/ffmpeg` in the fork's image, which Tunarr runs by default there;
- ErsatzTV FFmpeg 7.1.1, `/usr/local/bin/ffmpeg` in the same image. Upstream Tunarr's image is built on it and its docs
  recommend it;
- Homebrew FFmpeg 9.0.2, native on macOS.

The two Linux builds ran in Docker under x86-64 emulation on the laptop. Their absolute times are slower than a real
x86 server would be, but the growth with N is the point. Memory figures do not depend on emulation.

**Program start: extra time to the first new segment file, compared with an empty playlist** (median)

| Entries (2 s segments) | Session age | 8.1.3 | 7.1.1 | 9.0.2 |
|---:|---:|---:|---:|---:|
| 1,800 | 1 h | +34 ms | +36 ms | +13 ms |
| 5,400 | 3 h | +344 ms | +453 ms | +71 ms |
| 10,800 | 6 h | +380 ms | +1.7–2.0 s | +84 ms |
| 21,600 | 12 h | +415 ms | +8.1–11.3 s | +112 ms |
| 43,200 | 24 h | +524 ms | **+54–76 s** | +167 ms |

**Peak resident memory of the ffmpeg process** (the encode alone, with an empty playlist: 48 MB on 8.1.3, 65 MB on
7.1.1, 22 MB on 9.0.2)

| Entries | 8.1.3 | 7.1.1 | 9.0.2 |
|---:|---:|---:|---:|
| 1,800 | 71 MB | 88 MB | 22.6 MB |
| 5,400 | 116 MB | 132 MB | 23.1 MB |
| 10,800 | 183 MB | 199 MB | 24.2 MB |
| 21,600 | 317 MB | 333 MB | 25.8 MB |
| 43,200 | **585 MB** | **601 MB** | 29.4 MB |

That is 12,413–12,557 bytes per entry on 8.1.3 and 7.1.1, against 169–282 bytes on 9.0.2. A real channel's ffmpeg
uses more for its own encode (about 130 MB at 640×360 in section 2.1). The playlist's share is added on top.

**Per segment, beyond what the same ffmpeg costs with an empty playlist**

| Entries | Bytes written (8.1.3, `/proc/<pid>/io`) | Extra CPU per rewrite (8.1.3) | Extra CPU per rewrite (9.0.2) |
|---:|---:|---:|---:|
| 1,800 | 0.25 MB | 1.5 ms | 1.7 ms |
| 10,800 | 1.65 MB | 7.4 ms | 9.0 ms |
| 21,600 | 3.13 MB | 13.8 ms | 17.8 ms |
| 43,200 | **6.21 MB** | **34.5 ms** | 35.6 ms |

The bytes written per segment, less the segment file itself, match the playlist's size within 5% each time: the whole
file is rewritten for every segment. At 43,200 entries, 7.1.1 costs the same per rewrite, about 35–40 ms more than with an
empty playlist, after taking out its parse.

### 2.3 Extrapolation (linear, unverified)

The live run measured 145.3 bytes per entry and one rewrite per new segment. The following assumes both hold for a
whole day and that the session never restarts. **These are extrapolations, not measurements.** They also take
programs to be much longer than the test's 15–50 s ones: short programs add one extra short segment and one
discontinuity line each.

| Segment length | Session age | Entries | `stream.m3u8` | Rewrite rate | Written to `stream.m3u8` so far | ffmpeg memory for the list (8.x) |
|---:|---:|---:|---:|---:|---:|---:|
| 4 s (default) | 12 h | 10,800 | 1.6 MB | 0.39 MB/s | 8.5 GB | 134 MB |
| 4 s | 24 h | 21,600 | 3.1 MB | 0.79 MB/s | 34 GB | 268 MB |
| 2 s | 12 h | 21,600 | 3.1 MB | 1.6 MB/s | 34 GB | 268 MB |
| 2 s | 24 h | 43,200 | 6.3 MB | 3.1 MB/s | 136 GB | 537 MB |
| 1 s (minimum) | 24 h | 86,400 | 12.6 MB | 12.6 MB/s | 543 GB | 1.07 GB |

For scale, the media itself at the repro's 2.2 Mbit/s is 0.27 MB/s. With 2 s segments the playlist outwrites the
media after about 2 hours (per second) and after about 4 hours (in total). The 1 s row is beyond anything measured:
86,400 entries were not tried, and 7.1.1's parse there would be roughly four times the 24-hour figure.

## 3. Design options

All four keep `stream.m3u8` as the file ffmpeg writes and Tunarr reads. A fix has to keep what viewers see the same:
`#EXT-X-MEDIA-SEQUENCE` that only moves forward and equals the first listed segment's number, a
`#EXT-X-DISCONTINUITY-SEQUENCE` that only moves forward, program date-times that never change for a segment, and the
same tune-in.

### (a) Bounded `-hls_list_size L`, Tunarr's index keeps the history

**What changes.**

- **ffmpeg:** `HlsOutputFormat` and `HlsDirectOutputFormat` pass `-hls_list_size L` from `hlsOptions.hlsListSize`.
  `append_list`, `omit_endlist` and `discont_start` stay. `delete_segments` stays off, so `deleteOldSegmentFiles`
  remains the only thing that deletes segment files.
- **ffmpeg's behaviour then:** the playlist holds the newest L entries. `#EXT-X-MEDIA-SEQUENCE` is the first listed
  number. A new process reads at most L entries and continues the numbering from `MEDIA-SEQUENCE` plus the entry
  count (`n8.1:1183` and the per-entry increment). Discontinuity tags leave the file with their entries, and nothing
  records how many left (1.2).
- **Choosing L:** L = ⌈900 s / `hlsTime`⌉, 15 minutes of segments: 450 at 2 s, 225 at 4 s, 900 at 1 s. ffmpeg's cost
  is then bounded by session length at any age: at most 11 MB of list memory on 8.x, a 131 KB rewrite, and a parse of
  tens of milliseconds even on 7.1.1 (measured +36 ms at 1,800 entries).
- **Why 15 minutes is enough:** Tunarr is never much more than 90 s ahead. It starts the next program at 60 s ahead or
  less, and a read-ahead burst adds at most 60 s to a lead under 30 s. A session that gets no playlist request for 120 s
  is stale (`Session.ts:333`) and is cleaned up within the next minute
  (`ScheduleJobsStartupTask.ts:70-77`). So between two reads, a live session appends far fewer than 15 minutes of
  segments.

**Can today's index take it? No.** The in-memory index is fine on its own. It numbers segments from their file names,
not from `MEDIA-SEQUENCE`, and `discardSegmentsBelow` already drops old entries while remembering enough to refuse
filters that reach them. The reader is what breaks. Its head anchor sees the body's first bytes change on every
rewrite, so every request parses the whole file again (`MediaPlaylistReader.ts:187-190`). That restarts the index
(`#reset`) from whatever the window's first entry is. A scratch probe fed today's reader the windows ffmpeg would write
(L = 30, programs every 10 segments) and compared the result with the reference trim of the whole-session file:

| Segments so far | Expected first PDT / disc. seq. | Served from the window |
|---:|---|---|
| 40 | 17:00:40 / 2 | 17:00:20 / 1 |
| 41 | 17:00:42 / 2 | 17:00:20 / 1 |
| 45 | 17:00:50 / 2 | 17:00:20 / 1 |
| 60 | 17:01:20 / 4 | 17:00:20 / 1 |

`MEDIA-SEQUENCE` stayed right, because it comes from file names. Program date-times lagged by the dropped duration and
kept moving: segment 25 is listed at a different time on each poll. The discontinuity sequence stopped while tags
scrolled off. Every read was a full parse.

**Tunarr side of the change:**

1. **`MediaPlaylistReader` anchors on segment numbers, not byte offsets.** It reads the file's tail (64 KiB, like
   `TranscodeSpeedWatcher`) and parses entries into number, `EXTINF`, URI, and whether a discontinuity tag precedes
   them. It skips numbers it already has and appends the rest, carrying the running start time and discontinuity
   count over from the last read. It reads the whole window only when the last known number is not in the tail.
2. **The window's leading tags.** A discontinuity tag before the window's first entry is a header artifact at session
   start, as today. Otherwise it counts only between a known entry and a new one.
3. **Gaps.** If the first new number is not the last known number plus one, the reader logs a warning once and treats
   the jump as a discontinuity, estimating the missing time as the missing count times `hlsTime`. Sizing L should make
   this unreachable, and a test pins the behaviour.
4. **The fallback that re-parses the whole file** when a filter reaches discarded segments (`MediaPlaylistReader.ts:97-103`)
   can no longer recover anything, because the file no longer has them. No production filter reaches there today:
   `before_date` has no caller, and `before_segment_number` is clamped to `#segmentFloor`. It becomes a clamp to the
   kept segments, with a test.
5. **Housekeeping:** `HlsSession.getHlsOptions` sets `hlsListSize` to L. Fix the comments that assume the whole session
   is in the file (`MediaPlaylistIndex.ts:69-79, 101-108`, `MediaPlaylistReader.ts:30-45`, `HlsSession.ts:136-140`)
   and resolve the TODO at `testing/hls/ReferenceHlsPlaylistTrim.ts:101-102`.

**Risk: medium.** The reader is the oracle-tested centre of playlist serving. A mistake shows up as program date-time
jumps or discontinuity errors (Kodi's "No segments in the manifest", AVPlayer stalls). Splitting the work keeps each
step checkable:

- **PR 1 (reader).** The reader change lands while `hls_list_size` is still 0. The existing randomized oracle tests
  must still pass unchanged, which shows it changes nothing on the wire.
- **PR 2 (flag).** Flips the flag, with the real-ffmpeg test and the stream-repro evidence below.

Upstream divergence grows a little; the reader is already fork-only. Precedents: `subs.m3u8` already uses a 20-entry
window (`HlsSubtitleOutputFormat.ts:64-69`), and `hls_slower` uses `hls_list_size 25` with `delete_segments`
(`HlsConcatOutputFormat.ts:28-37`).

**Effect:** all ffmpeg-side growth goes away on every ffmpeg version, including 7.1.x's quadratic start.

### (b) Tunarr periodically rewrites a trimmed playlist

This is the TODO in the reference trim.

**What changes:**

- ffmpeg writes the file from its own list after every segment, so a trim made while a program runs is overwritten
  within one segment.
- The only point where a trim lasts is between programs. `HlsSession.run` awaits each ffmpeg before starting the next,
  so the trim goes there, under the session lock: write the newest K entries, byte for byte, with
  `#EXT-X-MEDIA-SEQUENCE` set to the first kept number, to a temp file, then rename it over the playlist.

**Effect:** the next process reads K entries and starts from K. Within a program, growth continues: a 2-hour movie at
2 s still ends with 3,600 entries (45 MB on 8.x, 0.5 MB per rewrite).

**Risk: medium-high.**

- The reader needs the same segment-number anchoring as (a), because the file's head moves at every trim.
- On top of that it adds a second writer to a file ffmpeg owns. A crash can leave a stray `.tmp`.
- ffmpeg's numbering then depends on Tunarr writing `MEDIA-SEQUENCE` exactly right. An off-by-one would renumber
  segments over files players are fetching.

It is more code than (a) for a weaker bound. Not recommended.

### (c) A playlist per program, concatenated by Tunarr

**What changes:**

- **ffmpeg:** each program writes its own playlist (`stream-<k>.m3u8`) without `append_list`, with
  `-start_number <next segment number>` and `omit_endlist` (or an `ENDLIST`, since the process ends), and with
  `-hls_segment_type mpegts` unchanged.
- **Tunarr:** the reader follows a list of playlists and inserts the discontinuity at each join itself.
  `-master_pl_name` then names the per-program playlist, so `HlsMasterPlaylistMutator.rewriteVariantPlaylistUrls`
  (`HlsMasterPlaylistMutator.ts:24-27`), which matches by exact name, changes too. So do the readiness check
  (`BaseHlsSession.ts:247-250`), `TranscodeSpeedWatcher`'s path, and the pipeline state that carries the playlist path
  (`BasePipelineBuilder.ts:1000-1012`).

**Effect:** no read-back at all. Memory and rewrites are bounded by the program's length (a 3-hour film at 2 s is
5,400 entries) unless `hls_list_size` is also bounded, which brings back everything in (a).

**Risk: high, size L.** It touches the ffmpeg pipeline, the master playlist, readiness and the reader. Its only gain
over (a) is a few tens of milliseconds of read-back.

### (d) Do nothing

The numbers that would justify it:

- With the image's jellyfin-ffmpeg 8.1.3 at the default 4 s segments, a 12-hour session costs about 134 MB of extra
  ffmpeg memory, a 1.6 MB rewrite every 4 s, and +0.4 s at program changes. All of that is tolerable on a host with
  memory to spare and a tmpfs transcode directory.
- Sessions that long happen. FORK.md's playlist entries started from a real session about 3 hours in (5,265
  segments), and a TV left on a channel makes a day-long one.

What argues against it:

- **2 s segments** (a fork setting) quadruple the write rate. At 24 hours that is about 540 MB of extra memory per
  ffmpeg and 3.1 MB/s of rewrites.
- **Several long sessions add up.** Each holds its own list.
- **FFmpeg 7.1.x.** The fork supports it (it keeps 7.1.1 as the image's fallback), and upstream ships it. There, a
  12-hour session at 2 s, or a 24-hour session at 4 s, waits 8–11 s for each new program. A 24-hour session at 2 s
  waits about a minute and stalls at program changes.
- **FFmpeg 9.0** (not in the image yet) would remove the memory, but not the writes or the CPU.

### Recommendation: (a), size M, in two PRs

**PR 1: the reader keeps the history (M).** `MediaPlaylistReader` and `MediaPlaylistIndex` as above. No flag change,
so the served playlists stay byte-identical.

Tests:

- `MediaPlaylistReader.test.ts`, **windowed oracle:**
  - For random sessions (the existing `randomPlaylists.ts` generators), at each step write the window ffmpeg would
    write with L between 5 and 40. That means `MEDIA-SEQUENCE` = first entry, the `discont_start` header tag only
    while it is 0, and no `DISCONTINUITY-SEQUENCE`.
  - Assert the served playlist equals `ReferenceHlsPlaylistTrim` on the whole-session file at the same step.
  - This fails on today's reader (see the probe above).
- **Unit cases:**
  - A read after ffmpeg restarts with a window that starts mid-program.
  - A discontinuity tag at the window's head at session start (ignored) and later (counted only between known and new
    entries).
  - A gap (logged, one discontinuity, estimated time).
  - The clamp that replaces the full re-parse fallback.
- **Behaviour-neutral check:** the existing randomized and scenario tests in `MediaPlaylistReader.test.ts` and
  `HlsPlaylistMutator.test.ts` pass unchanged with `hls_list_size 0`.
- **A per-request bound:** a test like the existing "a request on a 20,000-segment session reads under 8 KiB" for a
  windowed file.

**PR 2: bound ffmpeg's list (S).** `HlsOutputFormat`, `HlsDirectOutputFormat`, `HlsSession.getHlsOptions`, a FORK.md
entry.

Tests:

- `HlsOutputFormat.test.ts` and `HlsDirectOutputFormat.test.ts`: `-hls_list_size` comes from the options.
- **New `HlsAppendWindow.local.test.ts` (real ffmpeg).**
  - Run two processes with `-hls_list_size 5` and `append_list`.
  - Assert that the numbering continues across the restart and that `MEDIA-SEQUENCE` equals the first listed number.
  - Assert there is no `DISCONTINUITY-SEQUENCE`, that a discontinuity tag precedes the second process's first
    segment, and that a dropped entry's tag leaves the file with it.
  - This pins the ffmpeg behaviour (a) relies on, across 7.1, 8.x and 9.x. It belongs in the real-binary CI job (T28).
- `HlsSession.test.ts`: a long simulated session whose file is a window, served across ffmpeg restarts, keeps
  `MEDIA-SEQUENCE` and the discontinuity sequence continuous.

**The stream-repro check that proves no viewer-visible regression.** Run the same command before and after PR 2:

```bash
node .claude/skills/stream-repro/scripts/repro.mjs --clip-durations 20,35,15,50,25,40,30,45 \
  --seconds 1800 --ffmpeg-setting hlsSegmentSeconds=2 --resolution 640x360 --rewind 15 --out "$OUT"
```

The window (450 entries) starts sliding at minute 15, so the second half of the run exercises it. Add the poller from
this investigation to `repro.mjs` as a playlist-continuity check, so it is reusable. Pass if:

1. **Continuity:** zero violations from the poller. `MEDIA-SEQUENCE` equals the first listed segment and never goes
   back. A segment's discontinuity number and program date-time never change between polls. Each segment starts where
   the one before it ends. The discontinuity sequence never goes back. The baseline in 2.1 had zero violations in
   1,497 polls.
2. **Program joins:** `report.findings` has no `pts_gap`, `pts_overlap` or `track_layout_change` that the baseline
   run lacks, and every program join is one `#EXT-X-DISCONTINUITY` (`perPiece[].discontinuityBefore`).
3. **Rewind:** no `playlist_lists_missing_segment` with `--rewind 15`.
4. **Bounded:** the sampler shows `stream.m3u8` holding 450 entries after minute 15, and ffmpeg's peak memory flat
   from program to program.
5. **Tune-in unchanged:** the median "HLS session ready after N ms" of five cold tune-ins matches the baseline. The
   first program of a session has nothing to read back in either version.

### Upstream

Upstream Tunarr has the same flags with fixed 4 s segments (`upstream/main:server/src/ffmpeg/builder/options/HlsOutputFormat.ts`).
Its Docker image links ErsatzTV FFmpeg 7.1.1 to `/usr/bin/ffmpeg` (`upstream/main:Dockerfile`). So an upstream Docker
user whose session runs a day waits 8–11 s for each new program, and about a minute after two days. Upstream's
playlist reader still parses the whole file on every request, so (a)'s Tunarr side does not port directly. The ffmpeg
side of this finding is worth an upstream issue once the fork's fix has run for a while. Upstream contributions were
tabled on 2026-10-18.

## 4. Evidence appendix

Local paths are written as `$OUT`, `$BENCH` and `$TOOLS`. The sampler, poller and benchmark were scratch scripts and
are not committed. What each one does is described next to its command.

### 4.1 Environment

```bash
PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH"
pnpm i && pnpm turbo build          # 5/5 tasks, exit 0
cp <main checkout>/server/bin/meilisearch server/bin/   # the worktree had no Meilisearch binary
```

The stream-repro server uses `/usr/bin/ffmpeg` unless told otherwise, and this Mac has none there, so every repro run
passed `--ffmpeg-setting ffmpegExecutablePath=/opt/homebrew/bin/ffmpeg --ffmpeg-setting
ffprobeExecutablePath=/opt/homebrew/bin/ffprobe`.

### 4.2 The 60-minute run

```bash
python3 -I $TOOLS/sampler.py "$OUT" "$OUT-sampler.jsonl" 3900 &      # 50 ms stat loop, 0.5 s proc_pid_rusage
node .claude/skills/stream-repro/scripts/repro.mjs \
  --clip-durations 20,35,15,50,25,40,30,45 --seconds 3600 \
  --ffmpeg-setting hlsSegmentSeconds=2 \
  --ffmpeg-setting ffmpegExecutablePath=/opt/homebrew/bin/ffmpeg \
  --ffmpeg-setting ffprobeExecutablePath=/opt/homebrew/bin/ffprobe \
  --resolution 640x360 --out "$OUT"
python3 -I $TOOLS/poller.py "http://127.0.0.1:<port>/stream/channels/<channel>/hls/stream.m3u8" \
  "$OUT-poller.jsonl" 3000 2                                         # started at minute 9
```

Another agent's short stream-repro runs (30–45 s each) shared the machine during part of the hour. The realtime
timings in 2.1 may carry a little of that noise.

Every program's ffmpeg in the 60-minute run, from the sampler: when it started, how many entries the playlist held
when it started, the time to its first segment file and its first listing, peak RSS, logical writes and CPU time
(the last two from its final 0.5 s sample).

| Minute | Entries before | Spawn → first segment file (ms) | Spawn → listed (ms) | Peak RSS (MB) | Logical writes (MB) | CPU (s) |
|---:|---:|---:|---:|---:|---:|---:|
| 0.0 | 0 | 98 | 135 | 130.5 | 2.06 | 0.99 |
| 0.0 | 10 | 98 | 99 | 131.6 | 10.36 | 4.92 |
| 0.0 | 28 | 2822 | 2823 | 129.0 | 3.87 | 2.25 |
| 0.3 | 36 | 2834 | 2834 | 130.1 | 14.91 | 8.10 |
| 1.1 | 61 | 2828 | 2829 | 129.1 | 6.85 | 3.91 |
| 1.5 | 74 | 2825 | 2826 | 130.2 | 11.78 | 7.20 |
| 2.2 | 94 | 2824 | 2825 | 130.2 | 8.65 | 5.08 |
| 2.7 | 109 | 2822 | 2823 | 129.8 | 13.31 | 7.24 |
| 3.4 | 132 | 2825 | 2825 | 130.2 | 5.88 | 3.16 |
| 3.7 | 142 | 2827 | 2828 | 129.3 | 10.30 | 8.22 |
| 4.3 | 160 | 2832 | 2833 | 129.0 | 3.98 | 2.96 |
| 4.6 | 168 | 2828 | 2830 | 129.6 | 15.50 | 10.27 |
| 5.4 | 193 | 2831 | 2831 | 129.2 | 7.27 | 4.87 |
| 5.8 | 206 | 2822 | 2823 | 129.8 | 12.33 | 8.36 |
| 6.4 | 226 | 2830 | 2832 | 131.9 | 9.24 | 6.22 |
| 6.9 | 241 | 2830 | 2831 | 131.1 | 13.75 | 9.55 |
| 7.7 | 264 | 2832 | 2832 | 129.5 | 6.11 | 3.40 |
| 8.0 | 274 | 2827 | 2828 | 129.0 | 10.58 | 5.57 |
| 8.6 | 292 | 2831 | 2832 | 128.4 | 4.38 | 2.79 |
| 8.9 | 300 | 2830 | 2830 | 130.5 | 15.93 | 10.23 |
| 9.7 | 325 | 2827 | 2828 | 129.8 | 7.43 | 4.53 |
| 10.2 | 338 | 2823 | 2824 | 130.7 | 12.92 | 7.50 |
| 10.8 | 358 | 2827 | 2828 | 130.3 | 9.45 | 5.32 |
| 11.3 | 373 | 2826 | 2827 | 129.8 | 14.19 | 10.21 |
| 12.0 | 396 | 2831 | 2832 | 130.0 | 6.31 | 3.60 |
| 12.4 | 406 | 2827 | 2828 | 129.5 | 10.72 | 6.10 |
| 12.9 | 424 | 2833 | 2835 | 128.9 | 4.33 | 2.63 |
| 13.2 | 432 | 2825 | 2826 | 129.6 | 16.17 | 9.83 |
| 14.0 | 457 | 2826 | 2827 | 129.7 | 7.66 | 4.86 |
| 14.4 | 470 | 2827 | 2828 | 129.1 | 13.02 | 7.14 |
| 15.2 | 490 | 2827 | 2828 | 129.8 | 9.69 | 5.13 |
| 15.7 | 505 | 2821 | 2822 | 130.1 | 14.42 | 9.65 |
| 16.4 | 528 | 2831 | 2831 | 128.6 | 6.43 | 4.50 |
| 16.7 | 538 | 2832 | 2833 | 129.8 | 10.92 | 8.66 |
| 17.3 | 556 | 2822 | 2824 | 128.9 | 4.27 | 3.50 |
| 17.6 | 564 | 2827 | 2830 | 129.7 | 16.80 | 11.21 |
| 18.4 | 589 | 2826 | 2826 | 129.6 | 7.80 | 5.11 |
| 18.8 | 602 | 2831 | 2832 | 129.7 | 13.29 | 9.47 |
| 19.4 | 622 | 2823 | 2824 | 130.0 | 10.04 | 6.05 |
| 19.9 | 637 | 2827 | 2827 | 130.5 | 14.94 | 9.78 |
| 20.7 | 660 | 2818 | 2819 | 129.0 | 6.56 | 4.64 |
| 21.0 | 670 | 2818 | 2819 | 129.1 | 11.79 | 7.56 |
| 21.7 | 688 | 2816 | 2817 | 130.1 | 4.50 | 2.64 |
| 21.9 | 696 | 2816 | 2820 | 130.0 | 17.28 | 10.10 |
| 22.7 | 721 | 2817 | 2818 | 129.3 | 8.82 | 4.33 |
| 23.2 | 734 | 2817 | 2818 | 129.5 | 13.80 | 7.29 |
| 23.8 | 754 | 2818 | 2819 | 129.5 | 10.21 | 5.54 |
| 24.3 | 769 | 2818 | 2821 | 129.4 | 15.25 | 8.69 |
| 25.0 | 792 | 2821 | 2822 | 130.1 | 6.79 | 4.84 |
| 25.4 | 802 | 2818 | 2819 | 129.2 | 12.00 | 10.11 |
| 26.0 | 820 | 2816 | 2819 | 128.9 | 4.64 | 4.15 |
| 26.2 | 828 | 2817 | 2819 | 129.9 | 18.00 | 14.37 |
| 27.0 | 853 | 2814 | 2817 | 129.1 | 8.31 | 6.99 |
| 27.5 | 866 | 2819 | 2822 | 130.2 | 14.10 | 11.55 |
| 28.2 | 886 | 2818 | 2821 | 129.5 | 10.42 | 8.10 |
| 28.7 | 901 | 2816 | 2817 | 129.7 | 16.21 | 11.45 |
| 29.4 | 924 | 2817 | 2818 | 128.9 | 6.95 | 4.89 |
| 29.7 | 934 | 2816 | 2819 | 130.5 | 12.20 | 10.41 |
| 30.3 | 952 | 2817 | 2820 | 129.2 | 4.70 | 4.70 |
| 30.6 | 960 | 2813 | 2814 | 129.6 | 18.26 | 16.19 |
| 31.4 | 985 | 2818 | 2821 | 130.0 | 8.46 | 8.43 |
| 31.8 | 998 | 2816 | 2819 | 129.9 | 14.50 | 13.69 |
| 32.5 | 1018 | 2818 | 2820 | 129.0 | 10.95 | 6.95 |
| 32.9 | 1033 | 2816 | 2820 | 130.0 | 16.13 | 9.93 |
| 33.7 | 1056 | 2819 | 2820 | 129.4 | 7.10 | 4.02 |
| 34.1 | 1066 | 2818 | 2819 | 130.0 | 12.37 | 8.95 |
| 34.7 | 1084 | 2817 | 2821 | 129.2 | 4.84 | 3.52 |
| 34.9 | 1092 | 2814 | 2817 | 129.6 | 18.36 | 15.02 |
| 35.7 | 1117 | 2813 | 2815 | 130.5 | 8.58 | 7.84 |
| 36.2 | 1130 | 2814 | 2817 | 130.9 | 15.09 | 12.86 |
| 36.8 | 1150 | 2817 | 2821 | 129.9 | 11.15 | 10.51 |
| 37.3 | 1165 | 2815 | 2817 | 128.9 | 16.76 | 14.36 |
| 38.0 | 1188 | 2816 | 2818 | 128.9 | 7.30 | 6.35 |
| 38.4 | 1198 | 2816 | 2820 | 129.3 | 12.72 | 11.27 |
| 39.0 | 1216 | 2815 | 2819 | 128.1 | 4.95 | 4.51 |
| 39.2 | 1224 | 2815 | 2817 | 129.4 | 19.17 | 15.80 |
| 40.1 | 1249 | 2820 | 2823 | 128.9 | 9.18 | 7.71 |
| 40.5 | 1262 | 2814 | 2816 | 129.2 | 15.53 | 12.96 |
| 41.2 | 1282 | 2816 | 2818 | 129.7 | 11.37 | 9.47 |
| 41.7 | 1297 | 2813 | 2815 | 129.8 | 17.15 | 14.40 |
| 42.4 | 1320 | 2814 | 2818 | 128.6 | 7.41 | 6.10 |
| 42.7 | 1330 | 2820 | 2823 | 129.5 | 13.14 | 10.90 |
| 43.3 | 1348 | 2817 | 2821 | 129.5 | 5.02 | 4.28 |
| 43.6 | 1356 | 2816 | 2819 | 129.3 | 19.84 | 16.08 |
| 44.4 | 1381 | 2818 | 2822 | 129.2 | 9.19 | 7.34 |
| 44.8 | 1394 | 2818 | 2822 | 130.0 | 15.74 | 12.64 |
| 45.5 | 1414 | 2815 | 2818 | 129.3 | 11.68 | 9.56 |
| 45.9 | 1429 | 2815 | 2817 | 131.0 | 17.52 | 14.35 |
| 46.8 | 1452 | 2819 | 2824 | 129.7 | 7.54 | 5.99 |
| 47.1 | 1462 | 2817 | 2819 | 129.8 | 13.60 | 10.75 |
| 47.7 | 1480 | 2818 | 2820 | 129.3 | 5.26 | 3.68 |
| 47.9 | 1488 | 2818 | 2820 | 128.7 | 20.11 | 15.40 |
| 48.7 | 1513 | 2819 | 2824 | 130.3 | 9.36 | 7.37 |
| 49.2 | 1526 | 2816 | 2821 | 129.3 | 15.96 | 12.49 |
| 49.8 | 1546 | 2821 | 2823 | 129.2 | 11.87 | 9.28 |
| 50.3 | 1561 | 2816 | 2820 | 130.6 | 17.71 | 14.00 |
| 51.0 | 1584 | 2821 | 2823 | 129.6 | 7.92 | 5.92 |
| 51.4 | 1594 | 2823 | 2827 | 129.9 | 13.81 | 10.90 |
| 52.0 | 1612 | 2821 | 2828 | 129.6 | 5.20 | 4.39 |
| 52.3 | 1620 | 2823 | 2827 | 130.0 | 20.48 | 15.84 |
| 53.1 | 1645 | 2816 | 2819 | 129.1 | 10.41 | 7.85 |
| 53.5 | 1658 | 2816 | 2820 | 129.8 | 16.27 | 12.65 |
| 54.2 | 1678 | 2818 | 2823 | 129.7 | 12.08 | 9.27 |
| 54.7 | 1693 | 2817 | 2820 | 130.6 | 18.44 | 14.22 |
| 55.4 | 1716 | 2819 | 2821 | 129.4 | 7.97 | 6.19 |
| 55.7 | 1726 | 2814 | 2820 | 130.4 | 13.87 | 10.49 |
| 56.3 | 1744 | 2822 | 2824 | 129.0 | 5.46 | 4.44 |
| 56.6 | 1752 | 2823 | 2828 | 129.9 | 20.85 | 15.67 |
| 57.4 | 1777 | 2821 | 2823 | 129.8 | 9.60 | 7.59 |
| 57.8 | 1790 | 2821 | 2826 | 130.2 | 16.71 | 12.30 |
| 58.5 | 1810 | 2816 | 2820 | 129.7 | 12.42 | 9.17 |
| 59.0 | 1825 | 2818 | 2820 | 130.3 | 18.62 | 8.23 |
| 59.8 | 1848 | 2819 | 2821 | 129.9 | 5.49 | 2.08 |

### 4.3 The benchmark

```bash
# FFmpeg 9.0.2, native
python3 -I $BENCH/bench.py --ffmpeg /opt/homebrew/bin/ffmpeg --label 9.0.2 \
  --out $BENCH/res-9.0.2-mac.json --durations 4,44 --reps 3
# jellyfin-ffmpeg 8.1.3 and FFmpeg 7.1.1 from the fork's image (linux/amd64, emulated)
docker run --rm --platform linux/amd64 -v $BENCH:/bench --entrypoint python3 ghcr.io/oliviacpu/tunarr:latest \
  /bench/bench.py --ffmpeg /usr/bin/ffmpeg --label 8.1.3 --out /bench/res-8.1.3-linux.json --durations 4,44 --reps 2
docker run --rm --platform linux/amd64 -v $BENCH:/bench --entrypoint python3 ghcr.io/oliviacpu/tunarr:latest \
  /bench/bench.py --ffmpeg /usr/local/bin/ffmpeg --label 7.1.1 --out /bench/res-7.1.1-linux.json \
  --durations 4,44 --reps 1 --timeout 1800        # run twice (the second at 0, 10800, 21600, 43200)
```

For each N in 0, 1,800, 5,400, 10,800, 21,600 and 43,200, `bench.py` does the following:

- Writes `stream.m3u8` with a header in ffmpeg's format (`#EXT-X-VERSION:6`, `#EXT-X-TARGETDURATION:2`,
  `#EXT-X-MEDIA-SEQUENCE:0`, a `discont_start` tag, `#EXT-X-INDEPENDENT-SEGMENTS`).
- Follows it with N entries (`#EXTINF:2.000000,`, `#EXT-X-PROGRAM-DATE-TIME:…`,
  `/stream/channels/<uuid>/hls/dataNNNNNN.ts`) and a discontinuity tag every 16. That is 6,277,622 bytes at 43,200.
- Runs:

```bash
ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=160x90:rate=30:duration=$D -f lavfi -i sine=frequency=440:sample_rate=48000:duration=$D \
  -map 0:v -map 1:a -c:v libx264 -preset veryfast -threads 1 -g 60 -keyint_min 60 \
  -force_key_frames 'expr:gte(t,n_forced*2)' -c:a aac -b:a 64k \
  -f hls -hls_time 2 -hls_list_size 0 -segment_list_flags +live -hls_segment_type mpegts \
  -hls_segment_filename $DIR/data%06d.ts -hls_base_url /stream/channels/<uuid>/hls/ -master_pl_name playlist.m3u8 \
  -hls_flags program_date_time+append_list+independent_segments+omit_endlist+discont_start \
  -hls_segment_options mpegts_flags=+initial_discontinuity $DIR/stream.m3u8
```

- Records the time from spawn to `data<N>.ts` existing (a 2 ms poll), and CPU time and `ru_maxrss` from `wait4`. On
  Linux it also records `/proc/<pid>/status` VmHWM and `/proc/<pid>/io` wchar every 50 ms.

Raw rows (open = spawn to first new segment file, s; CPU = user + system, s; RSS = `ru_maxrss`):

| Build | N | D | Rep | Open (s) | CPU (s) | RSS (MB) | Playlist out (bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8.1.3 | 0 | 4 | 0 | 0.165 | 0.278 | 47.8 | 431 |
| 8.1.3 | 0 | 44 | 0 | 0.163 | 1.256 | 48.5 | 3311 |
| 8.1.3 | 1800 | 4 | 0 | 0.196 | 0.311 | 70.6 | 262004 |
| 8.1.3 | 1800 | 44 | 0 | 0.191 | 1.298 | 71.2 | 264884 |
| 8.1.3 | 5400 | 4 | 0 | 0.506 | 0.630 | 115.2 | 785129 |
| 8.1.3 | 5400 | 44 | 0 | 0.525 | 1.694 | 115.7 | 788009 |
| 8.1.3 | 10800 | 4 | 0 | 0.540 | 0.667 | 182.4 | 1569806 |
| 8.1.3 | 10800 | 44 | 0 | 0.541 | 1.795 | 183.1 | 1572686 |
| 8.1.3 | 21600 | 4 | 0 | 0.576 | 0.722 | 316.4 | 3139181 |
| 8.1.3 | 21600 | 44 | 0 | 0.574 | 2.002 | 317.1 | 3142061 |
| 8.1.3 | 43200 | 4 | 0 | 0.675 | 0.881 | 584.6 | 6277931 |
| 8.1.3 | 43200 | 44 | 0 | 0.665 | 2.437 | 585.4 | 6280811 |
| 8.1.3 | 0 | 4 | 1 | 0.159 | 0.272 | 47.9 | 431 |
| 8.1.3 | 0 | 44 | 1 | 0.151 | 1.228 | 48.5 | 3311 |
| 8.1.3 | 1800 | 4 | 1 | 0.193 | 0.303 | 70.6 | 262004 |
| 8.1.3 | 1800 | 44 | 1 | 0.198 | 1.308 | 71.0 | 264884 |
| 8.1.3 | 5400 | 4 | 1 | 0.498 | 0.623 | 115.2 | 785129 |
| 8.1.3 | 5400 | 44 | 1 | 0.503 | 1.650 | 116.0 | 788009 |
| 8.1.3 | 10800 | 4 | 1 | 0.556 | 0.692 | 182.3 | 1569806 |
| 8.1.3 | 10800 | 44 | 1 | 0.539 | 1.793 | 183.0 | 1572686 |
| 8.1.3 | 21600 | 4 | 1 | 0.597 | 0.755 | 316.3 | 3139181 |
| 8.1.3 | 21600 | 44 | 1 | 0.576 | 1.962 | 317.0 | 3142061 |
| 8.1.3 | 43200 | 4 | 1 | 0.712 | 0.924 | 584.6 | 6277931 |
| 8.1.3 | 43200 | 44 | 1 | 0.694 | 2.680 | 585.3 | 6280811 |
| 7.1.1 | 0 | 4 | 0 | 0.155 | 0.287 | 64.6 | 431 |
| 7.1.1 | 0 | 44 | 0 | 0.161 | 1.437 | 65.2 | 3311 |
| 7.1.1 | 1800 | 4 | 0 | 0.189 | 0.334 | 87.1 | 262004 |
| 7.1.1 | 1800 | 44 | 0 | 0.199 | 1.500 | 87.8 | 264884 |
| 7.1.1 | 5400 | 4 | 0 | 0.604 | 0.753 | 131.7 | 785129 |
| 7.1.1 | 5400 | 44 | 0 | 0.618 | 2.031 | 132.5 | 788009 |
| 7.1.1 | 10800 | 4 | 0 | 2.140 | 2.299 | 198.7 | 1569806 |
| 7.1.1 | 10800 | 44 | 0 | 2.103 | 3.575 | 199.2 | 1572686 |
| 7.1.1 | 21600 | 4 | 0 | 11.187 | 11.383 | 332.9 | 3139181 |
| 7.1.1 | 21600 | 44 | 0 | 11.208 | 13.052 | 333.2 | 3142061 |
| 7.1.1 | 43200 | 4 | 0 | 76.521 | 76.754 | 600.9 | 6277931 |
| 7.1.1 | 43200 | 44 | 0 | 54.577 | 56.655 | 601.9 | 6280811 |
| 7.1.1 (2nd) | 0 | 4 | 0 | 0.149 | 0.274 | 64.5 | 431 |
| 7.1.1 (2nd) | 0 | 44 | 0 | 0.147 | 1.347 | 65.0 | 3311 |
| 7.1.1 (2nd) | 10800 | 4 | 0 | 1.885 | 2.033 | 199.0 | 1569806 |
| 7.1.1 (2nd) | 10800 | 44 | 0 | 1.879 | 3.273 | 199.4 | 1572686 |
| 7.1.1 (2nd) | 21600 | 4 | 0 | 8.266 | 8.438 | 332.8 | 3139181 |
| 7.1.1 (2nd) | 21600 | 44 | 0 | 11.430 | 13.034 | 333.5 | 3142061 |
| 7.1.1 (2nd) | 43200 | 4 | 0 | 64.547 | 64.768 | 601.3 | 6277931 |
| 7.1.1 (2nd) | 43200 | 44 | 0 | 57.889 | 60.041 | 601.9 | 6280811 |
| 9.0.2 | 0 | 4 | 0 | 0.050 | 0.093 | 21.9 | 431 |
| 9.0.2 | 0 | 44 | 0 | 0.050 | 0.561 | 22.3 | 3311 |
| 9.0.2 | 1800 | 4 | 0 | 0.065 | 0.108 | 22.4 | 262004 |
| 9.0.2 | 1800 | 44 | 0 | 0.062 | 0.604 | 22.8 | 264884 |
| 9.0.2 | 5400 | 4 | 0 | 0.121 | 0.171 | 23.2 | 785129 |
| 9.0.2 | 5400 | 44 | 0 | 0.122 | 0.724 | 23.1 | 788009 |
| 9.0.2 | 10800 | 4 | 0 | 0.136 | 0.193 | 24.0 | 1569806 |
| 9.0.2 | 10800 | 44 | 0 | 0.136 | 0.833 | 24.3 | 1572686 |
| 9.0.2 | 21600 | 4 | 0 | 0.166 | 0.240 | 25.8 | 3139181 |
| 9.0.2 | 21600 | 44 | 0 | 0.161 | 1.054 | 25.8 | 3142061 |
| 9.0.2 | 43200 | 4 | 0 | 0.217 | 0.328 | 29.1 | 6277931 |
| 9.0.2 | 43200 | 44 | 0 | 0.221 | 1.501 | 29.4 | 6280811 |
| 9.0.2 | 0 | 4 | 1 | 0.051 | 0.093 | 22.0 | 431 |
| 9.0.2 | 0 | 44 | 1 | 0.052 | 0.551 | 22.1 | 3311 |
| 9.0.2 | 1800 | 4 | 1 | 0.067 | 0.109 | 22.3 | 262004 |
| 9.0.2 | 1800 | 44 | 1 | 0.063 | 0.602 | 22.7 | 264884 |
| 9.0.2 | 5400 | 4 | 1 | 0.125 | 0.172 | 23.0 | 785129 |
| 9.0.2 | 5400 | 44 | 1 | 0.122 | 0.730 | 23.5 | 788009 |
| 9.0.2 | 10800 | 4 | 1 | 0.135 | 0.190 | 24.1 | 1569806 |
| 9.0.2 | 10800 | 44 | 1 | 0.134 | 0.835 | 24.3 | 1572686 |
| 9.0.2 | 21600 | 4 | 1 | 0.166 | 0.239 | 25.7 | 3139181 |
| 9.0.2 | 21600 | 44 | 1 | 0.163 | 1.062 | 26.4 | 3142061 |
| 9.0.2 | 43200 | 4 | 1 | 0.221 | 0.330 | 29.3 | 6277931 |
| 9.0.2 | 43200 | 44 | 1 | 0.212 | 1.498 | 29.7 | 6280811 |
| 9.0.2 | 0 | 4 | 2 | 0.052 | 0.092 | 22.1 | 431 |
| 9.0.2 | 0 | 44 | 2 | 0.055 | 0.553 | 22.3 | 3311 |
| 9.0.2 | 1800 | 4 | 2 | 0.065 | 0.109 | 22.4 | 262004 |
| 9.0.2 | 1800 | 44 | 2 | 0.067 | 0.604 | 22.9 | 264884 |
| 9.0.2 | 5400 | 4 | 2 | 0.122 | 0.170 | 23.0 | 785129 |
| 9.0.2 | 5400 | 44 | 2 | 0.122 | 0.717 | 23.5 | 788009 |
| 9.0.2 | 10800 | 4 | 2 | 0.135 | 0.193 | 24.0 | 1569806 |
| 9.0.2 | 10800 | 44 | 2 | 0.136 | 0.823 | 24.2 | 1572686 |
| 9.0.2 | 21600 | 4 | 2 | 0.160 | 0.237 | 25.8 | 3139181 |
| 9.0.2 | 21600 | 44 | 2 | 0.164 | 1.051 | 25.8 | 3142061 |
| 9.0.2 | 43200 | 4 | 2 | 0.213 | 0.324 | 29.2 | 6277931 |
| 9.0.2 | 43200 | 44 | 2 | 0.221 | 1.504 | 29.6 | 6280811 |

### 4.4 The window probe

A scratch Vitest file next to `MediaPlaylistReader.test.ts`, deleted afterwards. It does the following:

- Renders the session's entries (2 s each, a discontinuity every 10) as ffmpeg would with `hls_list_size 30`:
  `MEDIA-SEQUENCE` = first kept entry, the `discont_start` header tag only while that is 0, a discontinuity tag kept
  with its entry.
- At 40, 41, 45 and 60 segments, it writes that window, calls `MediaPlaylistReader.trim(start,
  before_segment_number(count - 10, keep 10 before, floor 0), {maxSegmentsToKeep: 20, targetDuration: 2})`, and
  compares the result with `ReferenceHlsPlaylistTrim.trimPlaylist` on the whole-session rendering.

The results are the table in option (a). The reader reported `fullParses` 1, 2, 3, 4 and `incrementalReads` 0.

### 4.5 FFmpeg source consulted

`libavformat/hlsenc.c` at tags `n7.1`, `n7.1.1`, `n8.0`, `n8.1` and `n9.0`, and `libavformat/hlsplaylist.c` at
`n8.0`, fetched from the FFmpeg repository through jsDelivr. The functions compared across versions:

- `parse_playlist`, `hls_window`: identical in substance from 7.1.1 to 9.0.
- `hls_append_segment`: the `nb_entries <= 5000` guard is absent in 7.1.x and present from 8.0.
- `HLSSegment`: fixed arrays through 8.1, a flexible array member in 9.0.
