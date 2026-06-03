import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { products, productCompetitors, competitors, monitors } from "@outrival/db";
import { normalizeHostname, productLimit, minPlanForProductCount } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan } from "../lib/plan";

type Variables = { user: { id: string } };

export const productsRouter = new Hono<{ Variables: Variables }>();

productsRouter.use("*", authMiddleware);

/** A product owned by the org, or null. */
async function ownedProduct(productId: string, orgId: string) {
  return db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.orgId, orgId)),
  });
}

// GET /api/products — the org's products (ordered for the selector), each with its
// monitored URL (from the self-competitor anchor) and competitor count.
productsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      isPrimary: products.isPrimary,
      status: products.status,
      position: products.position,
      url: competitors.url,
      selfCompetitorId: products.selfCompetitorId,
    })
    .from(products)
    .innerJoin(competitors, eq(competitors.id, products.selfCompetitorId))
    .where(eq(products.orgId, orgId))
    .orderBy(asc(products.position), asc(products.name));

  const counts = await db
    .select({ productId: productCompetitors.productId, value: count() })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(eq(products.orgId, orgId))
    .groupBy(productCompetitors.productId);
  const countBy = new Map(counts.map((r) => [r.productId, r.value]));

  // The plan + product limit drive the settings page's "N / limit" + upgrade hint.
  const plan = await getOrgPlan(orgId);
  return c.json({
    products: rows.map((p) => ({ ...p, competitorCount: countBy.get(p.id) ?? 0 })),
    plan,
    limit: productLimit(plan),
  });
});

// GET /api/products/:id — a product with its associated competitors.
productsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const linked = await db
    .select({
      competitorId: productCompetitors.competitorId,
      isSpecific: productCompetitors.isSpecific,
      relevanceScore: productCompetitors.relevanceScore,
      name: competitors.name,
      url: competitors.url,
    })
    .from(productCompetitors)
    .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
    .where(eq(productCompetitors.productId, product.id));

  return c.json({ product, competitors: linked });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().optional(),
});

// POST /api/products — add a new product (SKU). Enforces the per-tier product limit,
// then creates the backing self-competitor (the monitoring anchor) and, when a URL is
// given, seeds its site monitors and kicks off the first scrape.
productsRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const plan = await getOrgPlan(orgId);
  const limit = productLimit(plan);
  const [{ value: current } = { value: 0 }] = await db
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.orgId, orgId), ne(products.status, "archived")));

  if (current >= limit) {
    return c.json(
      {
        error: "plan_limit_products",
        used: current,
        limit,
        plan,
        suggestedPlan: minPlanForProductCount(current + 1),
      },
      403,
    );
  }

  const { name, url } = parsed.data;

  // The product's monitoring anchor: a self-competitor (excluded from the competitor
  // list / quota / discovery). URL / profile / monitors all live here.
  const [self] = await db
    .insert(competitors)
    .values({
      orgId,
      name: url ? (normalizeHostname(url) ?? name) : name,
      url: url ?? null,
      type: "self",
      isUserProduct: true,
    })
    .returning();
  if (!self) return c.json({ error: "Failed to create product anchor" }, 500);

  const [product] = await db
    .insert(products)
    .values({
      orgId,
      name,
      selfCompetitorId: self.id,
      isPrimary: current === 0, // first product of the org becomes primary
      position: current,
    })
    .returning();
  if (!product) return c.json({ error: "Failed to create product" }, 500);

  // Live product → seed + scrape the site monitors (same set as My Product /site).
  if (url) {
    const rescanDays = Number(process.env.USER_PRODUCT_RESCAN_DAYS ?? 14) || 14;
    const nextRunAt = new Date(Date.now() + rescanDays * 24 * 60 * 60 * 1000);
    const seeded = await db
      .insert(monitors)
      .values(
        (["homepage", "pricing", "jobs"] as const).map((sourceType) => ({
          competitorId: self.id,
          sourceType,
          frequency: "weekly" as const,
          nextRunAt,
          scrapeStartedAt: new Date(),
        })),
      )
      .returning();
    for (const m of seeded) {
      try {
        await tasks.trigger("scrape-monitor", { monitorId: m.id, force: true });
      } catch (e) {
        console.error("Failed to trigger product scrape", { monitorId: m.id, error: String(e) });
      }
    }
  }

  return c.json({ product }, 201);
});

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  isPrimary: z.literal(true).optional(), // only promotion is allowed (one primary)
});

// PATCH /api/products/:id — rename, reorder, or promote to primary.
productsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const { name, position, isPrimary } = parsed.data;

  // Promote to primary: demote the current primary first (exactly one per org).
  if (isPrimary && !product.isPrimary) {
    await db
      .update(products)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(eq(products.orgId, orgId), eq(products.isPrimary, true)));
  }

  const update: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) update.name = name;
  if (position !== undefined) update.position = position;
  if (isPrimary) update.isPrimary = true;

  const [updated] = await db
    .update(products)
    .set(update)
    .where(eq(products.id, product.id))
    .returning();
  return c.json({ product: updated });
});

// DELETE /api/products/:id — soft archive (preserves history). The primary can't be
// archived without promoting another product first.
productsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  if (product.isPrimary) {
    return c.json(
      { error: "primary_product", message: "Promote another product to primary before archiving this one." },
      400,
    );
  }

  await db
    .update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(products.id, product.id));
  return c.json({ ok: true });
});

const AttachSchema = z.object({ isSpecific: z.boolean().optional() });

// POST /api/products/:id/competitors/:competitorId — link a competitor to a product
// (shared by default; isSpecific=true marks it specific to this product).
productsRouter.post("/:id/competitors/:competitorId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const competitorId = c.req.param("competitorId");
  const competitor = await db.query.competitors.findFirst({
    where: and(eq(competitors.id, competitorId), eq(competitors.orgId, orgId)),
    columns: { id: true, overlapScore: true },
  });
  if (!competitor) return c.json({ error: "Competitor not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = AttachSchema.safeParse(body ?? {});
  const isSpecific = parsed.success ? (parsed.data.isSpecific ?? false) : false;

  await db
    .insert(productCompetitors)
    .values({
      productId: product.id,
      competitorId,
      isSpecific,
      relevanceScore: competitor.overlapScore ?? null,
    })
    .onConflictDoUpdate({
      target: [productCompetitors.productId, productCompetitors.competitorId],
      set: { isSpecific },
    });
  return c.json({ ok: true });
});

// DELETE /api/products/:id/competitors/:competitorId — unlink a competitor from a
// product. The competitor itself is preserved (it may still be tracked org-wide /
// by other products); deleting the competitor is a separate explicit action.
productsRouter.delete("/:id/competitors/:competitorId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  await db
    .delete(productCompetitors)
    .where(
      and(
        eq(productCompetitors.productId, product.id),
        eq(productCompetitors.competitorId, c.req.param("competitorId")),
      ),
    );
  return c.json({ ok: true });
});
