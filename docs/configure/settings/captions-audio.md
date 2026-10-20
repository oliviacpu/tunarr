# Captions & audio

Choose subtitle handling, caption appearance, and preferred audio languages under **Settings > Captions & audio** (`/web/settings/captions-audio`).

This tab contains embedded subtitle extraction, HDHomeRun closed captions, caption alignment and appearance, and audio language preferences. See [Audio & Subtitles](../ffmpeg/index.md#audio-subtitles) for details.

The optional WebVTT Sidecar Subtitles feature is also here, with its own Save button. These settings keep their existing scope; this tab does not introduce new global channel defaults.

Closed-caption delivery is fixed when the channel's HLS session starts. Stop all viewers and tune in again after changing that switch. Caption alignment, appearance, test pattern and audio language preferences are read by the next program pipeline. See [when settings take effect](applies-when.md) for every group.
