CREATE TABLE `tracking_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_hash` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracking_sessions_expiry` ON `tracking_sessions` (`expires_at`);