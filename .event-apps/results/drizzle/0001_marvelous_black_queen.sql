CREATE TABLE `conversation_responses` (
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`participant_id` text NOT NULL,
	`rating` text NOT NULL,
	`stay_in_touch` integer NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `round`, `participant_id`)
);
--> statement-breakpoint
CREATE INDEX `response_person_idx` ON `conversation_responses` (`run_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `event_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state_json` text NOT NULL,
	`access_open` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participant_contacts` (
	`link_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participant_links` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`name` text NOT NULL,
	`nonce` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_token_idx` ON `participant_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `participant_name_idx` ON `participant_links` (`run_id`,`name`,`active`);--> statement-breakpoint
CREATE TABLE `round_timers` (
	`run_id` text NOT NULL,
	`round` integer NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`remaining_ms` integer NOT NULL,
	`deadline_at` integer,
	PRIMARY KEY(`run_id`, `round`)
);
