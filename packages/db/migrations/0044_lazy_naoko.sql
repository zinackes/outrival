ALTER TABLE "monitors" ADD COLUMN "egress_tier" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "refused_at" timestamp;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "refusal_reason" text;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "refused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "refusal_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Collection doctrine data migration: the residential (3) and Camoufox (4) cascade
-- levels are gone. Any monitor that ONLY passed via those tiers (G2, Capterra, …) is
-- now legitimately unavailable — clear its pinned level and mark it unscrapable; the
-- next scrape records an honest refusal. This is the expected behaviour, not a bug.
UPDATE "monitors" SET "requires_level" = NULL, "marked_unscrapable" = true WHERE "requires_level" IN (3, 4);