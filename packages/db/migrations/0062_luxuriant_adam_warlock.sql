ALTER TYPE "public"."source_type" ADD VALUE 'hiring_footprint' BEFORE 'hackernews';--> statement-breakpoint
CREATE TABLE "hiring_geo" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"country_code" text NOT NULL,
	"open_count" integer NOT NULL,
	"week_start" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "country_codes" text[];--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "geo_resolution" text;--> statement-breakpoint
CREATE UNIQUE INDEX "hiring_geo_competitor_country_week_uk" ON "hiring_geo" USING btree ("competitor_id","country_code","week_start");--> statement-breakpoint
CREATE INDEX "hiring_geo_competitor_recorded_idx" ON "hiring_geo" USING btree ("competitor_id","recorded_at");