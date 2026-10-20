# Missing settings controls (S2)

Playback exposes the existing scaling algorithm and deinterlace filter. General exposes rolled-file retention, temporary backup directories, editable backup cron expressions, and enable switches for each configured backup schedule. Library exposes search snapshot intervals and indexing memory limits with a restart-required badge. Clearing the memory input restores the automatic limit.

These controls use existing persistence fields and settings APIs; this row adds no schema, dependency, or global audio/subtitle-default model. Per-field browser roundtrips verify that unrelated settings stay unchanged.

Design: S2 in the approved UI audit, approved in fork PR #85.
