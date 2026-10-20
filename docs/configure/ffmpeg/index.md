# FFmpeg

Tunarr requires FFmpeg for transcoding / remuxing content when outputting channel streams. Settings relating to transcoding and FFmpeg can be found on the Settings > FFmpeg page.

## Executable Paths

!!! info
    Only non-Docker installs must provide FFmpeg executable paths. Docker installs come with a bundled version of FFmpeg.

Configure FFmpeg and FFprobe executable paths. Generally, both executables reside in the same directory. We recommend using a [specially built FFmpeg 7.1.1](https://github.com/ErsatzTV/ErsatzTV-ffmpeg/releases/tag/7.1.1) provided by ErsatzTV.

Above the paths, the page shows the hardware acceleration the configured FFmpeg supports. If Tunarr can't run FFmpeg, a warning appears there instead. Correct the path and save, and Tunarr probes FFmpeg again.

## Global FFmpeg options

### Logging

!!! warn
    It is recommended to only enable this setting while debugging. If Tunarr experiences an FFmpeg error, it will _still_ generate an error log file that can be used when troubleshooting issues.

Printing or persisting FFmpeg logs to disk is useful when debugging streaming issues. This setting allows for FFmpeg logging to be outputted to Tunarr's stdout stream or to a separate file with a configurable log level. 

### HLS Direct Output Format

When using the HLS Direct stream mode in a channel (see [channel stream modes](../channels/transcoding/#hls-direct)), use this setting to change the output container format for the stream.

### HDR Tone-map Curve

The curve used to convert HDR programs to SDR when [HDR tonemapping](transcode_config.md#hdr-tonemapping) is enabled on the software pipeline. It is a matter of taste:

| Curve | Look |
|---|---|
| **Hable** (default) | Filmic. Keeps detail in shadows and highlights, but darkens the whole picture a little. |
| **BT.2390** | The ITU broadcast standard. Brighter than Hable, and closer to the source. |
| **Möbius** | Keeps in-range colors as they are and compresses only the brightest highlights. |
| **Reinhard** | A simple, soft curve that can look flat. |

The setting takes effect from the next program; no restart is needed. BT.2390 needs an FFmpeg with jellyfin-ffmpeg's `tonemapx` filter. Other FFmpeg builds use Hable instead.

### HLS Start-up

These settings trade a little efficiency for a faster tune-in on channels that use the HLS stream mode. They apply when a channel's stream next starts; a stream that is already running keeps its old values.

| Setting | Default | What it does |
|---|---|---|
| **HLS Segment Length (seconds)** | 4 | Length of each HLS segment, with a keyframe at every segment start. Shorter segments are ready sooner; their extra keyframes cost a little picture quality at the same bitrate. HLS Direct (v2) channels copy their source's video and use a fixed four-second target, cutting at source keyframes. |
| **Segments Before Playback** | 2 | How many segments must exist before a client gets the playlist. Segment length × this count is roughly the video encoded before the first byte is sent. Tunarr checks for them every 100 ms and waits up to 15 s. |
| **MPEG-TS Start-up Burst (seconds)** | 0 | HDHomeRun clients such as Plex read an HLS channel as one `.ts` stream, made by reading the channel's playlist at real-time pace. With a burst, that reader first sends up to this many seconds of video as fast as it is available, so the client's buffer fills at once. 0 turns it off. |
| **Read-ahead Thread Limit** | 16 | While HLS prepares video ahead of playback (the first transcode after a viewer tunes in, or one catching up), it raises the transcode config's thread count up to this limit, and no higher than the CPU cores Tunarr may run on, so the first seconds of video arrive sooner. It never lowers a config's count, and an automatic (0) count stays automatic. 0 turns the increase off. Unlike the settings above, it applies from the next program. See [Read-ahead threads](transcode_config.md#read-ahead-threads). |

For example, when the encoder runs near real time, 2 s segments with a 10 s burst send a cold channel's first byte in about half the time of the defaults (4 s instead of 8 s), and fill the client's buffer faster after that.

The served HLS playlist keeps up to 20 segments, with up to 10 segments of history
before the playback point. For regular HLS, the default four-second segment length
corresponds to roughly an 80-second window and 40-second history; changing **HLS
Segment Length** changes these durations.

HLS Direct v2 uses a fixed four-second target, unaffected by **HLS Segment Length**.
Its copied video can only be cut at source keyframes, so actual segment lengths
vary and a 20-segment window does not necessarily span 80 seconds. Alternate HLS
also retains its fixed four-second segment configuration.

### FFmpeg Transcode Path

Configure the path where FFmpeg writes HLS segments for a channel's stream. For instance, if running the standalone Linux binary, Tunarr can write transcoded segments to RAM by setting this option to `/dev/shm`. 

#### Transcode to RAM in Docker

Transcoding to RAM when running Tunarr in Docker requires configuring the container to create a `tmpfs` at startup time:

```yaml title="docker-compose.yml"
# ... rest of your docker compose
services:
    tunarr:
    # ... rest of your Tunarr service
    tmpfs:
        - /transcode:size=10G
```

Then, in Tunarr, you would set your transcode path to `/transcode`.

## Audio & Subtitles

### Subtitle Extraction

If content in your channels have embedded, text-based subtitles, this option enables Tunarr to extract subtitles from media files in order to subsequently burn the subtitles. Extract embedded text-based subtitles is currently a requirement for using said subtitle streams. Each hour Tunarr will scan the guide for upcoming media, find which items have embedded text-based subtitles, and then run extraction. This can be a resource-intensive process, so in general, sidecar text-based subtitles are preferable.

### Sidecar Subtitles

Tunarr supports sidecar subtitle files (`.srt`, `.ass`, `.ssa` and `.vtt`) placed alongside your media files. When scanning local libraries, Tunarr automatically discovers external subtitle files and associates them with the corresponding media.

In a local library, a subtitle file belongs to a video when it sits in the same folder and its name is the video's name, then the subtitle's language and options, separated by dots:

| File | Read as |
| --- | --- |
| `Movie (2010).en.srt` | English |
| `Movie (2010).en.sdh.srt` | English, for the deaf and hard of hearing (also `.hi` or `.cc`) |
| `Movie (2010).fr.forced.ass` | French, forced |
| `Movie (2010).srt` | Unknown language |

Language codes can be two or three letters (`en`, `eng`), with a region (`en-us`, `en_US`). The first part that is a language code is the language, so `Movie (2010).hi.srt` is Hindi, while the `.hi` in `Movie (2010).en.hi.srt` means hard of hearing. Subtitle files added after a scan are found at the library's next scan. Versions before 2026-10-16 never found these files; to pick up the ones already on disk in a folder that hasn't changed since, run **Force Scan** on the library once.

File and folder names may hold any characters, including apostrophes, colons, commas, semicolons, brackets and backslashes. Before 2026-10-17, a subtitle that was burned in (for example a forced one) stopped its program from playing when its path, or for an embedded track the video's path, held an apostrophe, a colon, a comma, a semicolon or a backslash.

For Plex, Jellyfin, and Emby sources, external subtitles are always resolved to a local file during scanning, so that starting a stream never waits on the media server:

1. **Shared storage.** If the subtitle file the media server reported is visible to Tunarr — directly, or through the source's [path replacements](../media_sources/jellyfin.md#configuring-path-replacements) — it is used as-is. Nothing is copied. When a program starts, this file is preferred over any downloaded copy, so a subtitle that was re-synced or replaced on the server is used straight away.
2. **Downloaded during scanning.** Otherwise Tunarr fetches the subtitle from the media server and caches it locally.

Setting up path replacements for a media source therefore benefits subtitles as well as video, and is the only way image-based external subtitles can be used, since those cannot be downloaded as text.

!!! note
    Plex reports where a subtitle file is only when Tunarr connects to it through a **local address** (for example `http://127.0.0.1:32400` when both run on the same machine). Through a remote address, such as its `plex.direct` name, Plex leaves the path out, so Tunarr downloads every subtitle even when it could read the file. A Plex library scan says so in the log once: *Plex didn't report subtitle file paths…*. Change the Plex server's address under **Settings > Media Sources**, then run **Force Scan** on its libraries once.

Every hour, for programs airing in the next hour on channels that have subtitles enabled, Tunarr checks their external subtitles:

- **Missing:** a subtitle that could not be resolved during a scan (because the media server was unreachable, for example), or whose cached copy has since been deleted, is fetched, without waiting for a rescan of the whole library.
- **Old copies:** a downloaded copy more than 6 hours old is fetched again and replaced only if it changed. The media server can rewrite a subtitle's file under the same stream (a re-sync, a better download). The copy is swapped in whole, so a program that is playing never reads half a file.
- **Gone from the media server:** if the media server answers "not found" for a subtitle (its file was replaced or removed), Tunarr reads the program from the media server again at once, saves its subtitles as they are now, and downloads the replacement. It does this once per program per hour. If the media server still lists the subtitle (it hasn't rescanned the item yet), Tunarr keeps what it has until it does. A program the media server no longer has at all is left to the next library scan, which marks it missing.

!!! note
    External subtitles from Jellyfin and Emby libraries scanned by an older version of Tunarr are picked up by that hourly pass once the program is scheduled, or immediately on the next rescan of the library.

When using the **HLS Direct v2** stream mode, text-based subtitles (embedded or sidecar files) are served as WebVTT tracks in the HLS master playlist, since this mode can't burn them into the picture. Clients that support HLS subtitle renditions (most modern players) will display them as selectable subtitle options. A channel that starts during a stretch without dialogue starts right away, and its subtitle track stays empty until the next line.

!!! note
    WebVTT subtitle tracks in the **HLS** stream mode are currently experimental. To enable them, go to **Settings > Features** and turn on the sidecar subtitles option.

### Closed Captions for HDHomeRun Clients

Plex Live TV and other HDHomeRun clients read a channel as one MPEG-TS stream. That stream can't carry a selectable subtitle track, so Tunarr normally burns subtitles into the picture. With **Closed captions for HDHomeRun clients (Plex)** turned on, Tunarr sends them as CEA-608 closed captions instead. Viewers switch them on and off with their player's subtitles or CC button.

When more than 10% of a subtitle track's cues contain characters CEA-608 cannot
represent, Tunarr keeps that track for burn-in rather than presenting partial or
empty captions. A warning reports the affected cue and character counts. CEA-608
cannot represent Japanese and many other scripts; WebVTT and burn-in do not have
that character restriction.

- **Which subtitles:** the program's full text subtitles become captions. If the channel's subtitle selection picks forced subtitles (for example, only the foreign-language lines of an English program), those stay burned in, and the program's full subtitles in your preferred language become the captions. Before 2026-10-18, Tunarr read every subtitle track inside a video file as not forced: subtitle selection that asks for forced subtitles never found one, and a forced track (an English dub's "Signs & Songs", say) could become the captions instead of the full one. Tunarr now keeps the flag the media server (or, for a local library, the file) reports, and corrects programs scanned before when it starts.
- **No longer burned in:** full text subtitles that would have been burned in for the whole program are sent as captions instead, unless the character-support fallback above requires burn-in, so viewers who want captions must turn them on. Tunarr's own players get them as selectable WebVTT subtitles. Full text subtitles that can't become captions (that fallback, a program whose frame rate is unknown, or a file that can't be read) are burned in even with the WebVTT sidecar option on, so HDHomeRun viewers still see them.
- **Always burned in:** image-based subtitles (PGS, VobSub) can't become captions and are still burned in.
- **Requirements:** text subtitles on disk, either sidecar files or [extracted](#subtitle-extraction) ones. The channel must use the **HLS** stream mode and have subtitles enabled, and its [transcode config](transcode_config.md) must output H.264 video (its **Video Format**). The caption track is only added on those channels: on a channel with subtitles off, the `.ts` stream is left untouched, as with the switch off. Captions can only be added to H.264 video: with HEVC or MPEG-2 output, the whole channel is treated as with the switch off. Its subtitles are burned in as with captions off, programs without subtitles get no notice, and its `.ts` stream has no caption track. When the channel's `.ts` stream starts, the log says so once at info level. A channel whose HLS session was started with captions off keeps them off until that session restarts, even after the switch or the channel's subtitles are turned on, and the log says that instead. Before 2026-10-18, such a channel's full text subtitles were neither burned in nor sent as captions. Until 2026-10-19, its `.ts` stream still offered a caption track that never showed anything.
- **Formatting:** italics and underline from the subtitle file (`<i>`, `<u>`, and ASS `{\i1}`, `{\u1}`) are kept. Other formatting (bold, colors, fonts) is dropped, and so is the text of ASS vector drawings.
- **Placement:** captions go where the subtitle file puts them, in a third of the screen: at the top, in the middle or at the bottom, and at the left, centered or at the right. The first of these that a cue has decides:
  1. In an ASS file, an exact position (`\pos`, or where a `\move` starts): the third of the script's screen it is in.
  2. An alignment override in the cue (`{\an1}` to `{\an9}`, the numpad layout; or SSA's `{\a1}` to `{\a11}`).
  3. In an ASS file, the alignment of the cue's style.
  4. Otherwise the bottom, centered by **Caption Alignment**.

  Placement and the styles can each be turned off under [Caption appearance](#caption-appearance-experimental).
- **Overlapping subtitles:** while two subtitles overlap by more than half a second, both are shown in one block, older above newer (up to 4 lines), at the bottom when the file places them apart. **When subtitles overlap** under Caption appearance can show each where the file puts it, or only the newest.
- **Caption Alignment:** where lines sit across the screen. **Centered block** (the default) starts every line in the same column, with the block centered. **Each line centered** centers each line on its own. **Left** starts every line at the left edge.
- **Look:** text size and font are the player's, not Tunarr's, and so is the box behind the text unless you choose one under [Caption appearance](#caption-appearance-experimental). Plex Live TV (on Apple TV, for example) burns captions into the picture in its own style, a solid dark box behind the text. The text size follows the Plex app's subtitle size setting. In a test, Plex ignored CEA-608's see-through and transparent box codes.
- **Format limits:** lines hold up to 32 characters, two lines at a time (both adjustable under [Caption appearance](#caption-appearance-experimental)), and long cues are split over time. A style change in the middle of a word takes a column of its own, and so do a text color and a box. Characters outside the caption character set (most non-Latin scripts) are dropped. Accents saved as separate combining marks, as some macOS tools write subtitle files, are joined to their letters first. Before 2026-10-19 such accents were dropped (`café` became `cafe`).
- **Text encoding:** a subtitle file that starts with a byte order mark is read as the UTF-8 or UTF-16 it declares. Otherwise it is read as UTF-8 when it is UTF-8 (or nearly all of it is, with a few broken characters), and as Windows-1252, the Western European code page that also covers Latin-1 (ISO 8859-1), when it isn't. Before 2026-10-19, every file was read as UTF-8, so a Windows-1252 file's accented letters were dropped from the captions (`café` became `caf`) and a UTF-16 file gave none. A file in another code page (Central European, Cyrillic, Greek) is read as Windows-1252 and its letters come out wrong; save it as UTF-8. Burned-in subtitles are read by ffmpeg, which leaves out any line of a file without a byte order mark that isn't valid UTF-8, so convert such files to UTF-8 to have them burned in.
- **Every frame carries caption data,** even when nothing is being said, so players detect the caption track as soon as they tune in. Each two-character pair is sent once and in order: if a frame is missing where one was due, its pair goes out on the frames that follow instead of being lost. The `.ts` stream keeps every frame where one segment meets the next and where one program meets the next, so no pair is lost there either.
- **Frame rate:** captions carry two characters per video frame, so while they're on, Tunarr gives each program a fixed, standard output frame rate and lays the captions out at exactly that rate: the program's own (23.976, 25, 29.97...), doubled when the software deinterlacer outputs a frame per field, or 29.97 for a file whose reported rate isn't standard (see [Normalize Frame Rate](transcode_config.md#normalize-frame-rate)).
- **Tuning in partway through a subtitle:** its caption shows once it has loaded, a fraction of a second in, when at least a second of it is left. A shorter rest is skipped, so the first caption you see is never the end of a line flashing past. Roll-up keeps it, since its lines stay up while the next ones scroll in.
- **Tuning in while a caption loads:** a player that tunes in (Plex reading the stream partway through) can only start decoding at a keyframe, which Tunarr puts at the start of every segment, and Plex's caption decoder starts in roll-up mode. So when a pop-on caption was still loading at that keyframe, the rest of it went straight on screen as a fragment (the end of a line, such as "ng the soup" for "Are you eating the soup?") and could stay up for seconds. Tunarr now loads each caption between two keyframes: before the keyframe when there's room, otherwise just after it, which shows the caption up to 300 ms late. Only when that isn't enough does a caption still load across a keyframe. With 2 s segments and back-to-back dialogue, about 1 tune-in in 60 at 29.97 fps (1 in 16 at 23.976 fps) still meets a fragment, against 1 in 3 before, and 1 caption in 15 to 30 shows later than it did, by 0.15 to 0.2 s typically and never more than 0.3 s. At 59.94 fps nothing moves and no fragment is left. Shorter segments leave less room between keyframes, so more captions load across one. Paint-on and roll-up draw text as it arrives and are unchanged, and so are captions on copied video (HLS Direct v2), whose keyframes Tunarr doesn't know. Hardware encoders can add keyframes of their own (Intel QSV puts one every second), which this doesn't plan around.
- **Programs without subtitles:** players offer captions for the whole stream, so a program with no subtitle track shows a short caption, "No captions for this program", from 1 to 5 seconds into the program (or into the stream, if you tune in partway through), a little later for video below 23.976 fps or when the caption appearance makes it slower to load. A viewer who turns captions on can then tell they work. Filler, flex time and music tracks don't show it, and neither does a program whose subtitles can't become captions (image-based ones are burned in instead).
- **A program that ends early:** when a program's video stops before its scheduled end (FFmpeg exits early, or the file is shorter than its recorded length), its captions stop there too. Before 2026-10-19, an item after it without captions of its own (flex time, an error screen, filler without subtitles) carried the rest of the program's dialogue. A caption still on screen when the program stops is erased where the next item starts. When the next item has captions of its own, the caption stays up until the next item's first caption replaces it.
- **Language:** the stream labels the captions with the first language in your [Language Preference](#language-preference), so players such as Plex can name the track by language instead of "Unknown".

#### Caption appearance (experimental)

Everything CEA-608 captions can ask for, under **Caption appearance (experimental)** below Caption Alignment. A player may ignore any of it: Plex draws captions with its own decoder. Turn on the **Test pattern** to see what yours shows. Changes take effect from the next program.

To try a look or the test pattern on one channel without changing every channel, use the channel's own [caption settings](../channels/transcoding.md#captions-for-this-channel), then **Copy to all channels** once the look works.

- **Text color:** white, green, blue, cyan, red, yellow or magenta. Italic words are always white, which is how CEA-608 defines italics.
- **Box behind the text:** the player's own (the default: Tunarr sends nothing), or black, white, green, blue, cyan, red, yellow or magenta. **Box opacity** makes a chosen box solid, see-through, or none at all (the text alone). The box holds to the end of every line: Plex's family of caption decoders turns the box back to black when the previous caption is cleared, so Tunarr loads each boxed line wholly before or after that clear (test pattern sample 39). In very quick dialogue, where a caption only just loads in time, Tunarr keeps the caption on time instead, and the end of a line can still lose its box.
- **How captions appear:** **Pop-on** (the default) shows each caption whole, on its start frame. **Roll-up** scrolls lines up from the bottom row with 2, 3 or 4 rows on screen, as live TV captions do; a cue's lines stay together, and the last lines stay up for up to 2 seconds for the next subtitle to scroll. **Paint-on** draws each caption's letters as they arrive.
- **Lines per caption:** 2 (the default), 3 or 4. More lines split long subtitles less often. Roll-up uses its own number of rows.
- **Line width:** 20 to 32 columns. A narrower line wraps sooner.
- **Bottom row and Top row:** the screen has 15 caption rows. Captions end on the bottom row (15, the default); captions the subtitle file places at the top start on the top row (1), and ones it places in the middle sit between the two.
- **When subtitles overlap:** **Show both, stacked** (the default) puts both in one block, older above newer; when the file places them apart (a sign at the top over dialogue), the block goes at the bottom, because Plex's family of caption decoders positions only a caption's first line. **Show each where the subtitle file puts it** keeps them apart, for players that place every line (test pattern sample 38 shows whether yours does). **Show the newest** shows one at a time, bringing the earlier back when the newer ends if it lasts at least another second. Roll-up and paint-on always show one at a time.
- **All capitals**, and whether to keep the subtitle file's **italics and underline** and its **placement** (top, middle and sides).

A box, a color or narrower lines make each caption take longer to send, so in fast dialogue a caption can come a little late. Roll-up and paint-on send a caption's text while it is on screen, at two characters a frame, so a long caption with a short time is cut off at its end.

**Test pattern:** replaces every program's captions with 39 numbered samples that loop, one per feature, each saying what it should look like. Turn captions on in your player, note the numbers that look wrong, then turn the test pattern off. Your appearance settings don't change the samples. A channel's own [**Test pattern on this channel**](../channels/transcoding.md#captions-for-this-channel) switch shows it on that channel only.

| # | Sample |
| --- | --- |
| 1–7 | Text colors: white, green, blue, cyan, red, yellow, magenta |
| 8 | Red text with white italics in the middle |
| 9, 10 | Italics, underline |
| 11–18 | Boxes: black, red, green, blue, cyan, magenta, then blue text on yellow and on white |
| 19, 20 | See-through black and blue boxes |
| 21 | No box at all |
| 22–25 | Rows 1 and 5 (top), 11 and 13 (bottom) |
| 26, 27 | Three and four lines |
| 28, 29 | Left-aligned lines, and each line centered |
| 30 | Flashing text |
| 31 | Paint-on |
| 32–34 | Roll-up with 2, 3 and 4 rows |
| 35 | Middle of the screen |
| 36 | Right-aligned |
| 37 | Two overlapping lines, stacked |
| 38 | A sign at the top and a line at the bottom at once, each in its place |
| 39 | A magenta box, then a second line straight after it that keeps the magenta box to its last character (italics and ♪ included) |

The setting takes effect from the next program, and the HDHomeRun stream picks it up the next time it is started.

### Language Preference

Currently, language preferences can only be configured globally. Use this setting to set an ordered list of preferred audio languages. The first matching audio language stream for a given piece of content will be chosen.

!!! note
    ISO 639-2 gives 20 languages two different three-letter codes — German is both `ger` and `deu`, French both `fre` and `fra` — and media servers and files use them interchangeably. Tunarr treats the two codes for a language as equivalent, so a preference matches a track regardless of which code the file or media server reports.
