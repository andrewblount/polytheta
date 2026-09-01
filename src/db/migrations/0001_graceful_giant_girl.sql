ALTER TABLE "user_profiles" ADD COLUMN "starting_capital" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "tracking_start_date" date;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "notification_prefs" jsonb;
