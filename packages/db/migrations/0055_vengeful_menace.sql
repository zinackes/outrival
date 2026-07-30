CREATE TABLE "plan_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"feature_slug" text NOT NULL,
	"feature_label" text NOT NULL,
	"kind" text NOT NULL,
	"value_num" double precision,
	"value_text" text,
	"unit" text,
	"reset_period" text,
	"is_canonical" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "plan_entitlements_competitor_recorded_idx" ON "plan_entitlements" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "plan_entitlements_competitor_feature_idx" ON "plan_entitlements" USING btree ("competitor_id","feature_slug");