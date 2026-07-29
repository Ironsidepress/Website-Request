CREATE TABLE `intake_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`revision` integer NOT NULL,
	`section_id` text NOT NULL,
	`section_data` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_intake_revisions_unique` ON `intake_revisions` (`intake_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_intake_revisions_org` ON `intake_revisions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`schema_version` integer NOT NULL,
	`data` text NOT NULL,
	`current_revision` integer DEFAULT 0 NOT NULL,
	`submitted_at` text,
	`submitted_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_intakes_org` ON `intakes` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_intakes_one_draft` ON `intakes` (`organization_id`) WHERE status = 'draft';