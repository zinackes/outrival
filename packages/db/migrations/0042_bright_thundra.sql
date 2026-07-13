ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'wellknown' BEFORE 'custom';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'comparison_page' BEFORE 'custom';--> statement-breakpoint
ALTER TYPE "public"."category" ADD VALUE IF NOT EXISTS 'api_developer';
