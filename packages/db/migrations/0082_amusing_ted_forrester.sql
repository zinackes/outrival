ALTER TABLE "signals" ADD COLUMN "is_important" boolean;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "importance_reason" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "matched_condition_ids" jsonb;