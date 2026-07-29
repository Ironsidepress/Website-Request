CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`intake_id` text,
	`project_id` text,
	`r2_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum_sha256` text,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_r2_key` ON `files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_files_org` ON `files` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_files_intake` ON `files` (`intake_id`);