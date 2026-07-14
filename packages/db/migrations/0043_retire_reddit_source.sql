-- Retire the `reddit` source (legal: Reddit's Public Content Policy forbids
-- commercial use without a licence; the free-tier OAuth app creds are unobtainable
-- under the Responsible Builder Policy). Drops `reddit` from source_type + `reddit`
-- from review_source. NOT APPLIED TO PROD in this patch (apply on staging first,
-- backup prod before running — see .claude/rules/production.md §3).
--
-- Safety net (idempotent, no-op when zero rows): reddit shipped DISABLED and could
-- never be enabled, so in practice no rows carry it. But Postgres cannot drop an enum
-- value while a row still holds it — the `USING …::source_type` casts below would fail.
-- So first remove any straggler reddit rows, in FK-dependency order (alerts→signals→
-- changes→monitors are RESTRICT; snapshots/etc. cascade off monitors). This also
-- invalidates any false reddit signals a past dead-endpoint scrape may have produced.
DELETE FROM "alerts" WHERE "signal_id" IN (
  SELECT s."id" FROM "signals" s
  JOIN "changes" c ON c."id" = s."change_id"
  JOIN "monitors" m ON m."id" = c."monitor_id"
  WHERE m."source_type" = 'reddit'
);--> statement-breakpoint
DELETE FROM "signals" WHERE "change_id" IN (
  SELECT c."id" FROM "changes" c
  JOIN "monitors" m ON m."id" = c."monitor_id"
  WHERE m."source_type" = 'reddit'
);--> statement-breakpoint
DELETE FROM "changes" WHERE "monitor_id" IN (
  SELECT "id" FROM "monitors" WHERE "source_type" = 'reddit'
);--> statement-breakpoint
DELETE FROM "monitors" WHERE "source_type" = 'reddit';--> statement-breakpoint
DELETE FROM "reviews" WHERE "source" = 'reddit';--> statement-breakpoint
DELETE FROM "parser_extractors" WHERE "source_type" = 'reddit';--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "parser_extractors" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."source_type";--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('homepage', 'pricing', 'blog', 'changelog', 'jobs', 'g2_reviews', 'capterra_reviews', 'appstore_reviews', 'trustpilot_reviews', 'trustradius_reviews', 'gartner_reviews', 'playstore_reviews', 'linkedin', 'twitter', 'github_repo', 'tech_stack', 'status', 'sitemap', 'news', 'ai_visibility', 'subdomains', 'youtube', 'review_shift', 'hiring_shift', 'hackernews', 'wellknown', 'comparison_page', 'custom');--> statement-breakpoint
ALTER TABLE "monitors" ALTER COLUMN "source_type" SET DATA TYPE "public"."source_type" USING "source_type"::"public"."source_type";--> statement-breakpoint
ALTER TABLE "parser_extractors" ALTER COLUMN "source_type" SET DATA TYPE "public"."source_type" USING "source_type"::"public"."source_type";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."review_source";--> statement-breakpoint
CREATE TYPE "public"."review_source" AS ENUM('g2', 'capterra', 'appstore', 'playstore', 'trustpilot', 'trustradius', 'gartner');--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "source" SET DATA TYPE "public"."review_source" USING "source"::"public"."review_source";
