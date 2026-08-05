ALTER TABLE "snapshots" ADD COLUMN "completeness" double precision;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "observed_region" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "final_url" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "http_status" integer;