CREATE TABLE "ai_visibility_teasers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"engine" text,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_teasers" ADD CONSTRAINT "ai_visibility_teasers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visibility_teasers_org_uq" ON "ai_visibility_teasers" USING btree ("org_id");