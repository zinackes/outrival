CREATE TABLE "named_competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"name_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"named_domain" text,
	"source" text NOT NULL,
	"evidence_url" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"signalled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "named_competitors" ADD CONSTRAINT "named_competitors_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "named_competitors_competitor_name_source_uk" ON "named_competitors" USING btree ("competitor_id","name_normalized","source");--> statement-breakpoint
CREATE INDEX "named_competitors_competitor_seen_idx" ON "named_competitors" USING btree ("competitor_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "named_competitors_name_idx" ON "named_competitors" USING btree ("name_normalized");