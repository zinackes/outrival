import { and, asc, desc, eq, ne } from "drizzle-orm";
import { products, productCompetitors, competitors, type SelfProfile } from "@outrival/db";
import { db } from "./db";

/**
 * patch-28 — the org's primary product id, falling back to its first non-archived
 * product (by position then age). Null when the org has no product yet. Used as the
 * default discovery target when no product scope is supplied.
 */
export async function primaryProductId(orgId: string): Promise<string | null> {
  const p = await db.query.products.findFirst({
    where: and(eq(products.orgId, orgId), ne(products.status, "archived")),
    orderBy: [desc(products.isPrimary), asc(products.position), asc(products.createdAt)],
    columns: { id: true },
  });
  return p?.id ?? null;
}

export interface ProductDiscoveryTarget {
  productId: string;
  isPrimary: boolean;
  selfProfile: SelfProfile | null;
  url: string | null;
  selfUpdatedAt: Date;
}

/**
 * patch-28 multi-SKU discovery — the inputs a product's discovery runs on: its
 * self-competitor's `selfProfile` (per-product, auto-refreshed), monitored URL and
 * last-updated time (drives per-product staleness). Tenant-safe via the products.orgId
 * filter (a forged productId yields null).
 */
export async function productDiscoveryTarget(
  orgId: string,
  productId: string,
): Promise<ProductDiscoveryTarget | null> {
  const [row] = await db
    .select({
      productId: products.id,
      isPrimary: products.isPrimary,
      selfProfile: competitors.selfProfile,
      url: competitors.url,
      selfUpdatedAt: competitors.updatedAt,
    })
    .from(products)
    .innerJoin(competitors, eq(competitors.id, products.selfCompetitorId))
    .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * patch-28 — the competitor IDs linked to a product (product_competitors), org-scoped
 * through the products join so a forged or foreign productId yields []. Used to scope
 * the org-wide feeds (competitors list, trends, activity) to a single product.
 */
export async function productCompetitorIds(orgId: string, productId: string): Promise<string[]> {
  const rows = await db
    .select({ competitorId: productCompetitors.competitorId })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(and(eq(productCompetitors.productId, productId), eq(products.orgId, orgId)));
  return rows.map((r) => r.competitorId);
}

/**
 * patch-28 — the self-competitor id wrapped by a product (its monitoring anchor),
 * org-scoped through the products.orgId filter so a forged/foreign productId yields
 * null. The self-competitor is referenced by `products.selfCompetitorId`, not the
 * `product_competitors` junction, so it must be added back explicitly when scoping a
 * feed that should include the user's own product (e.g. the Activity timeline).
 */
export async function productSelfCompetitorId(
  orgId: string,
  productId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ selfCompetitorId: products.selfCompetitorId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
    .limit(1);
  return row?.selfCompetitorId ?? null;
}

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
 * patch-28 — link a freshly added competitor to the product the caller is scoped to
 * so its signals get tagged into the feed the user was
 * actually looking at, falling back to the org's primary when there is no scope (All
 * products) or the scope no longer resolves — a stale cookie or a foreign org must not
 * leave the competitor linked to nothing, which would hide it from every product feed.
 * No-op when the org has no product yet (the self-competitor anchor is created first).
 */
export async function associateCompetitorWithScopedProduct(
  orgId: string,
  competitorId: string,
  productId?: string | null,
): Promise<void> {
  const scoped = productId
    ? await db.query.products.findFirst({
        where: and(eq(products.id, productId), eq(products.orgId, orgId)),
        columns: { id: true },
      })
    : null;
  const pid = scoped?.id ?? (await primaryProductId(orgId));
  if (pid) await associateCompetitorWithProduct(orgId, pid, competitorId);
}

/**
 * patch-28 — link a competitor to a product, tenant-safe via the products.orgId
 * check. Used when tracking a discovery candidate so it lands in the product it was
 * discovered for, not always the primary. relevanceScore seeds from the competitor's
 * overlap. Idempotent.
 */
export async function associateCompetitorWithProduct(
  orgId: string,
  productId: string,
  competitorId: string,
): Promise<void> {
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.orgId, orgId)),
    columns: { id: true },
  });
  if (!product) return;

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
    columns: { overlapScore: true },
  });

  await db
    .insert(productCompetitors)
    .values({
      productId,
      competitorId,
      relevanceScore: competitor?.overlapScore ?? null,
    })
    .onConflictDoNothing();
}

/**
 * The product a competitor-scoped action speaks for when the caller carries no
 * product scope ("All products"): a product this competitor is actually LINKED to
 * (product_competitors), primary first then display order, falling back to the org's
 * primary when it is linked to none (a self-competitor, or a legacy org with no
 * junction row). Mirrors the anchor priority the worker uses to pick whose profile
 * writes a signal's insight, so a battle card and the signals it is built on speak
 * for the same product instead of both defaulting to the primary SKU.
 * Tenant-safe: org-scoped through the products join.
 */
export async function competitorAnchorProduct(
  orgId: string,
  competitorId: string,
): Promise<{ id: string; selfCompetitorId: string } | null> {
  const [linked] = await db
    .select({ id: products.id, selfCompetitorId: products.selfCompetitorId })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(
      and(
        eq(productCompetitors.competitorId, competitorId),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
    )
    .orderBy(desc(products.isPrimary), asc(products.position), asc(products.createdAt))
    .limit(1);
  if (linked) return linked;

  const [primary] = await db
    .select({ id: products.id, selfCompetitorId: products.selfCompetitorId })
    .from(products)
    .where(and(eq(products.orgId, orgId), ne(products.status, "archived")))
    .orderBy(desc(products.isPrimary), asc(products.position), asc(products.createdAt))
    .limit(1);
  return primary ?? null;
}
