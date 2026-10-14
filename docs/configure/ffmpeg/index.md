# FFmpeg

Tunarr requires FFmpeg for transcoding / remuxing content when outputting channel streams. Settings relating to transcoding and FFmpeg can be found on the Settings > FFmpeg page.

## Executable Paths

!!! info
    Only non-Docker installs must provide FFmpeg executable paths. Docker installs come with a bundled version of FFmpeg.

Configure FFmpeg and FFprobe executable paths. Generally, both executables reside in the same directory. We recommend using a [specially built FFmpeg 7.1.1](https://github.com/ErsatzTV/ErsatzTV-ffmpeg/releases/tag/7.1.1) provided by ErsatzTV.

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
| **HLS Segment Length (seconds)** | 4 | Length of each HLS segment, with a keyframe at every segment start. Shorter segments are ready sooner; their extra keyframes cost a little picture quality at the same bitrate. HLS Direct (v2) channels copy their source's video and keep 4 s segments. |
| **Segments Before Playback** | 2 | How many segments must exist before a client gets the playlist. Segment length × this count is roughly the video encoded before the first byte is sent. |
| **MPEG-TS Start-up Burst (seconds)** | 0 | HDHomeRun clients such as Plex read an HLS channel as one `.ts` stream, made by reading the channel's playlist at real-time pace. With a burst, that reader first sends up to this many seconds of video as fast as it is available, so the client's buffer fills at once. 0 turns it off. |

For example, when the encoder runs near real time, 2 s segments with a 10 s burst send a cold channel's first byte in about half the time of the defaults (4 s instead of 8 s), and fill the client's buffer faster after that.

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

Tunarr supports sidecar subtitle files (`.srt`, `.vtt`, etc.) placed alongside your media files. When scanning local libraries, Tunarr automatically discovers external subtitle files and associates them with the corresponding media.

For Plex, Jellyfin, and Emby sources, external subtitles are always resolved to a local file during scanning, so that starting a stream never waits on the media server:

1. **Shared storage.** If the subtitle file the media server reported is visible to Tunarr — directly, or through the source's [path replacements](../media_sources/jellyfin.md#configuring-path-replacements) — it is used as-is. Nothing is copied.
2. **Downloaded during scanning.** Otherwise Tunarr fetches the subtitle from the media server and caches it locally.

Setting up path replacements for a media source therefore benefits subtitles as well as video, and is the only way image-based external subtitles can be used, since those cannot be downloaded as text.

A subtitle that could not be resolved during a scan — because the media server was unreachable, for example — is retried hourly for programs airing in the next hour on channels that have subtitles enabled, so it becomes available without waiting for a rescan of the whole library. The same pass restores a cached subtitle file that has since been deleted.

!!! note
    External subtitles from Jellyfin and Emby libraries scanned by an older version of Tunarr are picked up by that hourly pass once the program is scheduled, or immediately on the next rescan of the library.

When using the **HLS Direct v2** stream mode, text-based subtitles (embedded or sidecar files) are served as WebVTT tracks in the HLS master playlist, since this mode can't burn them into the picture. Clients that support HLS subtitle renditions (most modern players) will display them as selectable subtitle options. A channel that starts during a stretch without dialogue starts right away, and its subtitle track stays empty until the next line.

!!! note
    WebVTT subtitle tracks in the **HLS** stream mode are currently experimental. To enable them, go to **Settings > Features** and turn on the sidecar subtitles option.

### Closed Captions for HDHomeRun Clients

Plex Live TV and other HDHomeRun clients read a channel as one MPEG-TS stream. That stream can't carry a selectable subtitle track, so Tunarr normally burns subtitles into the picture. With **Closed captions for HDHomeRun clients (Plex)** turned on, Tunarr sends them as CEA-608 closed captions instead. Viewers switch them on and off with their player's subtitles or CC button.

- **Which subtitles:** the program's full text subtitles become captions. If the channel's subtitle selection picks forced subtitles (for example, only the foreign-language lines of an English program), those stay burned in, and the program's full subtitles in your preferred language become the captions.
- **No longer burned in:** full text subtitles that would have been burned in for the whole program are sent as captions instead, so viewers who want them must turn captions on. Tunarr's own players get them as selectable WebVTT subtitles.
- **Always burned in:** image-based subtitles (PGS, VobSub) can't become captions and are still burned in.
- **Requirements:** text subtitles on disk, either sidecar files or [extracted](#subtitle-extraction) ones. The channel must use the **HLS** stream mode and have subtitles enabled.
- **Formatting:** italics and underline from the subtitle file (`<i>`, `<u>`, and ASS `{\i1}`, `{\u1}`) are kept. A cue the file places at the top of the screen (`{\an7}`, `{\an8}` or `{\an9}`) is shown at the top; all others go at the bottom. Other formatting (bold, colors, exact positions) is dropped.
- **Caption Alignment:** where lines sit across the screen. **Centered block** (the default) starts every line in the same column, with the block centered. **Each line centered** centers each line on its own. **Left** starts every line at the left edge.
- **Look:** text size, font and background are the player's, not Tunarr's. Plex Live TV (on Apple TV, for example) burns captions into the picture in its own style, a solid dark box behind the text. The text size follows the Plex app's subtitle size setting. CEA-608's optional background codes (semi-transparent or transparent) don't change it, so Tunarr doesn't send them.
- **Format limits:** lines hold up to 32 characters, two lines at a time, and long cues are split over time. A style change in the middle of a word takes a column of its own. Characters outside the caption character set (most non-Latin scripts) are dropped.
- **Every frame carries caption data,** even when nothing is being said, so players detect the caption track as soon as they tune in.
- **Programs without subtitles:** players offer captions for the whole stream, so a program with no subtitle track shows a short caption, "No captions for this program", from 1 to 5 seconds into the program (or into the stream, if you tune in partway through), a little later for video below 23.976 fps. A viewer who turns captions on can then tell they work. Filler, flex time and music tracks don't show it, and neither does a program whose subtitles can't become captions (image-based ones are burned in instead).
- **Language:** the stream labels the captions with the first language in your [Language Preference](#language-preference), so players such as Plex can name the track by language instead of "Unknown".

The setting takes effect from the next program, and the HDHomeRun stream picks it up the next time it is started.

### Language Preference

Currently, language preferences can only be configured globally. Use this setting to set an ordered list of preferred audio languages. The first matching audio language stream for a given piece of content will be chosen.

!!! note
    ISO 639-2 gives 20 languages two different three-letter codes — German is both `ger` and `deu`, French both `fre` and `fra` — and media servers and files use them interchangeably. Tunarr treats the two codes for a language as equivalent, so a preference matches a track regardless of which code the file or media server reports.