ALTER TABLE "pricing_history" ADD COLUMN "has_trial" integer;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "trial_days" integer;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "trial_requires_card" integer;