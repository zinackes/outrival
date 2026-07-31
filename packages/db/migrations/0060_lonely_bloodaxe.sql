-- Data repair: hand back the rosters stranded by an archived product.
--
-- Archiving a product (DELETE /api/products/:id) used to leave its product_competitors
-- rows in place. A competitor tracked ONLY by that product then belonged to no live
-- product: gone from every product-scoped roster, feed and landscape, untagged on new
-- signals, and yet still counted by the plan's competitor cap. Billed, unreachable.
--
-- Same three steps the runtime now performs on archive (releaseProductRoster), applied
-- once over rows already in this state. No schema change.
--
-- Hand-written rather than generated: `drizzle-kit generate` only diffs the SCHEMA, and
-- there is nothing to diff here. It is registered in _journal.json like any other so the
-- migrator runs it exactly once per environment.

INSERT INTO "product_competitors" ("product_id", "competitor_id", "relevance_score")
SELECT o."product_id", o."competitor_id", c."overlap_score"
FROM (
  WITH fallback AS (
    SELECT DISTINCT ON (p."org_id") p."org_id", p."id"
    FROM "products" p
    WHERE p."status" <> 'archived'
    ORDER BY p."org_id", p."is_primary" DESC, p."position" ASC, p."created_at" ASC
  )
  SELECT DISTINCT pc."competitor_id", f."id" AS "product_id"
  FROM "product_competitors" pc
  JOIN "products" a ON a."id" = pc."product_id" AND a."status" = 'archived'
  JOIN fallback f ON f."org_id" = a."org_id"
  WHERE NOT EXISTS (
    SELECT 1
    FROM "product_competitors" pc2
    JOIN "products" p2 ON p2."id" = pc2."product_id"
    WHERE pc2."competitor_id" = pc."competitor_id"
      AND p2."org_id" = a."org_id"
      AND p2."status" <> 'archived'
  )
) o
JOIN "competitors" c ON c."id" = o."competitor_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DELETE FROM "product_competitors" pc
USING "products" p
WHERE p."id" = pc."product_id" AND p."status" = 'archived';
--> statement-breakpoint

-- Past signals still address the archived product, so they would stay out of every
-- product feed. Rebuild the tag from the junction as repaired above — the same set
-- generate-signal computes today.
UPDATE "signals" s
SET "product_ids" = COALESCE((
  SELECT jsonb_agg(pc."product_id" ORDER BY p."is_primary" DESC, p."position" ASC, p."created_at" ASC)
  FROM "product_competitors" pc
  JOIN "products" p ON p."id" = pc."product_id"
  WHERE pc."competitor_id" = s."competitor_id"
    AND p."org_id" = s."org_id"
    AND p."status" <> 'archived'
), '[]'::jsonb)
WHERE EXISTS (SELECT 1 FROM "products" WHERE "status" = 'archived')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(s."product_ids") AS t(v)
    LEFT JOIN "products" pa ON pa."id" = t.v
    WHERE pa."id" IS NULL OR pa."status" = 'archived'
  );
