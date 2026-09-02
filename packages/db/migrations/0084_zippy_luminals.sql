-- Missing indexes and constraints on the hot tables (OUT-268).
--
-- Every CREATE INDEX here is IF NOT EXISTS on purpose. The runtime migrator
-- (src/migrate.ts) wraps each file in a transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside one (code:PER-53) — so on a populated
-- environment the four plain indexes are built out of band FIRST, with
--   pnpm --filter @outrival/db db:index-hot
-- and this migration then finds them already there and does nothing. On a fresh
-- or small environment, skip that step: the tables are empty and the lock is
-- instant. Either way the end state is identical, which is why the definitions
-- in src/create-hot-indexes.ts are kept byte-identical to the ones below.
--
-- The two UNIQUE indexes stay in here: they carry a data precondition (the
-- dedupe/demote right above each), and both tables are small enough that the
-- lock is not worth a second code path.
DELETE FROM "calculator_specs" a
WHERE NOT EXISTS (SELECT 1 FROM "competitors" c WHERE c."id" = a."competitor_id");--> statement-breakpoint
-- Orphans first: the column has been text-with-no-FK since the table was
-- created, so a deleted competitor left its calculator recipe behind and the FK
-- would refuse to validate against those rows. Small table, so a plain validating
-- ADD CONSTRAINT rather than NOT VALID + a separate VALIDATE pass.
ALTER TABLE "calculator_specs" ADD CONSTRAINT "calculator_specs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- At most one primary product per org. Any org that already has two (the race in
-- code:COR-07 produced them) keeps the one the product selector would have shown
-- anyway: lowest position, then oldest.
UPDATE "products" a
SET "is_primary" = false, "updated_at" = now()
FROM "products" b
WHERE a."org_id" = b."org_id"
  AND a."is_primary" AND b."is_primary"
  AND (a."position", a."created_at", a."id") > (b."position", b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_org_primary_uq" ON "products" USING btree ("org_id") WHERE "products"."is_primary";--> statement-breakpoint
-- One verdict per (user, target). Duplicates from the read-then-branch writers
-- collapse to the latest verdict, which is the one the user last expressed.
DELETE FROM "quality_feedback" a
USING "quality_feedback" b
WHERE a."user_id" = b."user_id"
  AND a."target_type" = b."target_type"
  AND a."target_id" = b."target_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");--> statement-breakpoint
DROP INDEX IF EXISTS "quality_feedback_user_target_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quality_feedback_user_target_uq" ON "quality_feedback" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "changes_snapshot_before_idx" ON "changes" USING btree ("snapshot_before_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_product_ids_gin" ON "signals" USING gin ("product_ids");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_quality_checks_created_idx" ON "ai_quality_checks" USING btree ("created_at");
