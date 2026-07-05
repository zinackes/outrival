ALTER TABLE "ai_visibility_prompts" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "ai_visibility_results" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_visibility_prompts_org_product_idx" ON "ai_visibility_prompts" USING btree ("org_id","product_id");--> statement-breakpoint
CREATE INDEX "ai_visibility_results_org_product_recorded_idx" ON "ai_visibility_results" USING btree ("org_id","product_id","recorded_at");--> statement-breakpoint
-- Backfill (multi-SKU phase B): attach existing org-level prompts to the org's primary
-- product. Mirrors primaryProductId(): non-archived, primary flag → position → age.
-- ai_visibility_results rows are intentionally NOT backfilled — a historical row maps
-- ambiguously to a product (shared competitors, differing self); per-product reads
-- filter by product_id and simply ignore the legacy null rows, and the trend rebuilds
-- from the next per-product run.
UPDATE "ai_visibility_prompts" p SET "product_id" = (
  SELECT pr."id" FROM "products" pr
  WHERE pr."org_id" = p."org_id" AND pr."status" <> 'archived'
  ORDER BY pr."is_primary" DESC, pr."position" ASC, pr."created_at" ASC
  LIMIT 1
) WHERE p."product_id" IS NULL;