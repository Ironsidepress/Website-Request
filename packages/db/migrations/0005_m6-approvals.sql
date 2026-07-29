CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`gate` text NOT NULL,
	`stage_attempt` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`required_roles` text NOT NULL,
	`artifact_refs` text NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`decision_reason` text,
	`workflow_instance_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_approvals_pending` ON `approvals` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_approvals_project` ON `approvals` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_approvals_one_pending` ON `approvals` (`project_id`,`gate`) WHERE status = 'pending';