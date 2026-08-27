CREATE TABLE `research_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`summary` text NOT NULL,
	`market` text NOT NULL,
	`related_brand_ids` text NOT NULL,
	`sources` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ideas` ADD `research_note_id` integer;