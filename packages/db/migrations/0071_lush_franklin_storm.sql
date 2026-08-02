CREATE TABLE "messaging_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"h1" text,
	"subheadline" text,
	"primary_cta" text,
	"value_props" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_at" timestamp NOT NULL,
	"snapshot_key" text
);
--> statement-breakpoint
ALTER TABLE "messaging_versions" ADD CONSTRAINT "messaging_versions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_versions_competitor_captured_uk" ON "messaging_versions" USING btree ("competitor_id","captured_at");