import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
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

/**
 * Collapse an inbound product scope (`?productId=`, itself fed by a long-lived cookie)
 * to a LIVE product of the org, or null. An archived, foreign or unknown id resolves to
 * null, which every scoped endpoint already reads as "all products".
 *
 * Null rather than an empty id-list is the whole point. Archiving a product used to
 * leave the scope cookie pointing at it, and each scoped read happily kept serving the
 * archived product's roster: the workspace showed a removed SKU's competitors and
 * nothing else. On an org left with one product the switcher hides itself, so there was
 * no control on screen able to unset the scope that was hiding everything — the user
 * could neither see nor delete competitors that still counted against the plan.
 */
export async function liveProductId(
  orgId: string,
  productId?: string | null,
): Promise<string | null> {
  if (!productId) return null;
  const p = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.orgId, orgId),
      ne(products.status, "archived"),
    ),
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
    .where(
      and(
        eq(products.id, productId),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
    )
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
    .where(
      and(
        eq(productCompetitors.productId, productId),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
    );
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
    .where(
      and(
        eq(products.id, productId),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
    )
    .limit(1);
  return row?.selfCompetitorId ?? null;
}

/**
 * The self-competitor anchoring the org's PRIMARY product, or null when the org has
 * no product row yet (legacy / mid-onboarding).
 *
 * Same ordering as primaryProductId, so "the primary product" means one thing across
 * the codebase. Anything that writes the org-wide `organizations.product_profile`
 * needs this: in a multi-SKU org a bare `findFirst(type = "self")` returns an
 * ARBITRARY product's anchor, and since it carries no deleted_at filter it can land
 * on the anchor of a product the user removed.
 */
export async function primarySelfCompetitorId(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ selfCompetitorId: products.selfCompetitorId })
    .from(products)
    .where(and(eq(products.orgId, orgId), ne(products.status, "archived")))
    .orderBy(desc(products.isPrimary), asc(products.position), asc(products.createdAt))
    .limit(1);
  return row?.selfCompetitorId ?? null;
}

/**
 * Placeholder name for a product created without a URL (idea/document onboarding).
 * The go-live rename (POST /my-product/site) only fires while the product still
 * carries it, so a user-chosen name is never overwritten.
 */
export const DEFAULT_PRODUCT_NAME = "My product";

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

  // The `anyProduct` read decides `isPrimary`, so it and the insert are one
  // transaction, serialized per org by the same advisory lock the create and
  // promote paths take. Apart, two first products of the same org both read
  // "none" and both claimed primary; with `products_org_primary_uq` in place the
  // second would now hit the untargeted onConflictDoNothing below and vanish
  // without a product row at all, which is worse than the duplicate it replaces
  // (`code:COR-07`). The conflict clause stays for what it was always for: the
  // unique selfCompetitorId index, i.e. calling this twice for the same anchor.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);

    const anyProduct = await tx.query.products.findFirst({
      where: eq(products.orgId, orgId),
      columns: { id: true },
    });

    await tx
      .insert(products)
      .values({
        orgId,
        name: name || DEFAULT_PRODUCT_NAME,
        selfCompetitorId,
        isPrimary: !anyProduct,
        position: 0,
      })
      .onConflictDoNothing();
  });
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
 * Hand an archived product's roster back to the workspace. Called when a product is
 * archived, and mirrored once over existing rows by migration 0059.
 *
 * Every competitor is expected to belong to at least one LIVE product: that is the
 * invariant `associateCompetitorWithScopedProduct` maintains on the way in, and what
 * every product-scoped surface (roster, feed, landscape, signal tagging) reads. Archiving
 * used to leave the junction rows in place, so a competitor tracked only by that product
 * silently fell out of the invariant: it belonged to no live product, disappeared from
 * every scoped view and from `signals.product_ids` tagging, yet still counted against the
 * plan's competitor cap — billed, unreachable, undeletable from any product page.
 *
 * So: drop the archived product's links, and re-link whatever that orphaned onto the
 * surviving primary. Which is exactly what the remove dialog already promises ("its
 * competitors stay tracked at the workspace level"). Signals that carried the archived
 * product id are re-tagged from the repaired junction — the same set `generate-signal`
 * would compute today — so their history follows them into the product feed.
 */
export async function releaseProductRoster(
  orgId: string,
  archivedProductId: string,
): Promise<void> {
  const links = await db
    .select({ competitorId: productCompetitors.competitorId })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(
      and(eq(productCompetitors.productId, archivedProductId), eq(products.orgId, orgId)),
    );

  await db
    .delete(productCompetitors)
    .where(eq(productCompetitors.productId, archivedProductId));

  const competitorIds = [...new Set(links.map((l) => l.competitorId))];
  if (competitorIds.length > 0) {
    // The products the archived one's competitors are STILL tracked by, so only the
    // ones left with nothing get re-homed (a competitor shared with another SKU keeps
    // exactly the membership it had).
    const surviving = await db
      .select({ competitorId: productCompetitors.competitorId })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .where(
        and(
          inArray(productCompetitors.competitorId, competitorIds),
          eq(products.orgId, orgId),
          ne(products.status, "archived"),
        ),
      );
    const stillLinked = new Set(surviving.map((r) => r.competitorId));
    const orphaned = competitorIds.filter((id) => !stillLinked.has(id));

    if (orphaned.length > 0) {
      const fallback = await primaryProductId(orgId);
      // No live product left (an org whose last product went) — nothing to re-home
      // onto. The competitors stay org-level and reachable in all-products scope.
      if (fallback) {
        for (const competitorId of orphaned) {
          await associateCompetitorWithProduct(orgId, fallback, competitorId);
        }
      }
    }
  }

  // Past signals still name the archived product. Rebuild the tag from the junction as
  // it now stands, so a re-homed competitor's history shows up under the product that
  // inherited it instead of staying addressed to a product that no longer exists.
  await db.execute(sql`
    update signals s
    set product_ids = coalesce((
      select jsonb_agg(pc.product_id order by p.is_primary desc, p.position asc, p.created_at asc)
      from product_competitors pc
      join products p on p.id = pc.product_id
      where pc.competitor_id = s.competitor_id
        and p.org_id = s.org_id
        and p.status <> 'archived'
    ), '[]'::jsonb)
    where s.org_id = ${orgId}
      and s.product_ids @> ${JSON.stringify([archivedProductId])}::jsonb
  `);
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
