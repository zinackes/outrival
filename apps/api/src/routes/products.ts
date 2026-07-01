import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { products, productCompetitors, competitors, monitors } from "@outrival/db";
import { productLimit, minPlanForProductCount, validatePublicUrl } from "@outrival/shared";
import { ProductProfileSchema } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan } from "../lib/plan";
import {
  deriveProfileFromUrl,
  deriveProfileFromDescription,
  deriveProfileFromRepo,
  deriveProfileFromDocument,
  productProfileToSelfProfile,
  productAnchorName,
  type DeriveResult,
} from "../lib/profile-derivation";

type Variables = { user: { id: string } };

export const productsRouter = new Hono<{ Variables: Variables }>();

productsRouter.use("*", authMiddleware);

// Every analyze failure degrades to the manual-description fallback (422 + a message),
// mirroring onboarding's analyze-* routes so the wizard reuses the same recovery UI.
function analyzeFailureBody(r: Extract<DeriveResult, { ok: false }>) {
  switch (r.reason) {
    case "fetch_failed":
      return { error: `Fetch failed: ${r.detail ?? "could not reach the site"}`, fallback: "description" };
    case "too_short":
      return { error: "Page content too short to analyse", fallback: "description" };
    case "repo_not_found":
      return { error: "Repo not found or private — make it public or use another mode", fallback: "description" };
    case "repo_invalid_url":
      return { error: "Not a valid github.com/owner/repo URL", fallback: "description" };
    case "repo_unreadable":
      return { error: "Could not read the repo", fallback: "description" };
    case "unreadable_document":
      return {
        error: `Could not read document (${r.detail ?? "no text layer"})`,
        reason: "unreadable_document",
        fallback: "description",
      };
    case "derive_failed":
      return { error: "Could not derive a product profile", fallback: "description" };
  }
}

const AnalyzeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("url"),
    url: z
      .string()
      .url()
      .refine((u) => validatePublicUrl(u).ok, { message: "URL must be a public http(s) site" }),
  }),
  z.object({
    mode: z.literal("description"),
    description: z.string().min(10),
    category: z.string().optional(),
    inspirations: z.array(z.string()).max(3).optional(),
  }),
  z.object({ mode: z.literal("repo"), repoUrl: z.string().url() }),
]);

// POST /api/products/analyze — derive a ProductProfile from a URL / description / repo
// for the "add product" wizard. Session-less: returns the profile to the client (which
// edits it, then submits it to POST /products) — nothing is stored on the org here.
productsRouter.post("/analyze", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  await ensureUserOrg(user.id);

  const parsed = AnalyzeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const d = parsed.data;
  const result =
    d.mode === "url"
      ? await deriveProfileFromUrl(d.url)
      : d.mode === "description"
        ? await deriveProfileFromDescription(d)
        : await deriveProfileFromRepo(d.repoUrl);

  if (!result.ok) return c.json(analyzeFailureBody(result), 422);
  return c.json({ profile: result.profile });
});

// POST /api/products/analyze-document — same as /analyze but for an uploaded spec.
// Zero-storage: the bytes live only for this request, extracted in memory, never written.
productsRouter.post(
  "/analyze-document",
  bodyLimit({
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (c) => c.json({ error: "File too large (max 10MB)" }, 413),
  }),
  aiIntensiveRateLimit,
  async (c) => {
    c.header("Cache-Control", "no-store");
    const user = c.get("user");
    await ensureUserOrg(user.id);

    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "Missing file", fallback: "description" }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await deriveProfileFromDocument(bytes, file.name, file.type);
    if (!result.ok) return c.json(analyzeFailureBody(result), 422);
    return c.json({ profile: result.profile });
  },
);

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
  repoUrl: z.string().url().optional(),
  // The wizard analyses the product first, then submits the (edited) profile so the
  // self-competitor's editable selfProfile is seeded synchronously — discovery works
  // immediately instead of waiting on the first async scrape to populate it.
  profile: ProductProfileSchema.optional(),
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

  const { name, url, repoUrl, profile } = parsed.data;

  // The product's monitoring anchor: a self-competitor (excluded from the competitor
  // list / quota / discovery). URL / profile / monitors all live here. When the wizard
  // analysed the product first, seed the editable selfProfile synchronously so discovery
  // has inputs immediately (same mapping as onboarding's self, via profile-derivation).
  const [self] = await db
    .insert(competitors)
    .values({
      orgId,
      name: productAnchorName(url, name),
      url: url ?? null,
      category: profile?.category ?? null,
      type: "self",
      isUserProduct: true,
      selfProfile: productProfileToSelfProfile(profile),
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

  // Seed the monitors matching what we can actually observe (mirrors onboarding's
  // createSelfCompetitor): a live site (homepage/pricing/jobs) and/or a GitHub repo
  // (developing). idea/document products have neither — the self stays manual-only.
  const rescanDays = Number(process.env.USER_PRODUCT_RESCAN_DAYS ?? 14) || 14;
  const nextRunAt = new Date(Date.now() + rescanDays * 24 * 60 * 60 * 1000);
  const monitorRows: Array<typeof monitors.$inferInsert> = [];
  if (url) {
    for (const sourceType of ["homepage", "pricing", "jobs"] as const) {
      monitorRows.push({
        competitorId: self.id,
        sourceType,
        frequency: "weekly",
        nextRunAt,
        scrapeStartedAt: new Date(),
      });
    }
  }
  if (repoUrl) {
    monitorRows.push({
      competitorId: self.id,
      sourceType: "github_repo",
      frequency: "weekly",
      nextRunAt,
      config: { url: repoUrl },
      scrapeStartedAt: new Date(),
    });
  }
  if (monitorRows.length > 0) {
    const seeded = await db.insert(monitors).values(monitorRows).returning();
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
