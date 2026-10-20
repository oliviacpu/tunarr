# Settings grouped by task (S1)

Settings now has seven tabs: General, Playback, Captions & audio, Guide, Tuner, Library, and Experimental. Each tab explains its purpose under its heading.

Playback contains FFmpeg paths and logging, HLS settings, the HDR tone-map curve and its feature switch, hardware escape hatches, and transcode configs. Caption extraction, HDHomeRun captions and appearance, audio language preferences, and optional WebVTT subtitles live under Captions & audio. Other feature flags stay under Experimental. Optional feature settings load and fail independently so the core Playback and Captions & audio forms stay available, and failed flag loads can be retried in place. Background refetch errors keep cached forms and unsaved flag edits visible, with a warning. The server-environment query only runs inside Playback’s executable-path section; Captions & audio does not depend on it. Cached server-environment data keeps executable paths editable if a background refresh fails. Core and optional forms share one page-level unsaved-changes guard while retaining independent save/reset buttons. Existing settings endpoints and save behavior are preserved.

Bookmarks to the former FFmpeg, XMLTV, HDHR, Scanner, and Features routes redirect to their new homes, including transcode-config creation and edit links. The documentation sidebar and route coverage use the same grouping.
The transcode-config breadcrumb points directly to Playback, and channel caption guidance names Captions & audio.
Optional feature saves submit only the active group's fields, preserving newer values changed in another tab. A concurrent Experimental change while saving Playback is covered alongside query-isolation and shared dirty-guard regressions; the breadcrumb browser check uses the canonical Playback destination.

Design: [S1 in the approved UI audit](../../../plans/ui-primitives-and-settings-audit-2026-10-19.md), approved in fork PR #85. This row adds no missing S2 fields or global channel-default model.
