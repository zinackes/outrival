ALTER TABLE "ai_runs" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "competitor_id" text;--> statement-breakpoint
CREATE INDEX "ai_runs_org_recorded_idx" ON "ai_runs" USING btree ("org_id","recorded_at");