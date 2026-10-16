# A test channel: its own caption settings, labelled test clips, hidden from friends

## Context

Caption appearance, alignment, overlap handling and the caption test pattern are global FFmpeg settings, so trying an
option (a coloured box, say) changes the captions on every channel for every viewer. The owner asked for a dedicated
test channel instead: tune in, try options against good test data, and copy what works to the real channels.

Requirements:

- **Its own settings.** The test channel's caption options don't touch the other channels.
- **Always in the guide** as a fixed high channel number.
- **Invisible to friends.** Friends reach Plex Live TV through a separate proxy (another fork), so that is where the
  channel is hidden.
- **Test data** for captions, audio, video and transitions.

## Part A: per-channel caption settings (this repo)

- **Schema:** a nullable JSON channel field `captions`:
  `{ testPattern?: boolean; alignment?: CaptionAlignment; appearance?: Partial<CaptionAppearance> }`.
  - It's validated against the existing caption enums and stored like `audioTracks`.
  - Only the fields a channel changes are saved, so later global changes still reach the rest.
- **Stream time:**
  - The test pattern runs when the global switch or the channel's `captions.testPattern` is on.
  - The channel's appearance and alignment are merged over the global ones wherever captions are built or timed.
  - The global closed-captions switch stays the master switch.
- **Web:** the caption controls become a shared component. The channel editor gets a "Captions for this channel"
  section with **Copy to all channels** and **Reset to global**.

## Part B: hiding the channel from friends (the proxy fork, not this repo)

The proxy tells friends from the owner by plex.tv's share list, not by the server's owner token, because each of the
owner's devices signs in with its own token.

For friends it:

- drops the channel from Live TV channel lists, guide grids, hubs, search results and the DVR's channel map;
- refuses tune requests for it.

The owner's devices see it as usual.

## Part C: test data

1. **Generated clips** (`scripts/test-channel/make-test-media.mjs`). Labelled clips, each with a running clock and a
   frame counter:
   - **Captions:** an SRT suite and an ASS suite as sidecars (italics, ♪, placement, overlaps, fast dialogue, short gaps
     between cues), and a clip with no subtitles.
   - **Audio:** English + Japanese tracks that say their language, a 5.1 speaker check, stereo, English only, and
     several codecs.
   - **Video:** HDR10, HLG, 10-bit SDR, interlaced, several frame rates, anamorphic.
   - **Transitions:** short clips with differing layouts, back to back.
2. **Free-licence excerpts:** Blender open films with their official subtitles, and published HDR and codec test
   clips, credited in a README next to the clips.
3. **A few programs from the media server's own libraries**, picked by property: dual audio with styled subtitles,
   HDR10, 5.1, an interlaced DVD source, and a commercial.

The clips live in a folder outside the media server's libraries, scanned by a local media source. The deployment's own
tooling builds the channel: HLS mode, subtitles on, `audioTracks` `eng, jpn`, its own card. It adds the channel to Plex
only after the proxy's filter is live, and only while nobody is watching, because a Plex channel-map change ends any
Live TV session that is playing.

## Experiment: a second caption track

Plex Live TV reads one CEA-608 caption channel (CC1). Once the test channel exists, try the test pattern on CC2 and on
CC3 as a second track ("Original" and "Test"), and keep whichever Plex's players offer.

## Rollout

1. Part A: PR, release, deploy.
2. Part B: the proxy's filter deployed **before** the channel appears in Plex.
3. Test media and the channel built.
4. The channel added to Plex while nobody is watching.

## Verification

- **Part A:** unit tests; the golden caption snapshot unchanged; a stream-repro run with two channels, where only the
  one with its own `captions` uses them.
- **Part B:** the proxy's tests over owner, owner-device, friend and unsettled callers.
- **The channel:** both audio tracks and captions on its tuner stream; it shows in the owner's guide and not in a
  friend's.
