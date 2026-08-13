CREATE TABLE "oauth_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp,
	"account_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_org_provider_idx" ON "oauth_connections" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "oauth_connections_org_idx" ON "oauth_connections" USING btree ("org_id");