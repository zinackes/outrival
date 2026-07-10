CREATE TABLE "backfill_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"monitor_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"source_type" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"archives_seeded" integer DEFAULT 0 NOT NULL,
	"change_triggered" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backfill_runs_recorded_idx" ON "backfill_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "backfill_runs_competitor_recorded_idx" ON "backfill_runs" USING btree ("competitor_id","recorded_at");