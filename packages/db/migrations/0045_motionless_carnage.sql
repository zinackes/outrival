-- Reviews v2 (2026-07-15) — retire the scraped review aggregators for legal reasons
-- ("⚖️ Collection doctrine"). G2/Capterra/Trustpilot/TrustRadius/Gartner/Play Store
-- forbid scraping AND commercial use in their ToS and license their review data as a
-- product (G2 sells syndication; Crayon/Klue pay for it), so scraping them is unfair
-- competition + a sui-generis DB-right breach.
--
-- NOT APPLIED TO PROD in this patch — apply on staging first, back up prod before
-- running (see .claude/rules/production.md §3).
--
-- Two changes:
--  1. Enum: ADD `trustpilot_public` (the surface-only official-API replacement) and
--     `appstore_reviews` stays. The retired values are DELIBERATELY KEPT in the enum
--     (drizzle drops+recreates the type because of the reorder, but every prior value
--     is retained) so existing monitor rows stay valid and can be marked unscrapable
--     below rather than cascade-deleted — history (their snapshots/changes/signals) is
--     preserved. `g2_reviews` may return later via the customer's own connected G2
--     vendor account; never via scraping.
--  2. Data: mark every existing monitor on a retired aggregator source as
--     marked_unscrapable + refusal_reason='source_retired_legal' and deactivate it so
--     schedule-scraping never enqueues it again. App Store + Trustpilot public are
--     untouched.
ALTER TABLE "monitors" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "parser_extractors" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."source_type";--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('homepage', 'pricing', 'blog', 'changelog', 'jobs', 'appstore_reviews', 'trustpilot_public', 'g2_reviews', 'capterra_reviews', 'trustpilot_reviews', 'trustradius_reviews', 'gartner_reviews', 'playstore_reviews', 'linkedin', 'twitter', 'github_repo', 'tech_stack', 'status', 'sitemap', 'news', 'ai_visibility', 'subdomains', 'youtube', 'review_shift', 'hiring_shift', 'hackernews', 'wellknown', 'comparison_page', 'custom');--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "source_type" SET DATA TYPE "public"."source_type" USING "source_type"::"public"."source_type";--> statement-breakpoint
ALTER TABLE "parser_extractors" ALTER COLUMN "source_type" SET DATA TYPE "public"."source_type" USING "source_type"::"public"."source_type";--> statement-breakpoint
UPDATE "monitors"
SET "marked_unscrapable" = true,
    "is_active" = false,
    "refused_at" = now(),
    "refusal_reason" = 'source_retired_legal'
WHERE "source_type" IN (
  'g2_reviews', 'capterra_reviews', 'trustpilot_reviews',
  'trustradius_reviews', 'gartner_reviews', 'playstore_reviews'
);
