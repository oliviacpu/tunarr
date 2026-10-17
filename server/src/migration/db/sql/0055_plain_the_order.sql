CREATE TABLE `program_audio_loudness` (
	`program_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`integrated` real,
	`true_peak` real,
	`range` real,
	`error` text,
	`measured_at` integer NOT NULL,
	PRIMARY KEY(`program_id`, `stream_index`),
	FOREIGN KEY (`program_id`) REFERENCES `program`(`uuid`) ON UPDATE no action ON DELETE cascade
);
