CREATE TABLE `project_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`workflow_instance_id` text,
	`client_visible` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_history_project` ON `project_stage_history` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`intake_id` text NOT NULL,
	`name` text NOT NULL,
	`current_stage` text DEFAULT 'created' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text DEFAULT 'ok' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_projects_org` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_stage` ON `projects` (`current_stage`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_intake` ON `projects` (`intake_id`);--> statement-breakpoint
CREATE TABLE `workflow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`workflow_run_id` text,
	`type` text NOT NULL,
	`schema_version` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wfevents_idempotency` ON `workflow_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_wfevents_project` ON `workflow_events` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`workflow_name` text NOT NULL,
	`cf_instance_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wfruns_instance` ON `workflow_runs` (`cf_instance_id`);--> statement-breakpoint
CREATE INDEX `idx_wfruns_project` ON `workflow_runs` (`project_id`);