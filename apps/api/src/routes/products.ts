import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { scrapeMonitor, USER_SCRAPE_PRIORITY } from "@outrival/queue";
import { products, productCompetitors, competitors, monitors, signals } from "@outrival/db";
import {
  entryPrice,
  monthlyEquivalent,
  priceMedian,
  productLimit,
  minPlanForProductCount,
  resolveCurrentPricing,
  validatePublicUrl,
  type PricingTier,
} from "@outrival/shared";
import { ProductProfileSchema } from "@outrival/ai";
import { db } from "../lib/db";
import { analyticsQuery, sql as analyticsSql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import { getOrgPlan } from "../lib/plan";
import { releaseProductRoster } from "../lib/products";
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

/** A product owned by the org, archived ones included. */
async function ownedProduct(productId: string, orgId: string) {
  return db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.orgId, orgId)),
  });
}

/**
 * A LIVE product owned by the org, or null. Every route that reads or mutates a product
 * as if it were part of the workspace goes through this: an archived product is gone as
 * far as the UI is concerned (it is absent from the list, from the switcher and from the
 * portfolio), so letting it still be renamed, promoted to primary, or linked to a new
 * competitor would resurrect it in the data while it stays invisible on screen — and a
 * competitor linked to it would be born orphaned. Only DELETE looks past this, to answer
 * idempotently for a product already archived.
 */
async function liveOwnedProduct(productId: string, orgId: string) {
  const product = await ownedProduct(productId, orgId);
  return product && product.status !== "archived" ? product : null;
}

// Daily buckets behind each product's sparkline. Same window as the competitor
// roster, so a product row and a competitor row read on one scale.
const ACTIVITY_DAYS = 14;

// Internal anchors are infrastructure, not sources a user chose to watch, so they
// stay out of the coverage count exactly as they do on the roster.
const INTERNAL_SOURCES = ["tech_stack", "sitemap", "news", "subdomains"] as const;

/**
 * How much of a product we are actually capturing. A source counts as failing
 * when it was marked unscrapable (a refusal, per the collection doctrine) or when
 * its last run ended in failure. Mirrors coverageOf() on the competitors roster.
 */
function coverageOf(
  rows: Array<{
    sourceType: string;
    lastRunAt: Date | null;
    lastFailedAt: Date | null;
    markedUnscrapable: boolean | null;
  }>,
) {
  let failing = 0;
  let failingSource: string | null = null;
  for (const m of rows) {
    const run = m.lastRunAt?.getTime() ?? null;
    const failed = m.lastFailedAt?.getTime() ?? null;
    const isFailing = m.markedUnscrapable || (failed !== null && (run === null || failed >= run));
    if (!isFailing) continue;
    failing++;
    // Name one source, and let a refusal outrank a transient failure: it is the
    // one the user can act on.
    if (failingSource === null || m.markedUnscrapable) failingSource = m.sourceType;
  }
  return { sources: rows.length, failing, failingSource };
}

// GET /api/products — the org's products (ordered for the selector), each with its
// monitored URL (from the self-competitor anchor), competitor count, and what the
// portfolio needs to compare them: capture health, last scan, and 14 days of signal
// activity on their competitors.
productsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // The four org-scoped reads this response is built from. Each only needs the org
  // id, so their previous one-after-another ordering bought nothing but latency —
  // and this endpoint is fetched by the shell on EVERY dashboard navigation (the
  // product switcher's roster), so it pays that latency more often than any other.
  const [rows, plan, links, counts] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        isPrimary: products.isPrimary,
        status: products.status,
        position: products.position,
        url: competitors.url,
        selfCompetitorId: products.selfCompetitorId,
        selfOverrides: competitors.overrides,
        selfProfile: competitors.selfProfile,
      })
      .from(products)
      .innerJoin(competitors, eq(competitors.id, products.selfCompetitorId))
      // Archived products are OUT. Every surface already filtered them client-side —
      // except the scope self-heal, which drops a scope pointing at a product missing
      // from this list. Shipping archived rows made that check pass on a removed
      // product, so the cookie stayed on it and the workspace kept rendering a SKU the
      // user had deleted, with no switcher left to escape it.
      .where(and(eq(products.orgId, orgId), ne(products.status, "archived")))
      .orderBy(asc(products.position), asc(products.name)),

    getOrgPlan(orgId),

    db
      .select({
        productId: productCompetitors.productId,
        competitorId: productCompetitors.competitorId,
        name: competitors.name,
        url: competitors.url,
        color: competitors.color,
        overrides: competitors.overrides,
      })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
      .where(
        and(
          eq(products.orgId, orgId),
          ne(products.status, "archived"),
          isNull(competitors.deletedAt),
        ),
      ),

    db
      .select({ productId: productCompetitors.productId, value: count() })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
      .where(
        and(
          eq(products.orgId, orgId),
          ne(products.status, "archived"),
          isNull(competitors.deletedAt),
        ),
      )
      .groupBy(productCompetitors.productId),
  ]);

  if (rows.length === 0) {
    return c.json({ products: [], plan, limit: productLimit(plan) });
  }
  const countBy = new Map(counts.map((r) => [r.productId, r.value]));

  const competitorsByProduct = new Map<string, typeof links>();
  for (const l of links) {
    const arr = competitorsByProduct.get(l.productId) ?? [];
    arr.push(l);
    competitorsByProduct.set(l.productId, arr);
  }

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const sevenDaysAgo = new Date(now - 7 * day);
  const fourteenDaysAgo = new Date(now - ACTIVITY_DAYS * day);
  const sevenIso = sevenDaysAgo.toISOString();

  // Signal activity is read through product_competitors rather than through
  // signals.product_ids: the junction is the same source the tagger derives from,
  // it needs no backfill for signals older than patch-28, and a competitor shared
  // by two products is then counted for both, which is what the column means.
  const linkedIds = [...new Set(links.map((l) => l.competitorId))];
  const dayExpr = sql`date_trunc('day', ${signals.createdAt})`;
  // The anchors we scrape for the product itself (its own site / repo), which is
  // what "are we still watching this product" means here. Internal anchors are
  // dropped; unscrapable rows are kept, because a refusal is the thing to name.
  const anchorIds = rows.map((p) => p.selfCompetitorId);
  const noLinks = linkedIds.length === 0;

  // Second and last wave: everything that needed the ids resolved above. The two
  // signal reads keep their empty-set short-circuit (a literal [] is a valid
  // Promise.all member), so an org with no linked competitors still issues nothing.
  const [aggregates, dailyRows, monitorRows, pricingByCompetitor] = await Promise.all([
    noLinks
      ? []
      : db
          .select({
            competitorId: signals.competitorId,
            signals7d: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp)::int`,
            signalsPrev: sql<number>`count(*) filter (where ${signals.createdAt} < ${sevenIso}::timestamp)::int`,
            critical7d: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.severity} = 'critical')::int`,
            lastSignalAt: sql<string | null>`max(${signals.createdAt})`,
          })
          .from(signals)
          .where(
            and(
              eq(signals.orgId, orgId),
              gte(signals.createdAt, fourteenDaysAgo),
              inArray(signals.competitorId, linkedIds),
            ),
          )
          .groupBy(signals.competitorId),
    noLinks
      ? []
      : db
          .select({
            competitorId: signals.competitorId,
            day: sql<string>`${dayExpr}::date::text`,
            value: sql<number>`count(*)::int`,
          })
          .from(signals)
          .where(
            and(
              eq(signals.orgId, orgId),
              gte(signals.createdAt, fourteenDaysAgo),
              inArray(signals.competitorId, linkedIds),
            ),
          )
          .groupBy(signals.competitorId, dayExpr),

    db
      .select({
        competitorId: monitors.competitorId,
        sourceType: monitors.sourceType,
        config: monitors.config,
        lastRunAt: monitors.lastRunAt,
        lastFailedAt: monitors.lastFailedAt,
        markedUnscrapable: monitors.markedUnscrapable,
      })
      .from(monitors)
      .where(
        and(
          inArray(monitors.competitorId, anchorIds),
          eq(monitors.isActive, true),
          notInArray(monitors.sourceType, [...INTERNAL_SOURCES]),
        ),
      ),

    // One pricing read for the whole page: every product's own anchor plus every
    // competitor any of them tracks. Best-effort, so a slow analytics read costs the
    // price column and nothing else.
    latestPricingByCompetitor([...anchorIds, ...linkedIds]),
  ]);

  const aggByCompetitor = new Map(aggregates.map((a) => [a.competitorId, a]));
  const dailyByCompetitor = new Map<string, Map<string, number>>();
  for (const r of dailyRows) {
    const byDay = dailyByCompetitor.get(r.competitorId) ?? new Map<string, number>();
    byDay.set(r.day, r.value);
    dailyByCompetitor.set(r.competitorId, byDay);
  }
  // Oldest day first, so the bars read left to right like a calendar.
  const dayKeys: string[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    dayKeys.push(new Date(now - i * day).toISOString().slice(0, 10));
  }

  const monitorsByAnchor = new Map<string, typeof monitorRows>();
  for (const m of monitorRows) {
    const arr = monitorsByAnchor.get(m.competitorId) ?? [];
    arr.push(m);
    monitorsByAnchor.set(m.competitorId, arr);
  }

  const enriched = rows.map(({ selfProfile, ...p }) => {
    const anchors = monitorsByAnchor.get(p.selfCompetitorId) ?? [];
    const lastScan = anchors.reduce((max, m) => Math.max(max, m.lastRunAt?.getTime() ?? 0), 0);
    const repo = anchors.find((m) => m.sourceType === "github_repo");
    const repoUrl =
      repo && typeof (repo.config as { url?: unknown } | null)?.url === "string"
        ? ((repo.config as { url: string }).url ?? null)
        : null;

    // Sum the product's competitors rather than tagging signals: see the note on
    // the aggregate query above.
    const mine = competitorsByProduct.get(p.id) ?? [];
    let signals7d = 0;
    let signalsPrev = 0;
    let critical7d = 0;
    let lastSignalAt: string | null = null;
    const activity = dayKeys.map(() => 0);
    for (const { competitorId: cid } of mine) {
      const a = aggByCompetitor.get(cid);
      if (a) {
        signals7d += a.signals7d;
        signalsPrev += a.signalsPrev;
        critical7d += a.critical7d;
        if (a.lastSignalAt && (lastSignalAt === null || a.lastSignalAt > lastSignalAt)) {
          lastSignalAt = a.lastSignalAt;
        }
      }
      const byDay = dailyByCompetitor.get(cid);
      if (!byDay) continue;
      dayKeys.forEach((k, i) => {
        activity[i] = (activity[i] ?? 0) + (byDay.get(k) ?? 0);
      });
    }

    return {
      ...p,
      repoUrl,
      // The two lines that say what this product IS, for surfaces that list products
      // without opening one (Settings names them, the product page edits them). Two
      // short strings rather than the whole selfProfile: the roster behind this
      // endpoint is fetched on every dashboard navigation, and features / techStack /
      // pricingTiers would ride along on each of them for no reader.
      profile: {
        category: selfProfile?.category?.value ?? null,
        audience: selfProfile?.audience?.value ?? null,
      },
      // What we can observe of it, which is what the detail page's monitors follow:
      // a live site, a repo while it is being built, or neither.
      stage: p.url ? ("live" as const) : repoUrl ? ("developing" as const) : ("idea" as const),
      competitorCount: countBy.get(p.id) ?? 0,
      // A few faces for the row, so "12 competitors" says who rather than only how
      // many. Ordered by name for a stable set across refreshes.
      topCompetitors: [...mine]
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 3)
        .map((l) => ({ id: l.competitorId, name: l.name, url: l.url, color: l.color })),
      pricing: (() => {
        const pos = pricePosition(
          { id: p.selfCompetitorId, overrides: p.selfOverrides },
          mine,
          pricingByCompetitor,
        );
        const onAxis = pos.priced
          .filter((x) => pos.comparableIds.has(x.row.competitorId))
          .map((x) => x.monthly!);
        return {
          entry: pos.mine,
          // Our own price on the band's axis: null when it is quoted on a basis
          // the band cannot hold (one-time), so the cell states that rather than
          // marking a yearly number on a monthly scale.
          entryMonthly: pos.mineMonthly,
          median: pos.median,
          currency: pos.currency,
          // The band the row draws its marker on: nothing to draw with fewer than
          // two comparable rivals, so the cell says "not priced" instead of
          // implying a market from one data point.
          low: onAxis.length ? Math.min(...onAxis) : null,
          high: onAxis.length ? Math.max(...onAxis) : null,
          rivalsPriced: pos.comparableIds.size,
        };
      })(),
      lastScanAt: lastScan > 0 ? new Date(lastScan).toISOString() : null,
      coverage: coverageOf(anchors),
      activity,
      stats: { signals7d, signalsPrev, critical7d, lastSignalAt },
    };
  });

  // The plan + product limit drive the settings page's "N / limit" + upgrade hint.
  return c.json({ products: enriched, plan, limit: productLimit(plan) });
});

// GET /api/products/:id — a product with its associated competitors.
productsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await liveOwnedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const linked = await db
    .select({
      competitorId: productCompetitors.competitorId,
      relevanceScore: productCompetitors.relevanceScore,
      name: competitors.name,
      url: competitors.url,
      color: competitors.color,
    })
    .from(productCompetitors)
    .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
    .where(and(eq(productCompetitors.productId, product.id), isNull(competitors.deletedAt)));

  // What each of them last DID. The tab leads with the finding, like the roster:
  // a name and an overlap score say who we watch, never what happened. Deliberately
  // unwindowed, because a competitor silent for three weeks still has a last move,
  // and "quiet since" is the useful thing its row can say.
  const ids = linked.map((l) => l.competitorId);
  const latest = ids.length
    ? await db
        .selectDistinctOn([signals.competitorId], {
          competitorId: signals.competitorId,
          insight: signals.insight,
          severity: signals.severity,
          category: signals.category,
          createdAt: signals.createdAt,
        })
        .from(signals)
        .where(and(eq(signals.orgId, orgId), inArray(signals.competitorId, ids)))
        .orderBy(signals.competitorId, desc(signals.createdAt))
    : [];
  const latestBy = new Map(latest.map((r) => [r.competitorId, r]));

  return c.json({
    product,
    competitors: linked.map((l) => {
      const move = latestBy.get(l.competitorId);
      return {
        ...l,
        latestMove: move
          ? {
              insight: move.insight,
              severity: move.severity,
              category: move.category,
              createdAt: move.createdAt,
            }
          : null,
      };
    }),
  });
});

// Latest detected pricing batch per competitor. `distinct on` walks the index once
// and stops at the newest recorded_at, then keeps every row of that batch.
interface PricingRow {
  competitor_id: string;
  plan_name: string;
  price: number | null;
  currency: string | null;
  billing_period: string | null;
}

async function latestPricingByCompetitor(ids: string[]): Promise<Map<string, PricingTier[]>> {
  const byCompetitor = new Map<string, PricingTier[]>();
  if (ids.length === 0) return byCompetitor;
  const idList = analyticsSql.join(
    ids.map((id) => analyticsSql`${id}`),
    analyticsSql`, `,
  );
  // Best-effort: pricing history is analytics, so a read failure degrades the
  // ladder to "not priced" instead of failing the page.
  const rows = await analyticsQuery<PricingRow>(analyticsSql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM pricing_history
      WHERE competitor_id IN (${idList}) AND origin = 'live'
      GROUP BY competitor_id
    )
    SELECT p.competitor_id, p.plan_name, p.price, p.currency, p.billing_period
    FROM pricing_history p
    JOIN latest l ON l.competitor_id = p.competitor_id AND p.recorded_at = l.rid
  `);
  for (const r of rows) {
    const arr = byCompetitor.get(r.competitor_id) ?? [];
    arr.push({
      planName: r.plan_name,
      price: r.price,
      currency: r.currency ?? "USD",
      billingPeriod: r.billing_period ?? "monthly",
    });
    byCompetitor.set(r.competitor_id, arr);
  }
  return byCompetitor;
}

/**
 * Where a product's entry price sits against a set of rivals.
 *
 * Both sides are read the same way (latest detected batch → user overrides →
 * cheapest paid tier), otherwise the gap measures our method, not the market. The
 * axis is ONE monthly amount in one currency, exactly as the compare lens reads
 * the same tables: a yearly plan reaches it ÷12, a one-time price or a foreign
 * currency cannot, and our own period never sets it — a product whose cheapest
 * paid tier happens to be annual would otherwise push every monthly rival off the
 * ladder. What can't reach the axis is reported for what it is: `quoteOnly` are
 * the rivals publishing no price at all, `offAxis` those publishing one we can't
 * put on this scale. Pure, so the list and the detail route cannot drift.
 */
function pricePosition<R extends { competitorId: string; overrides: unknown }>(
  self: { id: string; overrides: unknown } | null,
  rivals: R[],
  pricingByCompetitor: Map<string, PricingTier[]>,
) {
  const resolve = (id: string, overrides: unknown) => {
    const entry = entryPrice(
      resolveCurrentPricing(
        pricingByCompetitor.get(id) ?? [],
        (overrides as Parameters<typeof resolveCurrentPricing>[1]) ?? null,
      ),
    );
    return { entry, monthly: entry ? monthlyEquivalent(entry) : null };
  };

  const mine = self ? resolve(self.id, self.overrides) : { entry: null, monthly: null };
  const priced = rivals.map((r) => ({ row: r, ...resolve(r.competitorId, r.overrides) }));

  // One currency, whichever ours is quoted in — and with no price of our own, the
  // one the tracked market mostly publishes in.
  const axisCurrency =
    (mine.monthly !== null ? mine.entry!.currency : null) ??
    priced.find((p) => p.monthly !== null)?.entry!.currency ??
    null;
  const comparable = axisCurrency
    ? priced.filter((p) => p.monthly !== null && p.entry!.currency === axisCurrency)
    : [];
  const comparableIds = new Set(comparable.map((p) => p.row.competitorId));
  const quoteOnly = priced.filter((p) => p.entry === null).length;

  return {
    mine: mine.entry,
    mineMonthly: mine.monthly,
    priced,
    comparableIds,
    median: priceMedian(comparable.map((p) => p.monthly!)),
    currency: axisCurrency,
    quoteOnly,
    offAxis: priced.length - comparable.length - quoteOnly,
  };
}

// GET /api/products/:id/pricing-position — the ladder behind the product's
// Pricing tab: every tracked rival's entry price, ours among them.
productsRouter.get("/:id/pricing-position", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await liveOwnedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const linked = await db
    .select({
      competitorId: competitors.id,
      name: competitors.name,
      url: competitors.url,
      color: competitors.color,
      overrides: competitors.overrides,
    })
    .from(productCompetitors)
    .innerJoin(competitors, eq(competitors.id, productCompetitors.competitorId))
    .where(and(eq(productCompetitors.productId, product.id), isNull(competitors.deletedAt)));

  const self = await db.query.competitors.findFirst({
    where: eq(competitors.id, product.selfCompetitorId),
    columns: { id: true, name: true, url: true, overrides: true },
  });

  const pricingByCompetitor = await latestPricingByCompetitor([
    ...linked.map((l) => l.competitorId),
    ...(self ? [self.id] : []),
  ]);
  const position = pricePosition(self ?? null, linked, pricingByCompetitor);

  return c.json({
    mine: position.mine,
    mineMonthly: position.mineMonthly,
    rivals: position.priced.map((p) => ({
      competitorId: p.row.competitorId,
      name: p.row.name,
      url: p.row.url,
      color: p.row.color,
      entry: p.entry,
      monthly: p.monthly,
      comparable: position.comparableIds.has(p.row.competitorId),
    })),
    median: position.median,
    currency: position.currency,
    quoteOnly: position.quoteOnly,
    offAxis: position.offAxis,
  });
});

const publicUrl = () =>
  z
    .string()
    .url()
    .refine((u) => validatePublicUrl(u).ok, { message: "URL must be a public http(s) site" });

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: publicUrl().optional(),
  repoUrl: publicUrl().optional(),
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
        await enqueueJob(scrapeMonitor, { monitorId: m.id, force: true }, {
          priority: USER_SCRAPE_PRIORITY,
        });
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
  const product = await liveOwnedProduct(c.req.param("id"), orgId);
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
  // The only route that looks past `liveOwnedProduct`: re-archiving an already archived
  // product is a no-op the caller can repeat safely (a double-click, a retried bulk
  // remove), not a 404 that reads as "that product was never yours".
  const product = await ownedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);
  if (product.status === "archived") return c.json({ ok: true });

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

  // Archiving a SKU means "stop tracking it". Its self-competitor is the monitoring
  // anchor — take it out of circulation too, otherwise it lingered as a live "self":
  // still in every roster (e.g. showing up as "you" in AI Visibility) and, because the
  // scheduler treats a self absent from `selfManaged` as a legacy self, still scraped.
  // Soft-delete removes it from rosters/feeds; deactivating its monitors stops scraping.
  // Reversible in place if an un-archive flow is ever added (clear deletedAt + reactivate).
  await db
    .update(competitors)
    .set({ deletedAt: new Date() })
    .where(and(eq(competitors.id, product.selfCompetitorId), eq(competitors.orgId, orgId)));
  await db
    .update(monitors)
    .set({ isActive: false })
    .where(eq(monitors.competitorId, product.selfCompetitorId));

  // Hand its competitors back to the workspace. Left linked to the archived product they
  // belonged to no live product: absent from every scoped roster and feed, untagged on
  // new signals, yet still counted by the plan's competitor cap.
  await releaseProductRoster(orgId, product.id);

  return c.json({ ok: true });
});

// POST /api/products/:id/competitors/:competitorId — link a competitor to a product.
// The link IS the membership: linking the same competitor to several products is how
// a competitor shared across SKUs is expressed. Idempotent.
productsRouter.post("/:id/competitors/:competitorId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await liveOwnedProduct(c.req.param("id"), orgId);
  if (!product) return c.json({ error: "Not found" }, 404);

  const competitorId = c.req.param("competitorId");
  const competitor = await db.query.competitors.findFirst({
    where: and(eq(competitors.id, competitorId), eq(competitors.orgId, orgId)),
    columns: { id: true, overlapScore: true },
  });
  if (!competitor) return c.json({ error: "Competitor not found" }, 404);

  await db
    .insert(productCompetitors)
    .values({
      productId: product.id,
      competitorId,
      relevanceScore: competitor.overlapScore ?? null,
    })
    .onConflictDoNothing();
  return c.json({ ok: true });
});

// DELETE /api/products/:id/competitors/:competitorId — unlink a competitor from a
// product. The competitor itself is preserved (it may still be tracked org-wide /
// by other products); deleting the competitor is a separate explicit action.
productsRouter.delete("/:id/competitors/:competitorId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const product = await liveOwnedProduct(c.req.param("id"), orgId);
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
