CREATE TABLE `event_state` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL
);
