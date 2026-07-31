ALTER TYPE "public"."source_type" ADD VALUE 'job_facts' BEFORE 'hackernews';--> statement-breakpoint
CREATE TABLE "posting_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"posting_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"value_key" text NOT NULL,
	"evidence_snippet" text NOT NULL,
	"confidence" double precision,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"signalled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "description_text" text;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "remote_mode" text;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "facts_mined_at" timestamp;--> statement-breakpoint
ALTER TABLE "posting_facts" ADD CONSTRAINT "posting_facts_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_facts" ADD CONSTRAINT "posting_facts_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posting_facts_posting_kind_value_idx" ON "posting_facts" USING btree ("posting_id","kind","value_key");--> statement-breakpoint
CREATE INDEX "posting_facts_competitor_kind_idx" ON "posting_facts" USING btree ("competitor_id","kind","value_key");--> statement-breakpoint
CREATE INDEX "posting_facts_signalled_idx" ON "posting_facts" USING btree ("competitor_id","signalled_at");