# Settings grouped by task (S1)

Settings now has seven tabs: General, Playback, Captions & audio, Guide, Tuner, Library, and Experimental. Each tab explains its purpose under its heading.

Playback contains FFmpeg paths and logging, HLS settings, the HDR tone-map curve and its feature switch, hardware escape hatches, and transcode configs. Caption extraction, HDHomeRun captions and appearance, audio language preferences, and optional WebVTT subtitles live under Captions & audio. Other feature flags stay under Experimental. Existing settings endpoints and save behavior are preserved.

Bookmarks to the former FFmpeg, XMLTV, HDHR, Scanner, and Features routes redirect to their new homes, including transcode-config creation and edit links. The documentation sidebar and route coverage use the same grouping.

Design: [S1 in the approved UI audit](../../../plans/ui-primitives-and-settings-audit-2026-10-19.md), approved in fork PR #85. This row adds no missing S2 fields or global channel-default model.
