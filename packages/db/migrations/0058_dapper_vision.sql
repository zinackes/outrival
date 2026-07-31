ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'pricing_probe' BEFORE 'docs';--> statement-breakpoint
CREATE TABLE "calculator_specs" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"url" text NOT NULL,
	"spec" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"heal_count" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_validated_at" timestamp,
	"last_heal_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calculator_probe_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"url" text NOT NULL,
	"strategy" text DEFAULT 'none' NOT NULL,
	"anchor_screenshot_key" text,
	"outcome" text NOT NULL,
	"detail" text,
	"meter_unit" text DEFAULT '' NOT NULL,
	"readings" integer DEFAULT 0 NOT NULL,
	"points_written" integer DEFAULT 0 NOT NULL,
	"healed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_points" ADD COLUMN "evidence_key" text;--> statement-breakpoint
ALTER TABLE "price_points" ADD COLUMN "evidence_kind" text;--> statement-breakpoint
CREATE UNIQUE INDEX "calculator_specs_competitor_idx" ON "calculator_specs" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "calculator_probe_runs_recorded_idx" ON "calculator_probe_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "calculator_probe_runs_competitor_recorded_idx" ON "calculator_probe_runs" USING btree ("competitor_id","recorded_at");