ALTER TABLE "competitor_candidates" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "competitor_candidates" ADD CONSTRAINT "competitor_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_candidates_product_idx" ON "competitor_candidates" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_runs_org_product_uq" ON "discovery_runs" USING btree ("org_id","product_id");--> statement-breakpoint
-- Backfill: attach pre-existing discovery rows to the org's primary product (the
-- profile that drove the org-level discovery before patch-28 made it product-aware).
UPDATE "competitor_candidates" cc
SET "product_id" = (
  SELECT p."id" FROM "products" p
  WHERE p."org_id" = cc."org_id"
  ORDER BY p."is_primary" DESC, p."position" ASC, p."created_at" ASC
  LIMIT 1
)
WHERE cc."product_id" IS NULL;--> statement-breakpoint
UPDATE "discovery_runs" dr
SET "product_id" = (
  SELECT p."id" FROM "products" p
  WHERE p."org_id" = dr."org_id"
  ORDER BY p."is_primary" DESC, p."position" ASC, p."created_at" ASC
  LIMIT 1
)
WHERE dr."product_id" IS NULL;