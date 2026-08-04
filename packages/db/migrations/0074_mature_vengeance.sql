ALTER TYPE "public"."source_type" ADD VALUE 'audience_page' BEFORE 'docs';--> statement-breakpoint
CREATE TABLE "audience_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"is_canonical" integer DEFAULT 0 NOT NULL,
	"evidence_url" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_pages" ADD CONSTRAINT "audience_pages_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_pages_competitor_kind_slug_uk" ON "audience_pages" USING btree ("competitor_id","kind","slug");--> statement-breakpoint
CREATE INDEX "audience_pages_competitor_seen_idx" ON "audience_pages" USING btree ("competitor_id","first_seen_at");