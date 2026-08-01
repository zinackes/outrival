ALTER TYPE "public"."source_type" ADD VALUE 'shipping_velocity' BEFORE 'docs';--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"source_type" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"published_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"item_type" text,
	"status" text,
	"topics" text[],
	"products" text[],
	"personas" text[],
	"competitors_named" text[],
	"summary" text,
	"evidence_snippet" text,
	"confidence" double precision,
	"enriched_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_competitor_source_external_idx" ON "content_items" USING btree ("competitor_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "content_items_competitor_source_published_idx" ON "content_items" USING btree ("competitor_id","source_type","published_at");--> statement-breakpoint
CREATE INDEX "content_items_competitor_first_seen_idx" ON "content_items" USING btree ("competitor_id","first_seen_at");