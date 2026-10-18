# Flex

Flex is an optional block of time that is used to separate two episodes of television. One reason to use Flex time is to create commercial breaks after each episode to simulate traditional television.

There are a few ways to create Flex time such as Time Slots. When you have Flex time but no Filler Content configured, the Channel Fallback shown in the screenshot below will be used. You can optionally select the upload button to choose your own custom fallback image. 

Please see the [Filler Lists page](/configure/library/filler) for details on creating your first list. 

![Flex filler content](/assets/flex-filler-content.png)

Once you have a Filler list created, you can select the list you'd like to use on a particular channel.

![Flex Filler](/assets/channels-flex-filler.png)

Once you have a Filler list added to a channel, it will only be used when there is Flex time scheduled, such as when using [Time Slots](/configure/scheduling-tools/time-slots) with the Pad Times feature. 
Tuning in during a gap starts as quickly as tuning in during a program: the start of the gap is prepared ahead, the same way a program's is, and a fallback image uploaded in the web UI is read straight from the server's disk. With NVIDIA, Intel QSV or VAAPI hardware acceleration the fallback image still starts at normal speed, because those pipelines can't prepare a still image ahead.

## Gap music

The channel fallback can play music under its image. Build a [filler list](/configure/library/filler) of tracks from a music library (add whole artists or albums, or single tracks), then choose it as **Gap music** next to the fallback image.

- During flex time that no filler fills, the image shows while the list's tracks play one after another. Each gap plays tracks this channel hasn't played recently first.
- Every track is normalized to the same loudness (about -24 LUFS, typical for TV), so loud and quiet recordings sit at an even level. Programs themselves are not normalized.
- A track fades in, and fades out when the gap ends before the track does.
- Don't also add the list as filler on the same channel: filler tracks play as programs with their album art instead.

The music library has to be enabled and scanned under Sources first.

### Artist and title

With **Show the artist and title** checked (the default), the track that's playing is shown as "♪  Artist — Title" in a dark strip along the bottom of the fallback image.

- The strip is in the same place on every channel, centred near the bottom edge, so keep important detail out of the bottom tenth of your fallback image. It's sized from the image's height, so it scales with it.
- Long names are cut short with "...".
- The text uses a font bundled with Tunarr (M+ Rounded 1c) that covers Latin, Greek, Cyrillic and Japanese. A name with characters it doesn't have, such as Korean, shows no text rather than empty boxes.
- It needs an ffmpeg build with the `drawtext` filter. Without one, gaps show the image without the text.

## Gaps in the guide

In the XMLTV guide, a gap shows a picture: the **Guide Picture for Gaps** if you set one, otherwise the fallback image, otherwise the channel logo. Apps such as Plex keep one picture per guide entry and crop it to both tall and wide tiles. A wide fallback image with text across it loses its edges in tall tiles, so for the guide picture use a square image with its content in the middle third of the width and the middle half of the height.
