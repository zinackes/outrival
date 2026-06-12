ALTER TABLE "competitors" ADD COLUMN "monitoring_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "alerts_muted" boolean DEFAULT false NOT NULL;