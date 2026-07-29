CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`agent_type` text NOT NULL,
	`contract_version` integer NOT NULL,
	`prompt_version` text NOT NULL,
	`input_artifacts` text NOT NULL,
	`output_artifacts` text,
	`model` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost_usd` real,
	`error_detail` text,
	`idempotency_key` text NOT NULL,
	`transcript_r2_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_runs_idempotency` ON `agent_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_agent_runs_project` ON `agent_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`storage` text NOT NULL,
	`content` text,
	`r2_key` text,
	`external_ref` text,
	`has_unverified_claims` integer DEFAULT false NOT NULL,
	`created_by_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `version`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_project` ON `artifacts` (`project_id`,`type`,`status`);