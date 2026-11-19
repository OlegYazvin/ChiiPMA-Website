CREATE TABLE `qr_reservations` (
	`slot` integer PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`name` text NOT NULL,
	`claimed` integer NOT NULL,
	`nonce` text NOT NULL,
	`token_hash` text NOT NULL,
	`roster_version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qr_reservation_token_idx` ON `qr_reservations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `qr_reservation_person_idx` ON `qr_reservations` (`participant_id`);