ALTER TYPE "public"."source_type" ADD VALUE 'shopify_reviews' BEFORE 'trustpilot_public';--> statement-breakpoint
ALTER TYPE "public"."review_source" ADD VALUE 'shopify';