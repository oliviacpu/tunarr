# Loudness measured once, applied as a fixed gain (not done)

**Decision (2026-10-17): not implemented.** A fixed gain from a stored measurement could stand in for live loudnorm
only where it saves no time. Where it would save time, it changes how programs sound and is costly to measure. The
prototype is on the branch `prototype/loudness-fixed-gain`. The measurements below are why.

## Context

The transcode config's audio loudness normalization levels every program with ffmpeg's `loudnorm`, for example
`I=-24:LRA=7:TP=-2`. Gap music is levelled to its own target, `I=-24:LRA=11:TP=-2`. Owners turn it on because music,
shows and films arrive at very different loudness, and it must stay: programs, music and gaps keep coming out at a
consistent level.

A tune-in measurement (2026-10-17, a shared server, 5.1 AC3 output) put loudnorm's cost at 0.6–0.9 s before the first
segments. Segment 3 of an HEVC program came at 3.75 s with loudnorm and 3.14 s without.

## The idea

- **Measure once:** store each program audio stream's integrated loudness, true peak and loudness range, per file (path
  and size). The store is kept apart from `program_media_stream`, whose rows a rescan replaces.
- **Play with a fixed gain:** `volume=<target I − measured I>dB` replaces loudnorm, plus an `alimiter` at the target true
  peak when the gain would lift peaks past it.
- **Fall back:** anything not measured keeps live loudnorm.

The prototype does all of this.

- **Per-track gains:** each audio track's filter chain carries its own gain, which a channel audio-track layout needs.
- **A measurement task:** it measures what airs in the next 3 hours, one file at a time, at the lowest CPU priority.

## Measurements

### 1. A fixed gain levels as consistently as live loudnorm

Six synthetic two-minute sources, run through Tunarr's live chain
(`aresample=async=1,apad,loudnorm=I=-24:LRA=7:TP=-2,aresample=48000`) and through the measured fixed gain. Every
output was measured with loudnorm's analysis.

| Source                 | In: I / LRA / TP    | Live: I / LRA / TP      | Fixed gain     | Out: I / LRA / TP        |
| ---------------------- | ------------------- | ----------------------- | -------------- | ------------------------ |
| quiet speech           | −38.5 / 1.9 / −27.0 | −24.1 / 1.9 / −12.5     | +14.5 dB       | −24.0 / 1.9 / −12.5      |
| normal TV              | −24.5 / 1.9 / −12.7 | −24.1 / 1.9 / −12.2     | +0.5 dB        | −24.0 / 1.9 / −12.2      |
| very quiet             | −46.5 / 1.9 / −35.0 | −24.1 / 1.9 / −12.5     | +22.5 dB       | −24.0 / 1.9 / −12.5      |
| loud, music-like       | −6.0 / 0.2 / +1.2   | −24.1 / 0.2 / −16.9     | −18.1 dB       | −24.0 / 0.3 / −16.8      |
| quiet with sharp peaks | −30.0 / 0.3 / −4.5  | −27.0 / 0.7 / −2.0      | +6 dB, limited | −27.0 / 0.6 / −2.0       |
| dynamic film           | −16.6 / 26.4 / −4.3 | −24.2 / **17.7** / −5.8 | −7.4 dB        | −24.0 / **26.4** / −11.7 |

- **Integrated loudness:** both paths agree within 0.2 LU.
- **Where the true-peak ceiling binds** ("quiet with sharp peaks"), both land on −27.0 together.
- **Loudness range:** this is the one difference. Live loudnorm compresses a dynamic program toward the target's range;
  a fixed gain keeps all of it.

### 2. Real programs are far more dynamic than the target

Measured on library files on the shared server (loudnorm analysis of the first audio stream):

| File        | Length    | I (LUFS) | LRA (LU) | TP (dBTP) |
| ----------- | --------- | -------- | -------- | --------- |
| episode 1   | 43.6 min  | −19.7    | 13.5     | +3.1      |
| episode 2   | 24.6 min  | −23.2    | 12.6     | −8.8      |
| episode 3   | 45.6 min  | −27.8    | 18.5     | −4.2      |
| episode 4   | 21.9 min  | −20.9    | 14.3     | −1.6      |
| film 1      | 107.9 min | −29.8    | 15.7     | −7.6      |
| film 2      | 124.8 min | −16.6    | 21.1     | +2.4      |
| music track | 3.8 min   | −11.1    | 3.7      | +0.4      |
| commercial  | 1.0 min   | −17.8    | 3.0      | −8.9      |

- **Episodes and films** run 12.6–21.1 LU against a target of 7, so live loudnorm compresses every one of them hard. A
  fixed gain would leave them at full range, so dialogue would sit lower against loud scenes than it does today. That
  changes how levelling sounds, even though integrated levels still match.
- **Music and commercials** sit near or under the target, so for them the two paths sound the same.

### 3. Measuring long files on a shared server is too costly, and sampling isn't accurate

Measured at the lowest CPU priority on one thread, as a background task would run:

| File                  | Whole file | Sampled (12 windows of 20 s) | Sample error |
| --------------------- | ---------- | ---------------------------- | ------------ |
| episode 1 (43.6 min)  | 325 s      | 31 s                         | −1.8 LU      |
| episode 2 (24.6 min)  | 44 s       | 7 s                          | +0.4 LU      |
| episode 3 (45.6 min)  | 345 s      | 30 s                         | **−5.9 LU**  |
| episode 4 (21.9 min)  | 166 s      | 30 s                         | −0.2 LU      |
| film 1 (107.9 min)    | 388 s      | 8 s                          | −2.3 LU      |
| film 2 (124.8 min)    | 973 s      | 31 s                         | −0.9 LU      |
| music track (3.8 min) | 6.9 s      |                              |              |
| commercial (1.0 min)  | 1.8 s      |                              |              |

- **The cost:** measuring what airs on seven channels would keep about one core and the disk busy all day.
- **Sampling** misses by up to 6 LU, which breaks consistent levels.

### 4. Where a fixed gain sounds the same, it saves nothing

Tunarr's gap transcode was timed with stereo gap music, as the stream factory builds it: a looped card, a read-ahead
burst, x264 `veryfast`, 2 s HLS segments. It ran on the shared server at the lowest priority on one thread, 3 runs each,
medians:

| Gap music levelled by | Segments 1 / 2 / 3 written |
| --------------------- | -------------------------- |
| live loudnorm         | 1.37 / 2.40 / 3.47 s       |
| fixed gain            | 1.42 / 2.46 / 3.53 s       |

The read-ahead burst fills loudnorm's 3 s buffer at once, and on stereo its processing is cheap. The 0.6–0.9 s found
for programs comes from loudnorm processing every channel of 5.1 audio at 192 kHz while the video encoder competes for
the same CPU.

## Why not

- **Where a fixed gain would save time** (5.1 episodes and films):
  - it changes how they sound (measurement 2);
  - measuring them costs minutes of server time each, and sampling isn't accurate enough (measurement 3).
- **Where it sounds the same** (music, commercials, gap music), it saves nothing (measurement 4).
- **Either way, the cost is real:** a new table and migration, a background task and per-track filter chains.

## Alternatives considered

- **loudnorm's linear mode** with stored measurements reverts to dynamic mode whenever the source's range exceeds the
  target's, which is every episode and film above.
- **Downmixing before loudnorm** would cut its work by two-thirds when the output is stereo. Outputs configured for 5.1,
  like the one measured, can't use it.
  - **Worth doing** for stereo transcode configs: no stored state, and levelling is unchanged.
- **`dynaudnorm`** looks further ahead than loudnorm (about 7.75 s by default).
- **A fixed gain plus a compressor without look-ahead** (`acompressor`) could approximate the range compression. But it
  needs the same costly measurement, and its output level drifts with the material, so levels would no longer be
  guaranteed consistent.

## What would change this

- **Spare disk and CPU** make the measurement cost acceptable. Measuring at library scan time only moves it: each file
  is still read whole once, so a large library or a full rescan pays all of it at once.
- **A target range close to the content's** (an owner who sets LRA 15 or more) removes the difference in sound.

Either one makes the prototype worth finishing.
