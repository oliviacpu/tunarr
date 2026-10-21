# Captions & audio

Choose subtitle handling, caption appearance, and preferred audio languages under **Settings > Captions & audio** (`/web/settings/captions-audio`).

This tab contains global subtitle preferences, embedded subtitle extraction, HDHomeRun closed captions, caption alignment and appearance, and preferred input audio languages. See [Audio & Subtitles](../ffmpeg/index.md#audio-subtitles) for details.

The optional WebVTT Sidecar Subtitles feature is also here, with its own Save button. This feature keeps its own enablement control; subtitle preferences do not turn it on.

Closed-caption delivery is fixed when the channel's HLS session starts. Stop all viewers and tune in again after changing that switch. Caption alignment, appearance, test pattern and audio language preferences are read by the next program pipeline. See [when settings take effect](applies-when.md) for every group.

## Global subtitle preferences

Add languages in the order Tunarr should try them. Each row has its own filter (**Any**, **Forced**,
**Default** or **None**) and controls for external and image-based subtitles. Move rows to change
priority, remove a row or clear the list, then Save. **Reset changes** discards unsaved edits.

Channels using global preferences follow this list. A nonempty list with no matching row selects no
subtitle; **None** skips that row. An empty global list keeps the stream mode's existing fallback.
These preferences do not enable subtitles, extraction, captions or WebVTT output. HLS Direct v2 can
only use text subtitles. A program already streaming keeps its selected subtitles.

Choose **Customize for this channel** on a channel's Streaming tab for an exception. Returning to global
preferences retains its custom list for later. Fixed output audio tracks remain a per-channel choice;
the input audio language preference list on this page does not create an output track layout.

[View global and channel screenshots](../../dev/subtitle-defaults-gallery.md).
