ALTER TYPE "public"."category" ADD VALUE 'partnerships';--> statement-breakpoint
ALTER TYPE "public"."category" ADD VALUE 'ma';--> statement-breakpoint
ALTER TYPE "public"."category" ADD VALUE 'leadership';--> statement-breakpoint
ALTER TYPE "public"."category" ADD VALUE 'security_compliance';--> statement-breakpoint
ALTER TYPE "public"."category" ADD VALUE 'ads';--> statement-breakpoint
ALTER TABLE "changes" ADD COLUMN "suppression_reason" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "materiality" jsonb;