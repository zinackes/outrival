ALTER TABLE "parser_extractors" ADD COLUMN "consecutive_heal_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "error_kind" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;