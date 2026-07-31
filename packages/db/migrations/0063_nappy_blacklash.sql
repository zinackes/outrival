ALTER TYPE "public"."source_type" ADD VALUE 'hiring_salary' BEFORE 'hackernews';--> statement-breakpoint
CREATE TABLE "hiring_salary_bands" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"department_bucket" text NOT NULL,
	"currency" text NOT NULL,
	"p25" integer NOT NULL,
	"p50" integer NOT NULL,
	"p75" integer NOT NULL,
	"n" integer NOT NULL,
	"week_start" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "salary_period" text;--> statement-breakpoint
CREATE UNIQUE INDEX "hiring_salary_bands_competitor_bucket_currency_week_uk" ON "hiring_salary_bands" USING btree ("competitor_id","department_bucket","currency","week_start");--> statement-breakpoint
CREATE INDEX "hiring_salary_bands_competitor_recorded_idx" ON "hiring_salary_bands" USING btree ("competitor_id","recorded_at");