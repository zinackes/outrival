import { and, eq, ne } from "drizzle-orm";
import { products, productCompetitors, competitors } from "@outrival/db";
import { db } from "./db";

/**
 * patch-28 — ensure the org's self-competitor is wrapped by a `products` row. Called
 * wherever a self-competitor is created (onboarding, My Product) so new orgs get a
 * product the same way the migration backfilled existing ones. The first product of
 * an org becomes its primary. Idempotent (unique selfCompetitorId index + the guard).
 */
export async function ensurePrimaryProductForSelf(
  orgId: string,
  selfCompetitorId: string,
  name: string,
): Promise<void> {
  const existing = await db.query.products.findFirst({
    where: eq(products.selfCompetitorId, selfCompetitorId),
    columns: { id: true },
  });
  if (existing) return;

  const anyProduct = await db.query.products.findFirst({
    where: eq(products.orgId, orgId),
    columns: { id: true },
  });

  await db
    .insert(products)
    .values({
      orgId,
      name: name || "My product",
      selfCompetitorId,
      isPrimary: !anyProduct,
      position: 0,
    })
    .onConflictDoNothing();
}

/**
 * patch-28 — link a freshly added competitor to the org's primary product (shared,
 * isSpecific=false) so its signals get tagged into that product's feed. No-op when
 * the org has no product yet (the self-competitor anchor / product is created first).
 * relevanceScore seeds from the competitor's overlap. Idempotent.
 */
export async function associateCompetitorWithPrimaryProduct(
  orgId: string,
  competitorId: string,
): Promise<void> {
  const primary = await db.query.products.findFirst({
    where: and(
      eq(products.orgId, orgId),
      eq(products.isPrimary, true),
      ne(products.status, "archived"),
    ),
    columns: { id: true },
  });
  if (!primary) return;

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
    columns: { overlapScore: true },
  });

  await db
    .insert(productCompetitors)
    .values({
      productId: primary.id,
      competitorId,
      isSpecific: false,
      relevanceScore: competitor?.overlapScore ?? null,
    })
    .onConflictDoNothing();
}
