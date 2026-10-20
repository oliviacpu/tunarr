# Channel Trancoding Settings

Open the channel editor's **Streaming** tab for stream mode, transcode config, audio, and subtitles. Logo overlays are configured in the separate [Watermark](watermarks.md) tab.

## Stream Mode

Tunarr supports several different stream modes that can be set at the channel level.

!!! info

    No matter which stream mode you choose for a channel, clients which require an MPEG-TS stream will still work.

### HLS (recommended)

HLS is the default streaming mode for a channel. In our testing, it is generally the most reliable and efficient. It is akin to [ErsatzTV's](https://ersatztv.org/) "HLS Segmenter" mode.

#### How does it work?

This mode creates a single FFMPEG process, per-program. The process applies all transcoding configuration necessary. Tunarr manages interleaving these processes to create seamless m3u8 playlists for playback.

#### Things to consider

In our testing, we've found this mode to be both efficient and reliable. That said, it is also the newest mode introduced to Tunarr, so there might be some kinks to work out.

### HLS alt

HLS alt (name pending!) is another HLS streaming mode, which operates a little differently. This mode is akin to [ErsatzTV's](https://ersatztv.org/) "HLS Segmenter V2" mode.

#### How does it work?

This mode creates two FFMPEG processes. The first runs per-program and applies scaling/cropping, watermarks, frame rate changes, etc, but outputs a rawvideo stream. The second process concatenates all of these together while also applying bit rate limits and codec changes.

#### Things to consider

The downside to this mode is that the one of the steps (the per-program process) _requires_ software encoding. This can put a lot of stress on certain systems. The stream setup can also lead to quality loss, due to generation loss. However, it does have the potential to create a more reliable / robust stream.

### HLS Direct

#### How does it work?

This mode does not perform any stream normalization. When the channel m3u8 playlist is requested, it returns a playlist with a single item URL set to the duration of the current item in the channel. The URL returns a direct stream of the item, remuxed to the container set as **HLS Direct output format** under Settings > Transcoding (MPEG-TS, MKV, or MP4).

#### Things to consider

Because this mode does not perform stream normalization, there may be issues when transitioning between programs; the mode requires clients to essentially "reset" themselves between each program for transitions to function as expected. Some clients that are known to work in this mode are Jellyfin and MPV, but there are almost certainly others.

### HLS Direct v2

#### How does it work?

HLS Direct v2 works like standard HLS mode, but without transcoding. Rather than returning a single-item m3u8 pointing directly to the program stream (as HLS Direct does), it produces a proper continuous HLS playlist of segmented chunks — the same structure as the regular HLS mode. No codec conversion or normalization is applied; the source content is remuxed directly into the segments.

#### Things to consider

Users who want direct streaming without transcoding may find this mode more compatible than HLS Direct, particularly with clients that do not rely on FFmpeg's HLS demuxer implementation. Because the output is a standard segmented HLS playlist, clients that expect that structure should handle program transitions more gracefully than they would with HLS Direct.

As with HLS Direct, no stream normalization is applied, so mixed source formats (different codecs, resolutions, frame rates) across lineup items may cause playback issues depending on the client.

### MPEG-TS

This mode is the closest to the DizqueTV experience.

#### How does it work?

It consists of two FFMPEG processes, one which performs the per-program transcode, outputting an mpeg-ts stream and one which concatenates this raw stream together and outputs it.

#### Things to consider

If this mode was "good enough" we probably wouldn't have spent time implementing the other modes! There are a lot of potential issues with this mode; too many to list here.

## Audio tracks (switchable audio in Plex Live TV)

**Audio tracks** (under *Audio & Subtitles* on the channel's Streaming tab) gives a channel a fixed set of audio
tracks: up to four language codes (ISO 639-2, such as `eng`, `jpn`), in order. Every program, gap (the offline picture,
with or without gap music), error screen and commercial on the channel then carries exactly these tracks, in this
order, each tagged with its language.

Plex Live TV keeps the audio tracks it sees when you tune in for the whole session, and ends the session if the stream
restarts. So a channel only gets a working audio menu when the tracks never change. With the setting:

- **Plex picks each viewer's preferred audio language.** It uses the account's preferred audio language from the list.
  Viewers can still switch tracks in the player's audio menu.
- **A program with that language** uses its own track for the slot. Among several tracks in that language, commentary
  tracks are skipped; then the selected, the default, or the first track wins.
- **A program without that language** repeats its main audio in that slot, so the menu still has the same entries.
  The repeated track is processed once (volume, loudness normalization) and copied into each slot that uses it.
- **Every track is encoded** with the channel's transcode configuration (codec, bitrate, channels, sample rate). Each
  extra track costs one more audio encode.
- **Every track is in the `.ts` stream Plex reads from the start.** That stream waits up to 15 seconds for a track whose
  first audio comes a little late, instead of failing to start.

Leave the field empty for one audio track, the program's own, as before.

!!! example "An anime channel"

    `eng, jpn` gives every program an English and a Japanese track. English comes first, so it's the default for
    players that don't pick a language. Dual-audio episodes offer both; English-only and Japanese-only episodes repeat
    their one language in the other slot.

!!! info

    HLS Direct v2 copies each program's own tracks unchanged, so it can't offer a fixed set; the field is disabled for
    that mode. HLS, HLS alt and MPEG-TS support it.

## Captions for this channel

**Captions for this channel** (under *Audio & Subtitles* on the channel's Streaming tab) tries
[closed-caption options](../ffmpeg/index.md#closed-captions-for-hdhomerun-clients) on one channel, a test channel for
example, without changing them for every channel. Closed captions for HDHomeRun clients must be turned on under
Settings > Transcoding; that switch stays the one for every channel. Changes take effect from the channel's next program.

- **Test pattern on this channel:** replaces this channel's captions with the numbered
  [test pattern](../ffmpeg/index.md#caption-appearance-experimental). Other channels keep their captions. When the
  Transcoding settings' test pattern is on, every channel shows it, whatever this switch says.
- **Use own caption look:** gives the channel its own caption alignment and
  [caption appearance](../ffmpeg/index.md#caption-appearance-experimental). The fields show the global look; a setting
  you change becomes this channel's own, and only this channel's captions change. Turned off, the channel follows the
  global look again.
- **Copy to all channels:** makes this channel's look the global one, for every channel without a look of its own.
  Use it once a look works in your player.
- **Reset to global:** drops the channel's own look and keeps its test pattern switch.

A setting the channel doesn't change follows the global one, so a later change on the Settings > Transcoding page still
reaches it.
