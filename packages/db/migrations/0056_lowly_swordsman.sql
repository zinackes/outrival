CREATE TABLE "price_points" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"meter_unit" text NOT NULL,
	"reference_qty" double precision NOT NULL,
	"effective_monthly_cost" double precision NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"unit" text,
	"from_qty" double precision NOT NULL,
	"to_qty" double precision,
	"unit_price" double precision,
	"flat_fee" double precision,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "rate_structure" text;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "minimum_amount" double precision;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD COLUMN "percentage_rate" double precision;--> statement-breakpoint
CREATE INDEX "price_points_competitor_recorded_idx" ON "price_points" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "price_points_competitor_unit_idx" ON "price_points" USING btree ("competitor_id","meter_unit");--> statement-breakpoint
CREATE INDEX "price_tiers_competitor_recorded_idx" ON "price_tiers" USING btree ("competitor_id","recorded_at");--> statement-breakpoint
CREATE INDEX "price_tiers_competitor_plan_idx" ON "price_tiers" USING btree ("competitor_id","plan_name");