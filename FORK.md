# About this fork

This is a personal fork of [chrisbenincasa/tunarr](https://github.com/chrisbenincasa/tunarr), built into a Docker image
for one self-hosted deployment. It follows upstream's `main` and adds the targeted fixes and features listed below.
Upstream's own documentation, `CLAUDE.md` and `AGENTS.md` still apply.

## Builds

- Images are built only for tags named `oliviacpu-…`, by date: `oliviacpu-2026.10.13`, with `.2` for a second one the same
  day. Pushes to `main` build nothing (`.github/workflows/fork-image.yml`). To release:
  `git tag oliviacpu-2026.10.13 && git push origin oliviacpu-2026.10.13`.
- Each build pushes `ghcr.io/oliviacpu/tunarr:<tag>`, `:sha-<commit>` and, when its tag is the newest `oliviacpu-` tag,
  `:latest`, for linux/amd64, and creates a GitHub Release for the tag. The deployment runs `:latest`, so pushing a tag
  releases it; an older tag's build finishing last can't move `:latest` back. Its notes list what's new since the previous `oliviacpu-` tag and
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

### Console log times carry their real offset (2026-10-18)

- **What you saw:** `2026-10-18T09:50:49.131Z` in the console log for an event that happened at 14:50:49 UTC: the
  time was local (TZ=America/Chicago) but ended in `Z`, so every reading against Plex's UTC log was 5 hours off.
- **Cause:** `getPrettyStreamOpts` used `SYS:yyyy-mm-dd'T'HH:MM:ss.l'Z'`: the system zone with a literal `Z`.
- **Fix:** `SYS:yyyy-mm-dd HH:MM:ss.l o`, local time with its offset (`-05:00`).
- **Tests:** `LoggerFactory.test.ts`: the pretty-stream time format has no literal `Z` and prints an offset.
- **Upstream:** not sent.

### The .ts stream starts when a second audio track is a few seconds late (2026-10-17)

- **What you saw:** a cold tune of a channel with two audio tracks (Audio tracks `eng, jpn`, loudness levelling on)
  failed at once. The .ts wrapper exited with code 234 after `sample rate not set` and `Could not write header
  (incorrect codec parameters ?)`. Re-tuning a minute later worked.
- **Cause:** the wrapper copies every stream of the session, so ffmpeg must find each stream's parameters before it
  writes the output header. It reads only its default window: 5 MB, and for the HLS demuxer's segment demuxer
  4 s of analysis when none is set. A track whose first packets come after that window has no sample rate, and the
  MPEG-TS muxer refuses the header. Reproduced with the wrapper's exact command against an HLS stream whose second
  audio track starts 8 s in: exit 234 with the same messages. The exact trigger on the deployment (what made that
  track late on that tune) couldn't be reproduced locally: 80 cold and near-cold tunes of a two-track channel, with
  and without loudness levelling and with the deployment's segment settings, all started.
- **Fix:** `hlsWrap` gives the wrapper's input `-analyzeduration 15000000 -probesize 50000000`
  (`ProbeWindowInputOption`). ffmpeg stops probing as soon as every stream is known, so this only waits when a track
  is late; a track with no packets at all still fails after 15 s.
  - Against the late-track stream: starts, with the second track's packets in the output from 8 s.
  - Tune-in through Tunarr unchanged: 20 cold tunes each with the deployment's settings, first byte median 0.80 s
    before and 0.81 s after.
- **Tests:** `BasePipelineBuilder.test.ts`: the wrapper gets the window before its input (fails on the old code).
- **Upstream:** not sent.

### The .ts stream keeps every frame where segments and programs meet (2026-10-17)

- **What you saw:** captions that lost two letters ("You" as "u"), about one frame lost every 40 s on a slow shared
  server. The .ts stream Plex reads (the wrapper: an ffmpeg that joins a session's
  HLS segments, with `-fflags +discardcorrupt`) had a 2-frame gap there.
- **Cause:** ffmpeg's MPEG-TS demuxer marks the PES it is building as corrupt when the next packet's continuity counter
  doesn't follow on, and `+discardcorrupt` drops it. That PES is the last frame before the join. Two things broke the
  counters:
  - **Captioned segments (most joins):** to end a captioned segment on its original counter, the inserter gives the
    last frame enough extra packets by moving its last bytes one per packet (`packetizePes`). When that frame's last
    full packet held no more bytes than were moved, the packet disappeared, so the segment came out one packet short
    and the next segment's first counter didn't follow on. In a 200 s run, a segment's captioned copy ended on counter
    6 while the original ended on 7, and the verbose wrapper log showed `Packet corrupt (stream = 0, dts = …), dropping
    it` each time.
  - **Program boundaries (with or without captions):** a later program's transcode restarts its counters at 0 and was
    meant to flag its first packets as a discontinuity with `-mpegts_flags +initial_discontinuity`. The HLS muxer
    doesn't pass that to its segment muxer, so the flag never appeared and the previous program's last frame was
    dropped.
- **Fix:**
  - `packetizePes` decides how many packets a PES takes first (the minimum plus the extra), then fills them, leaving one
    byte for each packet still to come, so it always makes exactly that many. `insertCaptions` checks that the captioned
    video ends on the original counter and otherwise serves the segment as it is.
  - `HlsOutputFormat` and `HlsDirectOutputFormat` pass the flag through `-hls_segment_options
    mpegts_flags=+initial_discontinuity`, so a later program's first packet of each stream carries the discontinuity
    indicator, which the demuxer accepts.
  - Measured with `stream-repro --mode hdhr` (2 s segments, captions on): 3 synthetic programs of 100 s, 240 s
    captured, 5 lost frames before (each the last frame of a segment, two at program boundaries), none after; a DVD
    excerpt with sidecar subtitles played three times (330 s, two program boundaries), 10192 frames with no gap and
    every caption equal to its subtitle cue.
- **Tests:** `MpegTsCaptionInserter.test.ts`: a captioned segment ends on the original counter for every slice size
  from 300 to 699 bytes (fails on the old code at 319), and `packetizePes` makes exactly the minimum plus the extra
  packets for every length up to 600 and every extra up to 15, keeping every byte. `HlsOutputFormat.test.ts` and
  `HlsDirectOutputFormat.test.ts`: a later program passes the flag through `-hls_segment_options` (fails on the old
  code).

### A burned-in subtitle's path can hold any character (2026-10-17)

- **What you saw:** a program with a forced subtitle never started. ffmpeg said `No option name near
  '2]aresample=…'` and `Error parsing filterchain '[0:0]pad=…,subtitles=…'`. The subtitle file's name had an
  apostrophe in it (`… - Kid's Final Test.en.forced.srt`).
- **Cause:** FFmpeg reads a filter option's value twice, first when it splits the filtergraph into filters and
  then when it splits a filter's arguments into options (`av_get_token` both times). `SubtitleFilter` escaped the
  path once, and only for `[`, `]` and `:`.
  - **Apostrophe:** an apostrophe opened a quote that swallowed the rest of the graph.
  - **Comma and semicolon:** ended the filter early.
  - **Colon:** lost its single backslash at the graph level, then split the path into options.
  - **Equals sign:** the positional form could also read a path with `=` as `option=value`.
- **Fix:**
  - **`escapeFilterOptionValue`** (`filter/escapeFilterValue.ts`) escapes a literal value for both levels, as in
    FFmpeg's "Notes on filtergraph escaping": `\ ' :` for the option, then `\ ' [ ] , ;` for the graph, plus
    whitespace at either end, which `av_get_token` trims.
  - **`SubtitleFilter`** uses it with the named option, `subtitles=filename=…`, in every pipeline (software,
    NVIDIA, QSV, VAAPI). Windows and HTTP paths need no special cases any more.
  - **No other filter takes a path:** watermarks and images are `-i` inputs, and the drawtext titles are fixed
    strings.
- **Test:**
  - **`escapeFilterValue.test.ts`:** a port of `av_get_token` reads every escaped value back exactly, across
    apostrophes, colons, commas, semicolons, brackets, `=`, `%`, backslashes, leading and trailing spaces, tabs,
    newlines, unicode, a Windows path and an HTTP URL. It also matches the two-level example in FFmpeg's
    documentation, and the burned-in filter no longer swallows the chain after it. Old code: 13 of the 27 fail.
  - **`SoftwarePipeline.local.test.ts`:** real ffmpeg burns in a sidecar under such a name.
  - **stream-repro (`--keep-names`):**
    - before: the program's transcode failed on every start ("Unable to parse 'original_size' option value
      '1]aresample…'"), the HLS session restarted, and 4 segments came through in 30 s;
    - after: 8 segments came through with the subtitle burned in.
- **Reach:** on one library, 77 forced text tracks on 71 programs had such a path: 62 sidecars, and 15 embedded
  tracks in 13 videos. Forced tracks are the ones burned in even with captions on. With captions off, any burned
  text subtitle counts: 3,737 tracks on 1,012 programs, 784 of them with an apostrophe.
- **Upstream:** not sent.

### A source reporting a frame rate that isn't standard keeps all its frames (2026-10-17)

- **What you saw:** on a DVD-sourced series, closed captions in Plex were often missing, or lost letters ("You" as
  "u"), and motion was slightly jerky.
- **Cause:**
  - **The reported rate:** the files' headers report 20 fps, but their frames come about 24 a second (they alternate
    1/24 s and 1/30 s apart). With "Normalize Frame Rate" off, Tunarr sets no output rate, and ffmpeg's HLS output is
    constant-rate at the input's reported rate, so the channel ran at 20 fps and dropped about one frame in six.
  - **Captions at 20 fps:** CEA-608 sends two characters per frame, so captions had two thirds of their usual room,
    and players expect a standard rate. Captions were also laid out at the source's reported rate, not at the output's,
    so any difference between the two (a field-rate deinterlacer doubling the rate, or QSV, whose `fps` filter always
    used 24 because `getNumericFrameRateOrDefault` ignores a rate `parseInt` can read) made HlsSession send padding only.
- **Fix:**
  - `outputFrameRate` (`server/src/ffmpeg/outputFrameRate.ts`) never gives fewer frames a second than the source
    reports: a standard rate (23.976, 24, 25, 29.97, 30, 50, 59.94, 60), a rounded label for one (within 0.05%) or a
    rate up to 2% below one (an average over a few missing frames, 23.81 in the library that showed this) is that
    standard rate exactly; one above them all (high-frame-rate video, 120) is kept; any other, including one a little
    above a standard rate (30.3), gets 29.97 below 30 fps or 59.94 above.
  - `FfmpegPlaybackParamsCalculator.calculateForStream` sets the output rate (`-r <rate> -fps_mode cfr`) for a
    non-standard source, or one corrected up to a standard rate, always (left alone, ffmpeg's HLS output keeps the
    reported rate), with "Normalize Frame Rate", and, new, whenever HDHomeRun captions are on
    (`pinFrameRate`). When the pipeline deinterlaces in software, a field-rate filter (`none`, which is yadif=1,
    `yadif=1`, `bwdif=1`, `w3fdif`) doubles it, so no field-rate frames are dropped: without hardware acceleration,
    with VideoToolbox, with QSV when hardware filters are off, with VAAPI and CUDA when hardware decoding is off, and
    with CUDA for interlaced MPEG-2 and looping items (a filler clip shorter than its slot), which it always decodes
    in software. QSV's own `deinterlace_qsv` always outputs a
    frame per field (FFmpeg sets `field_rate` for it), so QSV with hardware filters doubles it too.
    VAAPI and CUDA also fall back to software when the GPU can't decode the source, which only the pipeline knows;
    there the extra frames are dropped back to the source rate, and captions still match the output.
  - `FfmpegStreamFactory` lays captions and the "No captions" notice out at that output rate, never at the source's.
  - `QsvPipelineBuilder` uses the chosen rate in its `fps` filter instead of dropping the output rate.
  - NTSC rates go to ffmpeg as exact fractions (`30000/1001`, `ffmpegFrameRate`).
  - Local measurement (`stream-repro --clip-file <a 2 min excerpt of a DVD-sourced episode with a 20 fps header,
    sidecar subtitles> --mode hdhr --ffmpeg-setting hdhrClosedCaptions=true --seconds 100`): before, 20.000 fps,
    2011 frames 50 ms apart (the source has about 2400 in that time); after, 29.97 fps, every source frame kept, the
    raw HLS segments 33.4 ms apart with no gap, and every caption equal to its subtitle except where the .ts wrapper
    lost a frame (next point).
- **Still open:**
  - **Fixed since:** the .ts wrapper's lost frames where segments and programs meet ("The .ts stream keeps every
    frame where segments and programs meet").
  - **Hardware pipelines:** whether a pipeline's deinterlacer doubles the frame rate is worked out from the transcode
    config and the source, mirroring each builder's choice. A GPU that can't decode a codec falls back to software
    in VAAPI and CUDA, which only the pipeline knows: there the pinned rate keeps the source's, so a field-rate
    deinterlacer's extra frames are dropped (captions still match). Only the software pipeline has been checked end
    to end. Follow-up: have the pipeline report the output rate it ends up with, and lay captions out at that.
- **Tests:** `outputFrameRate.test.ts`; `FfmpegPlaybackParamsCalculator.test.ts` (non-standard rates with the setting
  on and off and in MPEG-TS mode, near-standard rates, `pinFrameRate`, deinterlacing per filter and pipeline);
  `FfmpegStreamFactory.test.ts` (captions and the notice at the output rate; a 20 fps source outputs 29.97; nothing
  pinned with captions off); `QsvPipelineBuilder.test.ts` (the chosen rate in `fps` and `-r`). All new cases fail on
  the old code.
- **Also:** `stream-repro` gained `--clip-file PATH` (a real file as a program, sidecar subtitles included) and
  `--mode hdhr` (the HDHomeRun `.ts` stream, with `report.captions`: frame spacing and the decoded captions).
- **Upstream:** not sent.

### A caption pair is never lost or sent twice because of frame timing (2026-10-17)

- **What you saw:** captions in Plex that lost two letters ("You" as "u"), or lost a whole caption when the lost pair
  was a command.
- **Cause:** each video frame took the caption pair of the frame slot it is shown in (`CaptionSchedule.pairAt`,
  rounding its time). A slot without a frame lost its pair, and two frames in one slot sent it twice, which doubles
  letters or turns a control code's redundant copy into a second command. The inserter also asked per frame in decode
  order, so the answer couldn't depend on the frames around it.
- **Fix:**
  - `insertCaptions` reads a segment's frames first and asks once for all their pairs, in presentation order
    (`pairsForFrames`; sorted by offset from the segment's first frame, so a segment across the 33-bit PTS wrap keeps
    its order).
  - `pairsForFrames` (`server/src/stream/captions/pairsForFrames.ts`), called by `HlsSession` for each program's
    frames in a segment, hands the pairs out: a slot without a frame has its pair sent on the frames that follow, one
    a frame and in order; a second frame in a slot sends padding, or the copy of the control code the frame before
    sent, so the two copies stay on consecutive frames; a program's first frames start from its first slot, so pairs
    due before a frame missing there still go out; a jump of 8 slots or more is a new start, not a backlog to send
    late.
  - It reads only the segment's own frames, so a segment is captioned the same however often and in whatever order
    segments are asked for (two viewers, a retry). A frame missing right where a segment starts can't be told from the
    segment alone and loses its pair; Tunarr's own segments are evenly spaced, so that would take a frame lost before
    them.
  - `HlsSession` checks each program's frame spacing in a segment before laying out its pairs, so a mismatched program
    is sent as padding without touching other programs in the same segment.
- **What it couldn't fix:** a frame the .ts wrapper lost after captioning, fixed since ("The .ts stream keeps every
  frame where segments and programs meet").
- **Tests:** `pairsForFrames.test.ts` (a missing frame, two frames in a slot, a control code's copies and a program's
  missing first frames fail on the old slot lookup; one per slot, a later segment's start and a long jump are guards);
  `MpegTsCaptionInserter.test.ts` (asked once, in presentation order, with B-frames and across the PTS wrap);
  `HlsSession.test.ts` (a segment missing a frame sends every pair in order, which fails on the old code; a segment
  asked for twice is captioned the same way; two segments come out the same whichever is asked for first, which
  fails on a cursor shared between requests). The golden caption snapshot is unchanged.
- **Upstream:** not sent.

### Tuning in during a gap starts as fast as during a program (2026-10-17)

- **What you saw:** Live TV took about 11 s to start when you tuned in during a gap (the channel's offline picture and
  gap music), against about 6 s during a program. Schedules pad to slot boundaries, so gaps fall just before the hour
  and half hour, when people tune in.
- **Cause:**
  - **No read-ahead:** a session's first transcode reads its input ahead (`-readrate_initial_burst 60`) so the first
    segments exist within a second, but only programs got that. `ProgramStream` passed gaps and error screens
    `opts.realtime`, which HLS sessions never set, so `createPlaceholderSession` fell back to real time. Two 2 s
    segments then took over 4 s of wall time.
  - **The picture over the network:** the offline picture is usually an upload, saved with the server's public
    address, so ffmpeg fetched it back through that address (on a typical setup, over HTTPS through a reverse proxy).
- **Fix:**
  - `ProgramStream.setupOfflineItem` and `setupErrorItem` fall back to the session's pace (`context.realtime`), as
    programs do, so a first transcode that lands in a gap reads ahead too. After the 60 s burst it runs at real time,
    like a program (a 150 s gap: 60 s of it within 5 s, then 10 s of media per 10 s).
  - **Except where a still picture can't read ahead:** the CUDA, QSV and VAAPI pipelines loop it with the loop filter,
    which repeats one decoded frame that `-readrate` can't pace; only the realtime filter can, and it has no burst.
    There a still-picture placeholder stays at real time (`FfmpegStreamFactory.paceStillImage`), or the whole gap
    would encode at full speed. Software and VideoToolbox loop it at the input, so they read ahead.
  - `ProgramStream` resolves an uploaded offline picture to its file (`localUploadFile`, `uploadsDirectory`,
    `server/src/util/iconUtil.ts`) and hands it to `createPlaceholderSession` as `picture`. It reads the file only
    when the URL's `?v=` matches the file's contents (`uploadVersion`, the hash every upload URL carries), so a
    same-named picture on another server keeps its URL whatever host it names. Other URLs, missing files and names
    that aren't plain file names keep the URL too.
  - Local measurement (`stream-repro --flex-first 45000 --offline-picture <png>`, 2 s segments, 2 before the
    playlist, 3 runs each): the first segment of a tune into a gap came after 7.0 s before and 1.0 s after; into a
    program, 1.0 s both times. The 1 s floor was the once-a-second readiness check, which now looks every 0.1 s (next entry).
- **Tests:** `ProgramStream.test.ts` (a gap and an error screen follow the session's pace; an uploaded picture is read
  from disk; other pictures keep their URL; the first three fail without the fix), `FfmpegStreamFactory.test.ts` (the
  offline input uses the picture it's given, else the URL; with CUDA, QSV or VAAPI a still-picture placeholder stays
  at real time, which fails without `paceStillImage`), `iconUtil.test.ts` (`localUploadFile`, including a same-named
  picture with other contents).
- **Also:** `stream-repro` gained `--offline-picture FILE`, which uploads an image and makes it the channel's offline
  picture.

### A tune-in's first transcode uses more threads (2026-10-17)

- **What you saw:** every Live TV tune-in took several seconds before the picture came up.
- **Cause:** Plex Live TV answers a tune only once it has 5 s of video, so a tune-in waits on the first transcode's
  first three 2 s segments. That transcode reads 60 s ahead of real time, but encoded with the transcode config's
  thread count (8 on the measured server), so on a shared CPU it ran at about 2x real time and segment 3 took ~3.7–4 s.
- **Fix:** in HLS mode, a transcode that reads ahead of real time (the first one after a tune-in, or one catching
  up) uses up to 16 threads, never more than the cores Tunarr may run on (`os.availableParallelism()`, which follows
  `taskset`) and never fewer than configured (`stream/hls/readAheadThreads.ts`, `HlsSession.transcode`). Real-time
  transcodes keep the configured count, and so does a config of 0 (ffmpeg chooses). Hardware pipelines get it too:
  a hardware encoder ignores it, but software decoding uses it, and so does the software encoder a pipeline falls
  back to when hardware encoding is disabled or unavailable.
- **Measured** (the server's CPU, libx264 veryfast 6 Mbit/s 1080p with loudnorm, a 15-minute seek, median of 3):
  segment 3 came at 2.69 s instead of 3.95 s for an HEVC 10-bit Blu-ray source, and 2.41 s instead of 3.71 s for an
  SD H.264 DVD source. CPU per second of media was unchanged (2.13 against 2.34 s, and 2.06 against 2.10 s), with
  about 20 more threads per such transcode.
- **Quality:** unchanged. On the same frames of 4 excerpts, 16 threads scored a mean VMAF within 0.02 of 8 threads
  (worst 5% of frames within 0.43) and PSNR-Y within 0.01 dB. A faster preset (superfast) would have saved another
  ~0.7 s but cost 0.4–1.2 VMAF and up to 1.2 dB for the rest of the program, so it isn't used.
- **Tests:** `readAheadThreads.test.ts` (the rule); `HlsSession.test.ts`: a read-ahead transcode gets 16 threads
  and a real-time one keeps the configured 4. The first fails on the old code.
- **Upstream:** not sent.

### A tune-in notices its first segments within 0.1 s (2026-10-17)

- **What you saw:** every Live TV tune-in took several seconds before the picture came up.
- **Cause:** a starting HLS session checked for its first segments once a second
  (`BaseHlsSession.waitForStreamReady`, 15 retries 1000 ms apart). The segments were often there well before the
  next check, so a tune-in waited about 0.5 s more on average, and up to a whole second.
- **Fix:** the check runs every 100 ms, with the same 15 s limit (`ReadyPollMs`, `ReadyTimeoutMs`). The "still
  waiting" debug line is logged about once a second, as before.
- **Test:** `BaseHlsSession.test.ts`: segments written 1.25 s in are noticed within 150 ms; the stream isn't ready
  until every required segment exists; it still gives up after about 15 s. The first two fail on the old interval.
- **Upstream:** not sent.

### The end of a caption no longer flashes past at tune-in (2026-10-17)

- **What you saw:** tuning in mid-sentence, a fragment of a caption was on screen for about half a second, then nothing
  for a second or two until the next caption.
- **Cause:** a cue already under way at the stream's first frame is loaded and shown as soon as it can be, until its
  own end ("A session's first program shows its captions on time", below). Loading takes about a third of a second at
  29.97 fps and more at lower frame rates, so a cue with under a second left showed its last words for 0.1–0.6 s.
- **Fix** (`buildCaptionSchedule`, `server/src/stream/captions/Cea608Encoder.ts`): a pop-on or paint-on caption under
  way at the first frame is left out when less than a second of it would be on screen, counting to its own end or the
  program's, whichever comes first. The next caption is then the first one shown, and nothing of the left-out one holds
  up its load. A pop-on cue is judged on its own before overlapping subtitles are stacked, so a longer one it
  overlapped shows alone as soon as it's loaded, not when the short one ends.

  - **Why a second:** it is `MinTailMs`, the minimum the encoder already used to bring a subtitle back for the rest of
    its time when a newer one ends ("Show the newest" overlaps). Both are the rest of a subtitle that began before the
    viewer saw it, so both get the same floor.
  - **Untouched:** captions that start on or after the first frame, however short; their start is what the subtitle
    file asks for. Roll-up keeps its rest too: its lines stay up, scrolled, while the next cue's arrive, so it reads as
    context rather than a flash.
  - At 29.97 fps, a 15-character cue under way at tune-in, on screen (first caption shown → cleared):

    | Left of the cue at tune-in | Before  | After             |
    | -------------------------- | ------- | ----------------- |
    | 0.6 s                      | 234 ms  | left out          |
    | 1.0 s                      | 634 ms  | left out          |
    | 1.3 s                      | 934 ms  | left out          |
    | 2.0 s                      | 1635 ms | 1635 ms, the same |

- **Tests:**
  - `Cea608Encoder.test.ts`: a cue under way with 0.6 s left is left out and the next shows on its own frame (fails
    without the fix); so is one whose program ends 0.6 s in, however long the cue runs on (fails without the clamp to
    the program's end); of two overlapping cues under way, one ending 0.6 s in, the other shows alone once loaded
    (fails without judging cues before stacking); with 2 s left it shows once loaded until its end; a short cue starting on the first frame still
    shows; paint-on leaves the rest out too (fails without the fix); roll-up keeps it, scrolled up by the next cue.
  - `Cea608Encoder.golden.test.ts`: its first cue is under way with 0.8 s to show at 15 fps, so the six 15 fps sections
    lose it (frames 0–23 only). The 23.976 and 29.97 fps sections, where it has over a second, are unchanged.
- **Upstream:** not sent.

### A channel's own caption settings, for a test channel (2026-10-16)

- **What you saw:** caption appearance, alignment and the test pattern were global FFmpeg settings, so trying a
  magenta box changed the captions on every channel, for the owner and friends alike. A test channel (99,
  plans/test-channel-99.md) needs its own.
- **Change:** a channel setting, **Captions for this channel**, under *Audio & Subtitles* on the Streaming tab:
  - **What it is:** `Channel.captions`, `{ testPattern?, alignment?, appearance? }`, stored in the new column
    `captions` (migration 0054). Only what the channel sets is saved; the rest follows the global settings, so a later
    global change still reaches it. The appearance fields have no defaults (`CaptionAppearanceOverridesSchema`), or an
    override would fill in every field.
  - **Test pattern on this channel:** the numbered samples on this channel only. The global switch still shows them on
    every channel, and the global closed-captions switch stays the master switch.
  - **Use own caption look:** alignment and every appearance field, shown with the global look; only the settings
    changed are saved as the channel's own. **Copy to all channels** writes this look over the latest FFmpeg
    settings; **Reset to global** drops it and keeps the test pattern.
- **How:**
  - `server/src/stream/captions/channelCaptions.ts`: the channel's look over the global one, whether it has one, and
    whether its test pattern is on.
  - `FfmpegStreamFactory`: attaches the channel's look to each program's captions (only when it has one), times the
    "No captions for this program" notice by it, and runs the test pattern per channel. The channel is loaded per
    program, so a change applies from the next program.
  - `HlsSession.addCaptions`: a program's own look wins over the global one.
  - Web: the caption controls moved out of the FFmpeg settings page into `CaptionAppearanceFields`, used by both
    pages; the channel's section is `ChannelCaptionsField`.
- **Verified end to end** (stream-repro, jellyfin-ffmpeg 8.1.3): one server, two HLS channels on the same two
  captioned clips, both HDHomeRun `.ts` streams captured for 30 s at once and decoded with FFmpeg's 608 decoder.

  | Channel 900's own setting | Channel 900 | Channel 901 (no setting) |
  | --- | --- | --- |
  | magenta text, blue box, left | 16 captions, `\c&HFF00FF&` `\3c&HFF0000&` at `\pos(57,243)` | the same 16, white, no box, `\pos(115,243)` |
  | test pattern | "1 WHITE TEXT", "2 GREEN TEXT", "3 BLUE TEXT"… | the clips' own captions |

- **Tests:**
  - `channelCaptions.test.ts`: merge precedence, fields that fall back, the test pattern rules.
  - `FfmpegStreamFactory.test.ts`: the channel's test pattern on that channel only and behind the global switch; its
    look reaches the captions; none for a channel without one; the notice timed by the channel's look.
  - `HlsSession.test.ts`: captions laid out in their channel's look. `Cea608Encoder.golden.test.ts` unchanged.
  - `ChannelDB.test.ts`: save and read back, update without the field, reset, only what is set is stored, validation,
    no defaults filled in, override fields in step with the global ones.
  - Web: `channelCaptions.test.ts` and `ChannelCaptionsField.test.tsx` (the global look shown, only changed
    settings saved, test pattern alone, off and reset, copy to all channels over settings changed since loading).
- **Upstream:** not sent.

### Test media for a test channel (2026-10-16)

- **What you saw:** nothing; a tool. Caption, audio and video options could only be tried on real channels, with real
  programs that hit some cases and not others.
- **Fix:** `scripts/test-channel/make-test-media.mjs` (README beside it) makes 20 labelled clips:
  - caption suites as sidecar SRT and ASS, spoken line by line so timing can be judged by ear;
  - English + Japanese and 5.1 speaker-check audio, stereo, English-only, AC3/E-AC3/AAC, 44.1 kHz;
  - HDR10 (with mastering metadata), HLG, 10-bit SDR, interlaced 29.97i, four frame rates, anamorphic 720x480;
  - three short clips with differing layouts for program boundaries.
  Every clip shows what it tests, a clock and a frame counter, and the script writes `manifest.json` with what ffprobe
  found. Used for the deployment's channel 99 (plan `plans/test-channel-99.md`).
- **Tests:** none in the suite; it's an offline tool. Its own check is the ffprobe manifest: every clip's tracks,
  language tags, colour tags, HDR side data and interlacing, verified against the table in the README.

### A caption's box colour holds to its end (2026-10-16)

- **What you saw:** with a magenta box, Plex for Mac often turned the box back to black partway through a caption,
  for its end or a closing ♪ (user: "almost like it was drawing the magenta over black or the timing of our codes is
  off?").
- **Cause:**
  - **The decoder:** FFmpeg's 608 decoder, the family Plex's players come from, keeps one current box colour
    (`libavcodec/ccaption_dec.c`). A background code sets it, each character is stamped with it as it's written
    (`write_char`), and Erase Displayed Memory resets it to black (`handle_edm`: `bg_color = CCCOL_BLACK`; End of
    Caption calls `handle_edm` too).
  - **The encoder:** a pop-on caption loads while the one before it is on screen, and that one's clear (Erase
    Displayed Memory) is placed first. The next caption's load is then fitted around it, so with a gap shorter than the
    load (under about a second, common in dialogue and songs) the clear landed inside it. The box code goes once at the
    start of each line, so the rest of the line was written on black.
  - **Seen in jellyfin-ffmpeg 8.1.3**, before the fix: `{\3c&HFF00FF&}Then{\i1} Hey!{\i0} to\Nthe
    ve{\3c&H000000&}ry end ♪`. The default box ("player") sends no box codes and was never affected.
- **Fix:** `server/src/stream/captions/Cea608Encoder.ts`.
  - A pop-on line that sets a box colour loads wholly before or wholly after any Erase Displayed Memory in the schedule
    (`groupedLoadSequence`; `placeBefore` and `placeFrom` keep each group on one side of a clear).
  - Only where that doesn't move the frame the caption shows on. A later caption would hold up the next one's load,
    which could then miss its own time and be left out (Codex, PR #28: three quick boxed cues showed only two). A
    caption with no room to load before its start loads as before, so its timing never changes. A line the clear
    falls in can still lose its box there; that only happens with very quick cues.
  - Default output (no box) is byte-identical; the golden snapshot is unchanged.
- **Test pattern:** sample 39 is a magenta box, then a second line 200 ms after it, keeping the box through italics, a ♪
  and its end.
- **Tests:**
  - `Cea608Encoder.test.ts`: a model of FFmpeg's box handling (box set by the code, stamped per character, reset by
    Erase Displayed Memory and End of Caption). Gaps of 2 to 30 frames keep every character magenta, and 6 of those 7
    fail without the fix. Three quick boxed cues all show, and a caption that has to load late still shows, boxed from
    its start.
  - `CaptionInsertion.local.test.ts`: jellyfin-ffmpeg 8.1.3 decodes the second caption with no black box after the
    magenta one; it fails without the fix.
  - `CaptionTestPattern.test.ts`: sample 39's timing.

### Saving a channel no longer rewrites every channel's guide entries (2026-10-16)

- **What you saw:** Live TV paused while channels were saved. On the deployment, with the owner watching channel 1,
  the latency probe saw 6 requests over 250 ms (worst 1.05 s), all while the Sci-Fi channel was being saved. The
  save took 4 s there. Editing channels in the web UI did the same on 2026-10-14.
- **Cause:**
  - Every save (`PUT /api/channels/:id`) ends with an XMLTV write.
  - That write fetched every guide program of every channel with all its relations, and rendered every channel's
    programmes.
  - On a copy of the deployment's database (6 channels, 72 h guide, 784 programs), the fetch was 133–382 ms of a
    181–426 ms write. The rest of the save took under 10 ms.
  - The fetch yields between chunks, but on the shared server a chunk can wait on a cold disk.
- **Fix:**
  - **`XmlTvWriter.write(channels, { reuse, onRendered })`:** a channel in `reuse` keeps the programmes an earlier
    write rendered, with no render and no artwork publish.
  - **`TvGuideService`:** remembers each channel's rendered programmes, keyed on the guide entry, channel object and
    programs array they came from, and on the render settings (XMLTV settings, credit-images flag).
  - **Redirects:** the key also holds each redirect target's presence, name and number. A redirect that wasn't
    followed when the guide was built renders from its target at write time (Codex on PR #26).
  - **Effect:** a save re-fetches and re-renders only the saved channel. A guide rebuild or a settings change renders
    everything again.
  - **Trade-off:** program details edited since (a scan) reach the other channels' entries at their next scheduled
    rebuild, as when nothing was saved (`docs/configure/channels/epg.md`).
  - The plan is in `plans/channel-save-guide-reuse.md`.
- **Measured** with `guide-refresh-ab.ts --action save` (new, with `--template-dir` for a copy of a real database)
  against the deployment's copy, medians of 3 trials, reuse off vs on:
  - **saving an offline picture:** 199 → 46 ms, probe p99 17.6 → 4.3 ms;
  - **saving a new start time** (the nightly grid build's save, which regenerates the lineup): 236 → 60 ms, probe
    p99 31.1 → 4.2 ms; stalls of 25–63 ms with reuse off, none with it on.
- **Tests:**
  - `XmlTvWriter.test.ts`: a full write matches `serialize`; a reused channel isn't rendered and publishes nothing.
  - `TvGuideService.test.ts`:
    - after a build, a save fetches and renders only the saved channel;
    - a rebuild or a settings change renders all;
    - a channel with an unresolved redirect is rendered again when its target appears, is renumbered or leaves;
    - a followed redirect stays reused when its target is renumbered.
  - Fail without their change: the writer's two, the first guide test and the unresolved-redirect one. The other two
    pass either way, by design.
- **Upstream:** not sent.

### Downloaded subtitles stay fresh, and a replaced subtitle heals at once (2026-10-16)

- **What you saw:** 132 programs served an older subtitle than the file next to the video (Bazarr's re-syncs and
  replacements), and a subtitle Plex had replaced answered 404 until two rescans later. Investigation:
  `plans/plex-stale-subtitle-404-2026-10-16.md`.
- **Cause:**
  - Through its `plex.direct` address Plex leaves out a sidecar subtitle's file path, so Tunarr downloaded a copy of
    every sidecar. The copy is named after the stream key and was never fetched again.
  - Playback read the copy ahead of a readable live file.
  - The hourly top-up skipped any copy that existed.
  - A 404 waited for Plex's rescan and then Tunarr's.
  - The deployment's fix was a local Plex address and a forced scan (done 2026-10-16). This makes Tunarr cope where
    that isn't possible.
- **Fix:**
  - **Playback prefers the live file:** `ProgramStreamDetailsFetcher` uses a sidecar's resolvable source path ahead of
    a downloaded copy.
  - **Old copies refresh:** `ExternalSubtitleDownloader.fetchToCache` with `refresh` fetches again and swaps the copy
    in only if it changed, through a temporary file and a rename. `SubtitleExtractorTask` does this hourly, for programs
    airing within the hour, to copies more than 6 hours old whose live file it can't read.
  - **A 404 heals at once:** the task reads the item again (`getMovie`/`getEpisode`), mints its subtitles and saves
    them with `replaceProgramSubtitles`, the scan's own save split out per program (new on `IProgramDB`). Sidecars
    that are still the same stream keep their file; replaced copies are deleted, and an item that lists no subtitles
    any more has its rows cleared. If the item still lists the stream that 404'd (the server hasn't rescanned yet),
    nothing is saved and the rows and copy stay until it does. An item that is gone is left to the next scan.
  - **Each program once a run:** a program airing twice in the hour (a repeat, or on two channels) is handled once,
    so a heal that can't succeed doesn't re-read the item each time.
  - **The scan says so:** a Plex scan logs once when sidecar paths are hidden while the video's path came through.
- **Tests:**
  - `ExternalSubtitleDownloader.test.ts`: refresh replaces a changed copy, keeps an unchanged one and renews its age,
    keeps the copy when a fetch fails, never fetches without refresh, and returns a 404 unlogged.
  - `ProgramStreamDetailsFetcher.test.ts`: the live file ahead of a copy (fails without the change), and the copy
    when the live file is out of reach.
  - `SubtitleExtractorTask.test.ts`:
    - a copy older than 6 hours is fetched again, a younger one isn't, nor one whose live file is readable;
    - on a 404 the item is read once, re-minted and saved, the new stream downloaded, and a still-valid sidecar keeps
      its file; films use the movie call; a gone item is left alone; a second 404 doesn't loop; an empty mint clears
      the rows; a program on two channels is read again once; an item that still lists the 404'd stream is left
      alone.
  - `ProgramDB.test.ts`: replacing a program's subtitles with none clears its rows and cached copies.
  - `MediaSourceScanner.test.ts`: the info line once a scan, again in the next scan, and not when the paths are
    reported or the video has none.
- **Upstream:** not sent.

### A custom show sync looks up its program ids without loading whole programs (2026-10-16)

- **What you saw:** nothing reported. A follow-up from the custom-show-sync work of 2026-10-15, where the lookup at the
  end of every sync was the worst stall: 163–186 ms at 1,000 movies, 870 ms at 3,000.
- **Cause:** `CustomShowSyncService` resolved the playlist's Tunarr ids with `lookupByExternalIds`. That loads every
  program with its album, artist, season, show, tags, artwork, credits, genres, studios and versions, only to read its
  id.
- **Fix:**
  - The sync uses `programIdsByExternalIds`, which reads only the external-id table, and matches the results with
    `createExternalId` (`server/src/services/CustomShowSyncService.ts`).
  - `IProgramDB` declared `programIdsByExternalIds` twice. The stale declaration claimed dot-separated keys, while the
    method returns `source|mediaSourceId|key`. It's gone, and `ProgramDB` declares the real key type.
- **Numbers:** `pnpm bench:custom-show-sync -- --movies 1000`, run back to back on the same machine. The in-process
  arm's worst stall went from 177 to 104 ms on the first sync, and from 263 to 100 ms on a resync. Syncs run in a scan
  worker by default; this is the in-process fallback, and the worker does less work too.
- **Tests:** `CustomShowSyncService.test.ts`. The stubs return the id map, and the old lookup now fails the test if
  it's called. Six tests fail against the previous service.
- **Upstream:** not sent.

### Switchable audio in Plex Live TV: a fixed audio track layout per channel (2026-10-16)

- **What you saw:** Plex Live TV offered one audio track, whichever the program's selection picked, so a dual-audio
  anime episode played in one language with no way to switch. Tested on 2026-10-14:
  - the Apple TV's audio menu does switch when the stream has several tracks;
  - Plex picks each account's preferred audio language from them;
  - but Plex keeps the track list it sees at tune-in for the whole session, and ends the session if the stream
    restarts, so the tracks can't change from program to program.
- **Change:** a channel setting, **Audio tracks**, under _Audio & Subtitles_ on the Streaming tab:
  - **What it is:** `Channel.audioTracks`, up to four ISO 639-2 codes in order, stored in the new column
    `audio_tracks` (migration 0053).
  - **Effect:** every program, commercial, gap (offline picture, with gap music or silence) and error screen on the
    channel outputs exactly those tracks, in that order, tagged with their languages.
  - **Filling a slot:**
    1. the program's main track, if it is already in that language;
    2. otherwise its track in that language: commentary skipped, then selected, default, first;
    3. otherwise the main track again, so the list never changes.
  - **Recommended Anime setting:** `eng, jpn`, English first, as the user chose.
- **How** (plans/switchable-audio.md):
  - **Builder:** several streams on an audio input each get their own filter chain, label and `-map`
    (`ComplexFilter`), language tag (`-metadata:s:a:<i>`), and `-ac` whenever any source differs. One stream keeps
    exactly today's arguments.
  - **Stream factory:** builds the slots (`AudioTrackLayout.ts`) for programs and placeholders.
  - **HLS alt:** its concat re-encodes audio streams 1..N.
  - **MPEG-TS:** its concat maps every stream (`-map 0`) instead of ffmpeg's pick of one audio track.
  - **HLS's `.ts` wrapper** already copies every stream.
  - **Not covered:** HLS Direct v2 and remux copy the source, so the UI disables the field there.
- **Verified end to end** (stream-repro, jellyfin-ffmpeg 8.1.3, new `--channel-setting` option), with a 20 s flex gap
  and three clips (English stereo; English 5.1 at 44.1 kHz with subtitles; English + Japanese), layout `eng, jpn`:

  | Mode    | Result                                      |
  | ------- | ------------------------------------------- |
  | HLS     | 35/35 segments `[eng 2ch 48k, jpn 2ch 48k]` |
  | HLS alt | 33/33 segments, the same                    |
  | MPEG-TS | the whole capture has both tracks           |

  - **What Plex reads:** the channel's HDHomeRun `.ts` carried video + eng + jpn.
  - **English + Spanish layout:** 19/19 segments `[eng, spa]`.
  - **Without the setting:** one track, as before.

- **Tests:**
  - `AudioTrackLayout.test.ts`: slot rules, commentary, B/T codes, selected/default.
  - `FfmpegStreamFactory.test.ts`: programs, a missing language, order, no audio, gap music, offline/error
    placeholders, both concats, no layout.
  - `BasePipelineBuilder.test.ts`: chains, maps, tags, `-ac`, the concat's `-map 0`.
  - `ChannelDB.test.ts`: save, read, update without the field, clear, validation.
  - The web parser.
- **Upstream:** not sent.

### Tunarr no longer sits for minutes at startup on a cold disk (2026-10-16)

- **What you saw:** a release's first start hung after the `/dev/dri` log line: 7 minutes at 03:09 UTC (rolled back by
  hand), and 259 s at 11:13 UTC. Nothing else was logged, then a 60 s Plex timeout and "Still waiting for guide to
  generate" arrived together. Other starts of the same images took 4 to 13 s.
- **Cause**, reproduced on the deployment with a copy of its database:
  - The main thread's connection keeps pages in its own cache and doesn't map the file (the hourly-stall fix below).
    A new process starts with that cache empty.
  - On the shared server, the operating system's file cache drops the database within the hour.
  - So every page the startup queries read is a separate wait on a busy disk, and better-sqlite3 blocks the main
    thread for each one.
  - Sampled once a second during a cold start, the main thread sat in `pread64` on the database, in state `D`, using
    no CPU. It was the same picture as the 03:09 hang: a finished `vainfo` that nobody reaped, because the event loop
    never ran.
  - **Cold copy:** ready in 35 s. **The same copy read through once with `cat` (0.8 s) first:** ready in 6 s. The
    disk was quiet during the test; under the 11:13 load the same reads took 259 s.
- **Fix:** before the main thread opens the database, `bootstrapTunarr` reads `db.db` and `db.db-wal` once, front to
  back, in 1 MiB chunks (`db/readIntoFileCache.ts`). The kernel's readahead turns that into a streaming read.
  - It's capped at 512 MiB and skips missing files. A failure only means a slower start; it never stops one.
  - It logs `Read the database into the file cache: <MB> in <ms>`.
  - Workers and new installs skip it.
- **Tests:**
  - `readIntoFileCache.test.ts`: whole files across chunks, a missing WAL, the byte cap across files, and a directory
    in place of a file.
  - `bootstrap.test.ts`: an existing database and its WAL are read before `DBAccess.init`; a new install reads
    nothing. The first fails without the bootstrap change.
- **Upstream:** not sent.

### Local libraries find the subtitle files next to their videos (2026-10-16)

- **What you saw:** nothing; found while reading the subtitle code. A local library never picked up `Movie.en.srt`
  next to `Movie.mkv`, although the docs say it does. Libraries from Plex, Jellyfin and Emby aren't affected.
- **Cause:** `LocalSubtitlesService.findExternalSubtitles` handed `parseSubtitleFilePath` the subtitle's name without
  its extension or folder (`Movie.en`), so the extension check saw `.en` and dropped every file. Three smaller faults
  sat behind it:
  - the video's name was stripped of an extension twice, so `Movie.2010` became `Movie`;
  - `Episode 1` matched `Episode 10.en.srt`, and `Movie` matched `Movie.part2.en.srt`;
  - `Movie.srt` was read as the language `srt`.
- **Fix:** `server/src/services/local/LocalSubtitlesService.ts`:

  - it passes both full paths;
  - a file must start with the video's name and a dot, and not with a longer video name in the same folder;
  - the language is the first part that is a language code, or looks like one and isn't an option (a private
    code such as `qaa`). `Movie.hi.srt` is Hindi; `Movie.en.hi.srt` and `Movie.qaa.hi.srt` are for the hard of
    hearing. Failing that it's the first part that isn't `hi`, `cc`, `sdh` or `forced`, and `unknown` when there is
    none;
  - extensions match in any case.

  The ffmpeg docs list the naming rules. Folders that haven't changed since their last scan need one **Force Scan**.

- **Tests:** `LocalSubtitlesService.test.ts`:
  - real files in a temporary folder: full paths, other files ignored, a dot in the video's name, a neighbouring
    episode's subtitles, a longer video name;
  - no language, flags first, `hi` as Hindi or as hard of hearing (also after a private code), upper-case
    extensions.
- **Upstream:** not sent.

### Captions follow subtitle placement, and overlapping subtitles show together (2026-10-16)

- **What you saw:** captions went only at the top (an inline `{\an7-9}`) or the bottom. ASS styles, exact positions, the middle and the sides were ignored, and vector drawings came out as text. When two subtitles overlapped, the later replaced the earlier, which never came back.
- **Why it mattered, in this library:** the extracted ASS files style 4,336 lines at the top and about 1,100 at a side, and position 43,786 with `\pos` or `\move`; 1,448 lines are drawings. About 1,400 SRT files have 20,339 overlapping pairs, nearly all two bottom lines.
- **Placement** (`Cea608Encoder.ts`, `ProgramCaptions.ts`): a caption is now a list of blocks, each placed in a third of the screen: top, middle or bottom, and left, centered (by the alignment setting) or right. A cue's place comes from, in order:

  1. an ASS `\pos` or `\move` start point, against the script's PlayResX/PlayResY (filled in as libass does);
  2. its alignment override (numpad `\an`, or SSA's `\a`);
  3. its ASS style's alignment (`[V4+ Styles]`, or `[V4 Styles]` in SSA numbering, each by its own Format line);
  4. the bottom.

  The middle sits between the top and bottom rows; right-aligned lines end at column 32. Drawing text is left out, and a layered copy of a line (the same text at the same times) is kept once. Files that only use `{\an8}`, as all of the library's SRT do, show as before.

- **Overlaps** (`resolveOverlaps`, setting `overlappingCues`):

  - **together** (default): while subtitles overlap by more than 500 ms they share one block, older above newer, the newest 4 lines kept. Stretches under a second fold into a neighbour so each caption has time to load. When their places differ, the block goes at the bottom, because FFmpeg-family decoders position only a caption's first row.
  - **apart:** each band keeps its own block, for players that position every row.
  - **newest:** the later replaces the earlier, which comes back when it still has at least a second and the next caption can load.

  Paint-on and roll-up are unchanged, and input without overlaps is returned as is (the golden snapshot is unchanged).

- **Test pattern:** samples 35 (middle), 36 (right-aligned), 37 (two lines stacked) and 38 (a top sign and a bottom line as two blocks: the check for `apart` in Plex). FFmpeg writes a position for each block, but libass honours only the first in an event, so in FFmpeg's own rendering sample 38 shows both at the top.
- **Tests:** `Cea608Encoder.test.ts` (middle, sides, legacy SSA, drawings, ASS precedence, stacking, the 4-line cap, apart, newest and its comeback rule, paint-on unchanged; the overlap tests fail with the resolver off), `ProgramCaptions.test.ts` (styles in any column order, SSA numbering, unknown and `*` style names, PlayRes fallbacks, layered lines), `CaptionTestPattern.test.ts`, and through jellyfin-ffmpeg 8.1.3 (`CaptionInsertion.local.test.ts`: middle and right positions, stacked rows, the two-block caption's positions).
- **Upstream:** not sent.

### Closed caption appearance settings, and a test pattern (2026-10-15)

- **What you wanted:** every presentation feature CEA-608 closed captions have, as settings, to find out which ones Plex Live TV shows. Plex draws captions itself, with a decoder of FFmpeg's family, so what it honours can only be found by trying.
- **Settings** (Settings > FFmpeg > Caption appearance (experimental), `hdhrCaptionAppearance`, and `hdhrCaptionTestPattern`):

  - text color; the box behind the text (the player's own by default) and its opacity;
  - pop-on, roll-up with 2, 3 or 4 rows, or paint-on;
  - lines per caption (2–4), line width (20–32 columns), bottom and top rows;
  - all capitals; keeping the subtitle file's italics and underline, and its top placement.

  The defaults send what Tunarr always sent. `Cea608Encoder.golden.test.ts` pins those bytes for a varied cue set, each alignment, three frame rates and a program end; the snapshot was recorded before any encoder change and never updated.

- **Encoder** (`server/src/stream/captions/Cea608Encoder.ts`): `buildCaptionSchedule` takes an appearance (the settings, the alignment, and flash for the test pattern), and a cue can carry its own.
  - **Color:** a mid-row color code at the start of each line. 608's italics are white, so an italic run loses the color and the code ending it restores it.
  - **Box:** a space, then the background code (semi-transparent with the low bit, or transparent `0x17 0x2d`), at the start of each line. One column each, counted in the width.
  - **Rows, lines, width, capitals:** bottom captions end on the bottom row and top ones start on the top row, always on screen. Capitals and the style and placement switches apply before the width is measured.
  - **Paint-on:** Resume Direct Captioning before the cue, Erase Displayed Memory on its start frame, then the text as it arrives.
  - **Roll-up:** erase and the roll-up command when the mode starts, then each line as a carriage return, a preamble on the base row, and its text, from the cue's start frame. A cue's lines stay together, aligned as a block, and the last lines stay up for up to 2 s for the next cue to scroll.
  - **Mixed modes:** a caption only replaces one in its own mode without a clear, the next caption's pairs never start before the last one's end, and a carriage return is never sent while a pop-on caption loads (FFmpeg's decoder would take it as a roll-up).
  - **Notice:** "No captions for this program" waits for a longer load when the appearance makes one (`captionLoadFrames`), never earlier than before.
- **Test pattern** (`CaptionTestPattern.ts`): 34 numbered samples that loop for the program's length, one per feature, each saying what it should look like and carrying its whole appearance, so the settings don't change it. It replaces the captions of every program that would get some. Docs list the samples.
- **Checked with jellyfin-ffmpeg 8.1.3** (`CaptionInsertion.local.test.ts`): FFmpeg's decoder shows the text and box colors (`\c`, `\3c`), rolls lines up keeping the chosen rows, and times paint-on and roll-up from the start frame. It ignores flash, see-through and transparent boxes, so those are the ones most likely to do nothing in Plex.
- **Tests:**
  - `Cea608Encoder.test.ts`: each option through a new frame-by-frame test decoder (`testing/captions/Cea608TestDecoder.ts`); paint-on, roll-up and mode changes; the notice loading in full under heavy appearances.
  - `CaptionTestPattern.test.ts`: numbering, whole appearances, timing and looping; every sample shows, in order, whatever the settings.
  - `HlsSession.test.ts` (the settings reach each program's captions), `FfmpegStreamFactory.test.ts` (the pattern replaces captions and the notice; the notice waits for a longer load), `ProgramCaptions.test.ts`.
  - The web settings page passes the e2e sweep, and with captions on its controls save.
- **Known limits:** italic words are white whatever the text color. A box or color makes each caption take longer to send, so fast dialogue can show captions a little late. Roll-up and paint-on send a caption's text while it is up, at two characters a frame; what doesn't fit before its end is cut off, so it never outlasts its subtitle or holds up the next one. What Plex does with each option is untested until the test pattern is watched on an Apple TV; a preview and "works in Plex" labels come after that.
- **Upstream:** not sent.

### A session's first program shows its captions on time (2026-10-15)

- **What you saw:** on the first program after tuning in, closed captions came one to two frames early, and a cue
  already under way at tune-in never showed. Later programs were on time.
- **Cause:** a session's first program was encoded with no `-output_ts_offset`. libx264's B-frames make its first
  decoding timestamps negative, so the MPEG-TS muxer shifted the whole program later to keep them positive. Its first
  frame came out at PTS 6000, two frames at 30 fps, while its captions were laid out from 0.
  - Every caption landed two frames before the frame its schedule meant.
  - The first two frame slots were never sent. They held the start of the load for a cue already under way.
  - Later programs start at a positive offset, so nothing is shifted.
  - By the same arithmetic, the WebVTT subtitles in Tunarr's own players were two frames early on the first program
    too (not measured).
- **Fix:**
  - **Session start** (`SessionStartPts`, `server/src/stream/hls/HlsSession.ts`): a session's output clock starts at
    1 s (90,000 at 90 kHz), so the first program is muxed at an exact offset like every later one. hls_direct_v2 keeps
    0, since it copies the source's timestamps. The fallbacks for an unreadable last segment start there too.
  - **Seek** (`firstFrameMs`, `ProgramCaptions.ts`): cues on a tuned-in program are timed from the first frame at or
    after the seek, the frame ffmpeg starts the stream with. Timing them from the seek itself put them up to a frame
    late. This assumes the source's frames sit on its frame rate's grid, as constant-rate video does.
  - **Late captions** (`buildCaptionSchedule`, `Cea608Encoder.ts`): a caption that can't be loaded before it ends is
    left out, instead of flashing for one frame. The caption it would have replaced is cleared at its own end. A cue
    nearly over at tune-in is the usual case, and its load also held up the next caption by a few frames.
  - **Offline and error streams** (`createPlaceholderSession`): they now pass `isFirstTranscode`, as program streams
    do. Without it the pipeline guessed a first transcode from an offset of 0, so a session that began on an offline
    gap would have opened its HLS output with a discontinuity (`discont_start`, `+initial_discontinuity`).
- **Checked** on a stream-repro test server: three 40 s clips with a subtitle cue every 2 s, captions on,
  jellyfin-ffmpeg 8.1.3. The captioned HLS segments were read for 50 s and decoded with ffmpeg's 608 decoder. Each
  caption's frame was compared with its cue on absolute timestamps.

  |                                              | Before                       | After                            |
  | -------------------------------------------- | ---------------------------- | -------------------------------- |
  | First program's first frame                  | PTS 6000                     | PTS 90,000, exactly the offset   |
  | First program's captions against their cues  | 1 to 2 frames early, by seek | on the frame                     |
  | A cue under way at tune-in, about 0.9 s left | not shown                    | shown once loaded, until its end |
  | A cue 2 ms from its end at tune-in           | not shown                    | left out, the next one on time   |
  | Later programs                               | on the frame                 | on the frame                     |

  - **Offline start:** a session that began on a 12 s offline gap started at offset 1 s with no discontinuity flags.
    The programs after it had them as before, and the capture had no findings.
  - **Tune-in:** the `.ts` stream's first byte came 3.4–4.3 s after the request, against 3.3–4.6 s before, at the same
    data rate. Its reader paces from its input's first timestamp, so starting at 1 s adds no wait.

- **Tests:**
  - `HlsSession.test.ts`: the first program starts at `SessionStartPts`, its captions land on their frames, and
    hls_direct_v2 stays at 0. Two fail without the fix.
  - `Cea608Encoder.test.ts`: a cue under way that can't load in time is left out and the next one shows on its frame;
    a caption whose replacement is left out is cleared at its end. Both fail without the fix.
  - `ProgramCaptions.test.ts`: `firstFrameMs`, and cues timed from the first frame (fails without the fix).
  - `SessionStartPts.local.test.ts` (with ffmpeg): at 0 the first frame comes whole frames late, and at
    `SessionStartPts` exactly there.
  - `FfmpegStreamFactory.test.ts`: offline and error placeholders hand `isFirstTranscode` and the offset to the
    pipeline. Both fail without the change.
- **Upstream:** not sent.

### Custom show syncs run in a scan worker (2026-10-15)

- **What you saw:** nothing reported. It was the last sync work on the main thread.
- **Cause:** `CustomShowSyncService` ran on the main thread, which serves streams. It ran from the hourly `SyncCustomShowsTask` and from the create and Sync Now routes.
  - A 1,000-movie playlist kept that thread busy for 7 s on the first sync and 2.8 s on each hourly resync.
  - The lookup that ends every sync (`lookupByExternalIds`, which loads each program with all its relations) stalled requests for 163–186 ms, and 870 ms at 3,000 movies.
- **Fix:** the sync is a scan job, `{kind: 'custom-show', customShowId}` (`types/worker_schemas.ts`). `MediaSourceScanCoordinator.syncCustomShow` runs it like a library scan: in a scan worker when there is one, one job at a time, in-process with `TUNARR_SCAN_IN_WORKER=false`.
  - **The job:** `ScanJobExecutor` hands it to `CustomShowSyncService.syncShow`, which skips a show that's gone or unlinked, and on a cancel stops before the next item without writing a partial list.
  - **Routes:** create and Sync Now wait for the sync and answer with the synced show. If the sync fails, Sync Now
    answers 500, while create still creates the show and answers 201 with it unsynced (as before). Both go ahead of
    waiting scans, even when Sync Now joins a sync the hourly task queued, but wait for a running one.
  - **Joining and locks:** a second request for a show joins the first. Each show has its own lock, which `isSyncing` reads.
  - **No reconcile:** a sync doesn't reconcile channel durations.
  - **The task:** `SyncCustomShowsTask` queues every linked show and ends when they've run.
  - **Sync Now 500:** Sync Now always answered 500, because its response left out `isSyncing`. Fixed in its own commit.
  - **Probe harness:** `measureWithConcurrentProbe` missed a stall at the very end of an operation. Fixed in its own commit.
- **Numbers:** `pnpm bench:custom-show-sync`, 1,000 movies, median of 2 trials, main-thread CPU and worst stall:
  - first sync: 7.4 s and 176 ms in-process, against nothing measurable and 9 ms in a worker;
  - resync: 2.3 s and 165 ms in-process, against nothing measurable and 19 ms in a worker;
  - 3,000 movies, first sync: 26 s and 875 ms in-process, against nothing measurable and 10 ms in a worker.
- **Tests:**
  - `ScanJobExecutor.test.ts`, `MediaSourceScanCoordinator.test.ts`, `ScanWorkerRoundTrip.test.ts` and `CustomShowSyncService.test.ts`;
  - new `SyncCustomShowsTask.test.ts`, `tests/customShowSync.test.ts` (API against a stand-in Plex server) and `tests/support/probe.test.ts`;
  - new perf test `tests/perf/customShowSyncLag.test.ts`.
- **Upstream:** not sent.

### Live TV playlist requests no longer slow down the longer a channel is watched (2026-10-15)

- **What you saw:** after PR #11, a Live TV playlist request still re-read and re-parsed the session's whole `stream.m3u8`. The cost grew with the session: ~6 ms at 3 hours and ~25 ms at 11 hours on a laptop, about 6 times that on the server, on the main thread every few seconds per viewer.
- **Cause:** ffmpeg never trims the playlist (`hls_list_size 0`, `append_list`), and `HlsSession.trimPlaylist` parsed all of it on every request to keep 20 segments.
- **Fix:**
  - `MediaPlaylistReader` parses only the bytes ffmpeg appended since the last request. It checks the first and last 256 parsed bytes, and parses the whole file again when the file shrank or changed. ffmpeg rewrites old entries byte for byte; only its header changes.
  - `MediaPlaylistIndex` keeps per-segment discontinuity counts, so `HlsPlaylistMutator.trimIndex` builds the playlist from the segments it holds.
  - `HlsSession` drops segments below the pruning floor, which bounds memory too.
  - Served playlists are unchanged.
- **Numbers:** per request at 5,265 / 20,000 / 43,200 segments: 6.0 / 23.6 / 51.3 ms before, 0.13 / 0.15 / 0.16 ms after (MacBook, median of 31).
- **Tests:**
  - `HlsSession.test.ts`: a request on a 20,000-segment session reads under 8 KiB (2.8 MB on `main`, which fails).
  - `MediaPlaylistReader.test.ts`: scenario tests plus randomized tests against main's trim (kept as `src/testing/hls/ReferenceHlsPlaylistTrim.ts`).
  - `HlsPlaylistMutator.test.ts`: 1,000 random playlists against main's trim.
  - stream-repro shadow check: every real request matched main's trim.
- **Upstream:** not sent.

### Smart collection filters with `genres.name` (2026-10-15)

- **What you saw:** Six smart collections logged "has unparseable filter … Results will be wrong" whenever smart collections were listed, and the startup fixer logged "has keywords set but an unparseable filter". Their filters (`genres.name in [...]` with `title in`/`title not in`, joined by AND/OR) were ignored, and a copy of each filter in `keywords` ran as a full-text search.
- **Cause:** The query language calls the field `genre`, and `genres.name` is its search index path. The API stored the filter tree with the field name the client gave, so it wrote a string its own parser rejects at the `.`. The startup fixer then copied each filter into `keywords` and tried to clear the filter. The clear never happened, because `update` skips an undefined filter, so the warning repeated on every start.
- **Fix:** The parser accepts a string field's index path as another name for the field. `searchFilterToString` writes field names the parser knows, writes `added_date` as a date, and adds parentheses where a nested AND/OR group would otherwise be read back differently. The fixer writes columns directly, so `null` clears them. It moves a filter into keywords only for rows saved before the keywords column (NULL keywords). Any other filter stays a filter. When the filter parses, it clears keywords that exactly equal the filter, which is what the old fixer copied. One collection whose keywords are an older copy of a since-edited filter keeps them until the client re-saves it with `keywords: ""`.
- **Tests:** `shared/src/util/searchUtil.test.ts` ("saved filter strings"), `server/src/db/SmartCollectionsDB.test.ts`, `server/src/tasks/fixers/FixSmartCollectionFilters.test.ts`.
- **Upstream:** not sent.

- **Known limit:** a collection saved before the keywords column (keywords NULL) whose free-text query starts with an index path such as `genres.name:` now parses as a filter instead of a text search. This fork's deployment has no NULL-keyword collections (checked 2026-10-15). Sending this upstream would need the fixer to move such NULL-keyword filters into keywords.

### Tunarr keeps its database in its own memory, so it stops stalling on the hour (2026-10-15)

- **What you saw:** Live TV paused briefly at the top of the hour. A latency probe saw stalls at :00 every hour,
  from 0.4 s to 5.9 s; the worst was at 07:00 UTC.
- **Cause**, measured on the deployment, a shared server:
  - At 19:00 UTC the main thread spent 4.5 s in uninterruptible disk wait (state `D`, not in a system call, so on
    page faults). It used no CPU, while the server's disk pressure rose from 26% to 42%.
  - The main connection memory-mapped the database (`mmap_size` 256 MiB, a 140 MB database). Mapped pages live in
    the operating system's file cache, which the other users' processes share.
  - At 19:02, just after an hourly run, 96% of the database file was cached. By 19:58 it was 2%.
  - Tunarr's hourly tasks start at :00, the same second as the other users' hourly jobs, so their reads waited on
    the busiest disk of the hour.
  - Reading the file once at 19:59:30 (back to 100%) cut the 20:00 disk wait to about 0.15 s.
- **Fix** (`db/DBAccess.ts`, `connectionPragmas`):
  - The main thread's connection doesn't map the file (`mmap_size = 0`) and keeps up to 256 MiB of pages in its own
    page cache (`cache_size = -262144`), room for the whole database. Process memory isn't evicted for other
    processes, and the box has no swap.
  - Another connection's write (a scan worker, say) empties that cache, so it refills after scans.
  - Workers keep the previous settings: a worker waiting on the disk blocks nothing else.
- **Numbers:** the perf tests got no slower (guide rebuild worst probe 7.8 ms, slot save 15 ms, library request
  21 ms). The deployment's hourly stall will be re-measured after the release. Memory: up to about 150 MB more for
  Tunarr's main process on this database.
- **Tests:** `DBAccess.test.ts` ("connection settings"): the main thread's connection reports `mmap_size` 0 and
  `cache_size` -262144, with WAL and foreign keys still on, and workers keep the old values. Both tests fail before
  the change.

### A long Live TV session no longer stalls Tunarr every few seconds (2026-10-15)

- **What you saw:** about two hours into watching a channel, every request to Tunarr stalled for 270-380 ms about
  every 4 seconds (seen with a latency probe and `curl`). The main thread was running JavaScript the whole time.
- **Cause:**
  - Each program's ffmpeg appends to the session's `stream.m3u8`, which is never trimmed on disk. After about 3 hours
    it held 5,265 segments in 15,743 lines, while only the last 39 segment files still existed.
  - Every playlist request (`HlsSession.trimPlaylist`) re-reads the whole file and `HlsPlaylistMutator` parses all of
    it, to keep about 20 segments.
  - The parse did one `dayjs` addition per segment.
  - Writing out the playlist compared every item against each kept segment with `equals`, which uses `dayjs`'s
    `isSame` and builds new date objects on each call. That's about 100,000 date comparisons per request.
- **Fix** (`stream/hls/HlsPlaylistMutator.ts`):
  - **Membership:** the kept segments are the parsed objects themselves, so the output loop and `findIndex` use a
    `Set` and `indexOf` (identity).
  - **Parsing:** the parse adds durations as milliseconds, truncating at each step as a `Date` does, so the times are
    the same. A segment's `startTime` (a `Dayjs`) is only built when read: for the ~20 kept segments.
  - **`equals`:** compares the millisecond start.
- **Numbers:** on the real 5,265-segment playlist, `trimPlaylist` went from 58 ms to 6 ms (MacBook), with
  byte-identical output. On the server that's about 330 ms → about 35 ms per request. The cost still grows with the
  session, ten times more slowly. Rewriting the playlist on disk periodically (the TODO in `parsePlaylist`) would
  bound it.
- **Tests:** `HlsPlaylistMutator.test.ts` ("a long session"):
  - trimming a 3,000-segment playlist calls `isSame` never and `add` at most once per kept segment (fails before);
  - the kept segments' program date-times equal the old chained `add` results, millisecond truncation included.
- **Upstream:** not sent.

### The library programs request no longer freezes Tunarr (2026-10-15)

- **What you saw:** Live TV paused while a script ran against Tunarr (`build_grid.py`, even with `--dry-run`). A latency
  probe saw two freezes, of 17,061 ms and 17,158 ms, one per run.
- **Cause:** `GET /api/media-libraries/:libraryId/programs` built its whole response in one go on the main thread,
  which also serves the streams:

  - one Drizzle query with the full relation set, so every episode carries its show's and season's cast, artwork and
    genres;
  - then the conversion, the Zod encoding and `JSON.stringify` of the whole array.

  better-sqlite3 is synchronous, so none of it let another request in. The TV library has 5,393 episodes.

- **Fix:** the body is built a page at a time (`pagedJsonArray` and `libraryProgramsJson` in
  `api/libraryProgramsJson.ts`).
  - **Yielding:** it yields between pages, and between each page's read, conversion and encoding.
  - **Page size:** it follows how long a read blocks, aiming for about 30 ms with 10 to 100 rows per page, so a slow
    or busy server takes smaller pages.
  - **Query:** the page query is prepared once and walks the uuid index
    (`ProgramSearchRepository.getMediaSourceLibraryProgramsPage`). Building and compiling its nested query for every
    page had cost about as much as reading the page.
  - **Response:** each page is encoded with the route's own schema, so the items and fields are the same as before.
    Items now come in uuid order.
  - **Streaming:** each page's JSON goes to the client as soon as it is built (`sendJsonChunks`), with
    `Transfer-Encoding: chunked` and no `Content-Length`. At first the pages were joined and sent at the end. On
    production that made one 185 MB string, and joining and sending it froze Tunarr once more, for 0.93 s, at the end
    of the 20 s request.
    - A slow client holds the next page back, so Tunarr holds about one page instead of the whole body.
    - A failure in the first page is still an error response. After that the status is already sent, so Tunarr
      closes the connection: the client sees a broken download, never a shorter list.
    - A client that disconnects stops the page reads.
- **Numbers** (perf test, MacBook):

  | Episodes | Worst stall of a concurrent request | The request itself |
  | -------- | ----------------------------------- | ------------------ |
  | 1,500    | 678 ms → 28 ms                      | 0.7 s → 1.3 s      |
  | 5,400    | 2.6 s → 39 ms                       | 2.6 s → 5.6 s      |

  On the production server the same request had frozen it for 17 s. Paged but joined at the end, it still froze it
  for 0.93 s.

  With a 185 MB body like production's (`TUNARR_PERF_CAST=160`) and the client in another process, 3 runs each,
  joined at the end → streamed: worst stall 74–76 ms → 49–59 ms, p99 about 23 ms either way, and peak memory during
  the request about 1.0 GB → 0.6 GB. The MacBook joins and sends 185 MB about 12 times faster than production did.

- **Tests:**
  - `api/libraryProgramsJson.test.ts`: paging across boundaries, an empty library, the yields, and page-size
    adaptation. Each page is its own chunk; a first-page failure comes before any chunk; a stalled client holds the
    pages back; a closed stream reads no more pages.
  - `tests/libraryProgramsResponse.test.ts`: the body matches the one-shot response for episodes and movies. Over a
    real connection: the body is chunked, a first-page failure is a 500, a later failure cuts the download off, and
    the first page arrives while the second is still held.
  - `tests/perf/libraryProgramsLag.test.ts`: worst concurrent request under 250 ms. It fails before the fix. Scale
    it with `TUNARR_PERF_SHOWS` / `_SEASONS` / `_EPISODES` / `_CAST`. It fetches with `curl`, so the client's reading
    isn't counted against the server's event loop.
- **Upstream:** not sent.

### Uploaded images are saved with the public address, not `http://` (2026-10-15)

- **What you saw:** images uploaded in the web UI behind the HTTPS proxy were saved as
  `http://<public host>/images/uploads/…`, so channel offline pictures pointed at plain http while the rest used https.
- **Cause:** `POST /api/upload/image` built the address it returns from the request, `${req.protocol}://${req.host}`.
  A proxy that terminates HTTPS forwards plain http, and Tunarr trusts no proxy headers by default, so the request
  said `http`. An upload through an SSH tunnel got `http://localhost:…`, which no app can load.
- **Fix:** an upload answers with the configured public address (Settings → XMLTV, the one the guide's pictures use)
  when there is one, and with the request's address otherwise (`uploadedImageUrl` and the new `publicLinkOrigin`,
  `util/iconUtil.ts`; `api/index.ts`). The guide's `xmlTvLinkHost` uses the same rule through `publicLinkOrigin`.
  - **Existing uploads:** they keep the address they were saved with until uploaded again.
  - **Docs:** `docs/configure/clients/plex.md`.
- **Tests:** `iconUtil.test.ts`: behind an HTTPS proxy and through `localhost` an upload gets the public address, and
  without one it gets the request's address. They fail without the fix.
- **Upstream:** not sent.

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
      image), or after 7 days, with at most 20 such refreshes per write. A refresh that fails waits another week, so
      it can't take the quota from the rest.
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
    - a change after changing back gets a version above every earlier one, so no retired file is overwritten;
    - a new format keeps the old one at its old URL;
    - a replaced version is kept 30 days, then deleted;
    - the weekly refresh, and refreshes that keep failing wait a week so the rest get their turn;
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
- **Known limit, fixed since:** the same two-frame delay made a session's first program show its own captions two
  frames early, and a cue already under way at tune-in could be lost on it. See "A session's first program shows its
  captions on time".
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

- **What you saw:** a movie got no captions although Bazarr had added an `.srt` the day before (Plex listed the
  sidecar, Tunarr still knew only the embedded PGS track after the nightly scan).
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
