CREATE TABLE `technology_deep_analysis_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`technology_id` text NOT NULL,
	`technology_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`verified_through` text,
	`analysis_model` text,
	`resolution_note` text,
	`source_count` integer DEFAULT 0 NOT NULL,
	`result_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technology_deep_analysis_requests_technology_unique` ON `technology_deep_analysis_requests` (`technology_id`);--> statement-breakpoint
CREATE INDEX `technology_deep_analysis_requests_status_updated_idx` ON `technology_deep_analysis_requests` (`status`,`updated_at`);