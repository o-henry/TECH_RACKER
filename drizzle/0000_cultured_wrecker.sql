CREATE TABLE `technology_research_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`normalized_query` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_technology_id` text,
	`resolution_note` text,
	`source_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technology_research_requests_normalized_query_unique` ON `technology_research_requests` (`normalized_query`);