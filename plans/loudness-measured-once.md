# Loudness measured once, applied as a fixed gain

## Context

The transcode config's audio loudness normalization levels every program with ffmpeg's `loudnorm` (for example
`I=-24:LRA=7:TP=-2`), and gap music is levelled to its own target (`I=-24:LRA=11:TP=-2`). Owners turn it on because
music, shows and films arrive at very different loudness, and it has to stay: programs, music and gaps must keep coming
out at a consistent level.

In its default (dynamic) mode, loudnorm keeps about 3 s of audio before it emits any. The first segments of every
tune-in wait for it. A 2026-10-17 measurement on a shared CPU put that at **0.6–0.9 s on every cold tune**: segment 3 of
an HEVC program came at 3.75 s with loudnorm and 3.14 s without.

## Goal

The same target loudness for programs and gap music, without the look-ahead on programs and tracks whose loudness is
already known.

## Design

### Measure once, store the result

- **A new table, `program_audio_loudness`:** one row per program audio stream.
  - Stored for each row: integrated loudness (LUFS), true peak (dBTP), loudness range (LU), and when it was measured.
  - A failed measurement keeps the error instead, and is retried after a day.
- **The key is the file, not the stream row.** A rescan deletes and re-inserts a program's versions and media streams
  (`ProgramUpsertRepository`), so a column on `program_media_stream` would be wiped by every forced scan. Each row
  records the path and size of the file it measured, and a play uses it only when both still match. A replaced file
  (an upgrade, a repack) is measured again.

### Play with a fixed gain

- **Where:** `ProgramStreamDetailsFetcher` attaches a stream's measurement to its `AudioStreamDetails` when the file
  matches.
- **When:** `FfmpegStreamFactory` swaps live loudnorm for a fixed gain only when every audio stream the transcode plays
  has a measurement. With a channel audio-track layout (switchable audio), that is every slot's source stream.
  Otherwise nothing changes: live loudnorm levels the program as before.
- **The gain:** `target I − measured I` (plus loudnorm's `offset`), clamped to −30…+20 dB. A silent stream (≤ −70 LUFS,
  EBU R128's absolute gate) gets none.
- **A limiter, only where needed:** when `measured TP + gain` would pass the target true peak, an `alimiter` at the
  target ceiling follows the gain. It looks ahead 5 ms, compensated so audio stays in sync.
- **The filter:** `volume=<gain>dB[,alimiter=…]` sits where loudnorm sat (after `aresample`/`apad`, before the fades). It
  needs no look-ahead buffer and no 192 kHz resample.
- **One chain per audio track:** the pipeline already builds one filter chain per track. A new per-stream filter hook
  (`HasStreamFilterOption`) lets each chain carry its own stream's gain.

### What changes for the listener

- **Integrated loudness:** the same. Every program and track lands on the target (measured below).
- **Loudness range:** live loudnorm with `LRA=7` also compresses the dynamics inside a program, lifting quiet dialogue
  and taming loud scenes. A fixed gain doesn't.
  - Most episodes and music already sit near or under 7 LU, so for them this changes little.
  - Films can run well over that, so a program whose measured range is far above the target's keeps live loudnorm
    (see "Loudness range" below, with the numbers).

### Measuring, without a mass scan

- **A scheduled task, `MeasureLoudnessTask`, every 15 minutes:**
  - programs airing in the next 3 hours on channels whose transcode config normalizes loudness;
  - a few unmeasured tracks from each channel's gap-music list.
- **It never scans the whole library.** Only what is about to air is measured, and each file once, so the load falls as
  schedules repeat.
- **It is gentle on a shared server:** one ffmpeg at a time, `nice 19`, one thread, audio only, and a per-run budget.
- **One pass per file:** every audio stream of a file is measured in the same pass, with one `loudnorm` analysis per
  stream (`print_format=json`), so the file is read once.
- **Full or sampled:** see "Measurement cost" below.

## Measurements

### Measurement cost and accuracy (real library files, shared server)

To be filled from the box run: full against sampled measurement of episodes, films, music tracks and a commercial.

### Loudness range

To be filled: measured LRA by kind of content, which sets the cut-off for keeping live loudnorm.

### Consistency under both paths

To be filled: sources at very different loudness, through live loudnorm and through the fixed gain, measured at the
output.

## Not done

- **No measurement on first play:** a play with live loudnorm doesn't record the program's loudness. Its own
  measurement covers only the part it played, and it would need ffmpeg's info-level log for every stream.
- **Remote-only sources:** programs played over HTTP from a media server with no local path are not measured, so live
  loudnorm keeps levelling them.
