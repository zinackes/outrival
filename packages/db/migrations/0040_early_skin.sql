ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'hiring_shift' BEFORE 'custom';--> statement-breakpoint
CREATE TABLE "hiring_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"department_bucket" text NOT NULL,
	"open_count" integer NOT NULL,
	"week_start" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hiring_metrics_competitor_bucket_week_uk" ON "hiring_metrics" USING btree ("competitor_id","department_bucket","week_start");--> statement-breakpoint
CREATE INDEX "hiring_metrics_competitor_recorded_idx" ON "hiring_metrics" USING btree ("competitor_id","recorded_at");