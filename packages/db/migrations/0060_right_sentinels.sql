CREATE TABLE "credit_burn_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"action" text NOT NULL,
	"credits" double precision NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_tiers" ADD COLUMN "origin" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "origin" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_burn_rates_competitor_recorded_idx" ON "credit_burn_rates" USING btree ("competitor_id","recorded_at");