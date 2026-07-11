ALTER TYPE "public"."notification_type" ADD VALUE 'standing_query';--> statement-breakpoint
CREATE TABLE "standing_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"context" jsonb,
	"watched_competitor_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watched_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_severity" "severity" DEFAULT 'low' NOT NULL,
	"cooldown_hours" integer DEFAULT 6 NOT NULL,
	"current_answer" text NOT NULL,
	"current_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_hash" text NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"last_evaluated_at" timestamp,
	"last_alerted_at" timestamp,
	"last_change_summary" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "standing_queries" ADD CONSTRAINT "standing_queries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_queries" ADD CONSTRAINT "standing_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standing_queries_org_active_idx" ON "standing_queries" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "standing_queries_org_user_idx" ON "standing_queries" USING btree ("org_id","user_id");