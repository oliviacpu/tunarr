ALTER TABLE `channel` ADD `subtitle_preference_mode` text DEFAULT 'inherit' NOT NULL;
--> statement-breakpoint
UPDATE `channel`
SET `subtitle_preference_mode` = 'custom'
WHERE EXISTS (
  SELECT 1 FROM `channel_subtitle_preferences`
  WHERE `channel_subtitle_preferences`.`channel_id` = `channel`.`uuid`
);
