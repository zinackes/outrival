/**
 * patch-28 — one-shot data migration to the multi-product hierarchy.
 *
 * NON-DESTRUCTIVE: every existing org with a self-competitor gets exactly one
 * primary `products` row wrapping that self-competitor (the monitoring anchor is
 * untouched — no delete, no re-parenting). All of the org's competitors are linked
 * to that product via `product_competitors`, and existing battle cards / signals
 * are tagged with the product id. Idempotent: re-running skips orgs that already
 * have a product for their self-competitor and no-ops the associations/tags.
 *
 * Run AFTER `pnpm db:push` (so the products / product_competitors tables and the
 * battle_cards.product_id / signals.product_ids columns exist). Back up the DB
 * first — this writes to production Postgres.
 *
 *   bun run packages/db/src/migrations/patch-28-multi-product.ts
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../client";
import {
  organizations,
  competitors,
  products,
  productCompetitors,
  battleCards,
  signals,
} from "../schema";

export async function migrateToMultiProduct(): Promise<void> {
  console.log("[patch-28] starting multi-product migration…");

  const orgs = await db.query.organizations.findMany({ columns: { id: true, name: true } });
  let migrated = 0;
  let skipped = 0;

  for (const org of orgs) {
    // The org's monitoring anchor. No self-competitor → the org never set up a
    // product; nothing to wrap (it gets one lazily when it does). Skip.
    const self = await db.query.competitors.findFirst({
      where: and(eq(competitors.orgId, org.id), eq(competitors.type, "self")),
    });
    if (!self) {
      skipped++;
      continue;
    }

    // Idempotency: this org's self-competitor already wraps a product.
    const existingProduct = await db.query.products.findFirst({
      where: eq(products.selfCompetitorId, self.id),
    });

    let productId: string;
    if (existingProduct) {
      productId = existingProduct.id;
    } else {
      const [created] = await db
        .insert(products)
        .values({
          orgId: org.id,
          name: self.name || org.name || "My product",
          selfCompetitorId: self.id,
          isPrimary: true,
          status: "active",
          position: 0,
          createdAt: self.createdAt,
        })
        .returning({ id: products.id });
      if (!created) {
        console.warn(`[patch-28] failed to create product for org ${org.id}, skipping`);
        continue;
      }
      productId = created.id;
    }

    // Link every real competitor (non-self, not soft-deleted) to the product,
    // shared (isSpecific=false). relevanceScore seeds from the competitor's overlap.
    const orgCompetitors = await db.query.competitors.findMany({
      where: and(
        eq(competitors.orgId, org.id),
        ne(competitors.type, "self"),
        isNull(competitors.deletedAt),
      ),
      columns: { id: true, overlapScore: true },
    });
    if (orgCompetitors.length > 0) {
      await db
        .insert(productCompetitors)
        .values(
          orgCompetitors.map((c) => ({
            productId,
            competitorId: c.id,
            isSpecific: false,
            relevanceScore: c.overlapScore ?? null,
          })),
        )
        .onConflictDoNothing();
    }

    // Tag existing battle cards (only those not already tagged) and signals.
    await db
      .update(battleCards)
      .set({ productId })
      .where(and(eq(battleCards.orgId, org.id), isNull(battleCards.productId)));

    await db
      .update(signals)
      .set({ productIds: [productId] })
      .where(and(eq(signals.orgId, org.id), sql`${signals.productIds} = '[]'::jsonb`));

    migrated++;
    console.log(`[patch-28] org ${org.id} → product ${productId}`);
  }

  console.log(`[patch-28] done. migrated=${migrated} skipped(no self)=${skipped}`);
}

// Run directly with `bun run …/patch-28-multi-product.ts` (bun loads .env first, so
// DATABASE_URL is set before the db client imports). CJS run-guard so importing this
// module never triggers the migration.
if (require.main === module) {
  migrateToMultiProduct()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[patch-28] migration failed:", err);
      process.exit(1);
    });
}
