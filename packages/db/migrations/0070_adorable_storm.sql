ALTER TYPE "public"."source_type" ADD VALUE 'roadmap_shift' BEFORE 'docs';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'integration_catalog' BEFORE 'docs';--> statement-breakpoint
CREATE TABLE "roadmap_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"content_item_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_raw" text,
	"to_raw" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"is_baseline" integer DEFAULT 0 NOT NULL,
	"signalled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "known_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"name_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"evidence_url" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "status_normalized" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "votes" integer;--> statement-breakpoint
ALTER TABLE "roadmap_status_events" ADD CONSTRAINT "roadmap_status_events_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_status_events" ADD CONSTRAINT "roadmap_status_events_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_integrations" ADD CONSTRAINT "known_integrations_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roadmap_status_events_competitor_occurred_idx" ON "roadmap_status_events" USING btree ("competitor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "roadmap_status_events_item_occurred_idx" ON "roadmap_status_events" USING btree ("content_item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "known_integrations_competitor_name_uk" ON "known_integrations" USING btree ("competitor_id","name_normalized");--> statement-breakpoint
CREATE INDEX "known_integrations_competitor_seen_idx" ON "known_integrations" USING btree ("competitor_id","first_seen_at");