# Switchable audio in Plex Live TV: a fixed audio track layout per channel

## Context

Plex Live TV's tuner reads a channel's MPEG-TS once at tune-in and keeps the audio tracks it finds there for the whole
session. It never adds tracks, and if Tunarr restarts the stream Plex ends the session. Tested on the deployment
(2026-10-14, box notes "Switchable audio in Plex Live TV"):

- **Switching works:** the Apple TV's audio menu lists and switches tracks when the stream carries several.
- **Plex picks the track by language:** it chooses each account's preferred audio language from the list, in Live TV
  too.
- **The problem:** Tunarr's transcode modes send one audio track, and the track a program has differs from program to
  program.

So a channel that should offer a menu has to send the same tracks, in the same order, with the same language tags, for
every program, every gap and every commercial.

User, 2026-10-16: "Build switchable audio." Agreed design: an ordered per-channel list of languages, with each program's
own track in each language, and the main track repeated where a program lacks one.

## Design

### Setting

- **Field:** `audioTracks` on the channel, an ordered list of up to 4 ISO 639-2 codes (`["eng", "jpn"]`).
- **Off:** empty or absent means off, and every command stays exactly as it is today.
- **Storage:** a nullable JSON column `audio_tracks` on `channel`, with a Drizzle migration.
- **API:**
  - Responses always carry an array (`[]` when off).
  - Saves validate strictly: lowercase three-letter codes, no repeats, at most 4.

### Which source track fills each slot (`pickSlotAudioStreams`)

The normal selection (stream selection profiles) still picks the program's main track. Then, for each slot language,
in order:

1. **The main track**, if it's in the slot's language.
2. **Otherwise the program's track in that language.** Among several, commentary tracks are skipped, then the choice
   goes selected → default → first, as the default selection does.
3. **Otherwise the main track again.** It's tagged with the slot's language anyway, so the list never changes.

Each output track is tagged with its slot's language.

### Every output of the channel carries the layout

| Output                                                                | Today                                | With the setting                     |
| --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Program / commercial transcode (HLS, HLS slower, MPEG-TS, HLS direct) | 1 audio track                        | N tracks, one per slot               |
| Offline/flex (picture + gap music, or silence/sine/noise)             | 1 track                              | the same source N times              |
| Error screen                                                          | 1 track                              | N times                              |
| HLS-slower concat (re-encodes the joined stream)                      | maps audio stream 1                  | maps streams 1..N, tagged            |
| MPEG-TS concat (copies the joined stream)                             | no `-map`, so ffmpeg keeps one audio | `-map 0`                             |
| HLS `.ts` wrapper (`hlsWrap`)                                         | `-map 0` already                     | unchanged                            |
| HLS Direct v2 / remux (copy all)                                      | copies the source's tracks           | unchanged; documented as not covered |

### Pipeline builder

- **`ComplexFilter`:** with one audio stream, the output is unchanged (`[a]`, one `-map`). With several, each stream
  gets its own chain and label (`[a0]`, `[a1]`, …, filters repeated per chain) and its own `-map`, in order. A source
  stream used twice is fine: ffmpeg feeds both chains from one decode.
- **Language tags:** per output track (`-metadata:s:a:<i> language=<code>`); the single-track tag stays as it is.
- **Channels:** with several tracks, `-ac` is set whenever any track's source differs from the target, so every track
  comes out with the configured channel count.
- **Encoding:** every track uses the channel's transcode config (codec, bitrate, channels, sample rate, loudnorm).
  CPU cost is one encode per track; decoding happens once per source stream.

## Tests

- `pickSlotAudioStreams`:
  - a program with both languages;
  - a program with only the main language;
  - commentary skipped;
  - B/T code matching (`ger`/`deu`);
  - a main track that already matches.
- `ComplexFilter` / `BasePipelineBuilder`:
  - two streams give two labelled chains and two maps;
  - per-track language tags;
  - `-ac` when the second track differs;
  - the single-stream args are unchanged.
- `FfmpegStreamFactory`:
  - a channel with `audioTracks` gets N streams with slot languages;
  - offline sessions with gap music and with silence get N;
  - error sessions get N;
  - the MPEG-TS concat maps all streams;
  - the HLS-slower concat maps 1..N;
  - a channel without the setting gives byte-identical args.
- Schema: validation (codes, repeats, max 4) and the channel round trip through the repository and converter.
- **End to end** (`.claude/skills/stream-repro`, with a new `--channel-setting` option): `--layout multi-audio` and
  `mixed`, and `--flex-first`. Every captured segment must have the same audio stream count, order and language tags
  across program boundaries and the flex gap.

## Not in this change

- **HLS Direct v2 and remux:** they copy the source and can't add or reorder tracks.
- **The HLS master playlist:** keeps no audio renditions. The tracks are muxed into the TS, which is what Plex reads.
- **A UI language picker:** a plain ordered code list keeps the change small.
