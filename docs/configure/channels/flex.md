# Flex

Flex is an optional block of time that is used to separate two episodes of television. One reason to use Flex time is to create commercial breaks after each episode to simulate traditional television.

There are a few ways to create Flex time such as Time Slots. When you have Flex time but no Filler Content configured, the Channel Fallback shown in the screenshot below will be used. You can optionally select the upload button to choose your own custom fallback image. 

Please see the [Filler Lists page](/configure/library/filler) for details on creating your first list. 

![Flex filler content](/assets/flex-filler-content.png)

Once you have a Filler list created, you can select the list you'd like to use on a particular channel.

![Flex Filler](/assets/channels-flex-filler.png)

Once you have a Filler list added to a channel, it will only be used when there is Flex time scheduled, such as when using [Time Slots](/configure/scheduling-tools/time-slots) with the Pad Times feature. 
## Gap music

The channel fallback can play music under its image. Build a [filler list](/configure/library/filler) of tracks from a music library (add whole artists or albums, or single tracks), then choose it as **Gap music** next to the fallback image.

- During flex time that no filler fills, the image shows while the list's tracks play one after another. Each gap plays tracks this channel hasn't played recently first.
- Every track is normalized to the same loudness (about -24 LUFS, typical for TV), so loud and quiet recordings sit at an even level. Programs themselves are not normalized.
- A track fades in, and fades out when the gap ends before the track does.
- Don't also add the list as filler on the same channel: filler tracks play as programs with their album art instead.

The music library has to be enabled and scanned under Sources first.
