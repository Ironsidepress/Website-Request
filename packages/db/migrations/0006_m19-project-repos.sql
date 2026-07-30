-- M19 (ADR-0018): per-project code repository.
--
-- Each project's generated website lives in its own repository; the developer
-- agent pushes feature branches and opens pull requests there and can never
-- push to its default branch. Both columns stay null until the developer
-- stage provisions the repository.
ALTER TABLE `projects` ADD `repo_full_name` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `repo_url` text;