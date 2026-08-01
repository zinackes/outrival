CREATE TABLE "ats_coverage_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"host" text NOT NULL,
	"competitor_id" text NOT NULL,
	"resolution" text NOT NULL,
	"job_count" integer NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ats_coverage_gaps_platform_competitor_uk" ON "ats_coverage_gaps" USING btree ("platform","competitor_id");--> statement-breakpoint
CREATE INDEX "ats_coverage_gaps_resolution_idx" ON "ats_coverage_gaps" USING btree ("resolution","last_seen_at");