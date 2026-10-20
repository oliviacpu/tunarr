UPDATE `program_external_id` AS legacy
SET `media_source_id` = (
  SELECT source.uuid FROM media_source AS source
  WHERE source.type = legacy.source_type
    AND (source.uuid = legacy.external_source_id OR source.name = legacy.external_source_id)
)
WHERE legacy.media_source_id IS NULL AND legacy.source_type IN ('plex', 'jellyfin', 'emby');--> statement-breakpoint
UPDATE `program_grouping_external_id` AS legacy
SET `media_source_id` = (
  SELECT source.uuid FROM media_source AS source
  WHERE source.type = legacy.source_type
    AND (source.uuid = legacy.external_source_id OR source.name = legacy.external_source_id)
)
WHERE legacy.media_source_id IS NULL AND legacy.source_type IN ('plex', 'jellyfin', 'emby');--> statement-breakpoint
DROP INDEX `unique_program_multiple_external_id`;--> statement-breakpoint
DROP INDEX `unique_program_single_external_id`;--> statement-breakpoint
ALTER TABLE `program_external_id` DROP COLUMN `external_source_id`;--> statement-breakpoint
ALTER TABLE `program_grouping_external_id` DROP COLUMN `external_source_id`;
