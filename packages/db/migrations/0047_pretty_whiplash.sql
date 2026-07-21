ALTER TABLE "signals" ADD COLUMN "faithfulness" jsonb;--> statement-breakpoint
ALTER TABLE "digests" ADD COLUMN "faithfulness" jsonb;--> statement-breakpoint
ALTER TABLE "battle_cards" ADD COLUMN "faithfulness" jsonb;--> statement-breakpoint
ALTER TABLE "ai_quality_checks" ADD COLUMN "faithfulness" jsonb;