ALTER TYPE "public"."source_type" ADD VALUE 'customer_proof' BEFORE 'docs';--> statement-breakpoint
CREATE TABLE "case_studies" (
	"id" text PRIMARY KEY NOT NULL,
	"content_item_id" text,
	"competitor_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"customer_name" text,
	"customer_industry" text,
	"customer_industry_label" text,
	"is_canonical_industry" integer DEFAULT 0 NOT NULL,
	"use_case" text,
	"metrics_claimed" text[],
	"confidence" double precision,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"name_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"source" text NOT NULL,
	"evidence_url" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_customers" ADD CONSTRAINT "known_customers_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_studies_competitor_url_uk" ON "case_studies" USING btree ("competitor_id","url");--> statement-breakpoint
CREATE INDEX "case_studies_competitor_recorded_idx" ON "case_studies" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "known_customers_competitor_name_uk" ON "known_customers" USING btree ("competitor_id","name_normalized");--> statement-breakpoint
CREATE INDEX "known_customers_competitor_seen_idx" ON "known_customers" USING btree ("competitor_id","first_seen_at");