CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_item_id` integer NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`provider_job_id` text,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`niche` text NOT NULL,
	`market` text NOT NULL,
	`language` text DEFAULT 'es' NOT NULL,
	`voice` text,
	`platforms` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idea_id` integer,
	`brand_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`platform` text NOT NULL,
	`format` text NOT NULL,
	`caption` text,
	`script` text,
	`provider` text DEFAULT 'higgsfield' NOT NULL,
	`status` text DEFAULT 'drafted' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` text NOT NULL,
	`title` text NOT NULL,
	`angle` text NOT NULL,
	`format` text NOT NULL,
	`source_note` text,
	`citations` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_item_id` integer NOT NULL,
	`platform` text NOT NULL,
	`platform_post_id` text,
	`posted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`permalink` text
);
