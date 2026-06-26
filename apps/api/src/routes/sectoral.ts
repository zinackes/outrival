import { Hono } from "hono";
import { and, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { competitors, organizations, sectoralSignals } from "@outrival/db";
import { SECTORAL_MIN_COMPETITORS, planCanReachSectoral, type Plan } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const sectoralRouter = new Hono<{ Variables: Variables }>();

sectoralRouter.use("*", authMiddleware);

// Allowed category filter values — guards the enum column against an invalid
// input value error when an arbitrary ?category= is passed.
const SECTORAL_CATEGORIES = [
  "feature_trend",
  "hiring_trend",
  "pricing_trend",
  "positioning_shift",
  "category_emergence",
] as const;
type SectoralCategory = (typeof SECTORAL_CATEGORIES)[number];

// Sectoral signals for the caller's org only (patch-13). Active (non-dismissed) +
// newest first by default; the dedicated sector page (consumption cockpit) passes
// ?category=, ?dismissed=1 (the Dismissed view, dismissed-only) and ?offset= — all
// additive, the overview teaser keeps calling it with ?limit= only.
sectoralRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  // Sector feed regenerated on a slow cadence — a short private cache trims
  // repeat reads + Neon cold-wakes without surfacing stale data (F11).
  c.header("Cache-Control", "private, max-age=60");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const dismissedOnly = c.req.query("dismissed") === "1";
  const categoryParam = c.req.query("category");
  const category = (SECTORAL_CATEGORIES as readonly string[]).includes(categoryParam ?? "")
    ? (categoryParam as SectoralCategory)
    : undefined;

  const filters = [eq(sectoralSignals.orgId, orgId)];
  filters.push(
    dismissedOnly
      ? isNotNull(sectoralSignals.dismissedAt)
      : isNull(sectoralSignals.dismissedAt),
  );
  if (category) filters.push(eq(sectoralSignals.category, category));

  const rows = await db
    .select({
      id: sectoralSignals.id,
      category: sectoralSignals.category,
      title: sectoralSignals.title,
      insight: sectoralSignals.insight,
      evidence: sectoralSignals.evidence,
      confidence: sectoralSignals.confidence,
      periodStart: sectoralSignals.periodStart,
      periodEnd: sectoralSignals.periodEnd,
      readAt: sectoralSignals.readAt,
      dismissedAt: sectoralSignals.dismissedAt,
      createdAt: sectoralSignals.createdAt,
    })
    .from(sectoralSignals)
    .where(and(...filters))
    .orderBy(desc(sectoralSignals.createdAt))
    .limit(limit)
    .offset(offset);

  // Eligibility meta (first page only — drives the empty state + nav gating on
  // the web). Sector trends compare patterns across >= SECTORAL_MIN_COMPETITORS
  // competitors; a plan that can't reach that floor (free, max 2) sees an upsell
  // instead of a dead empty feed, and starter+ below it sees an "add N" nudge.
  let eligibility: {
    competitorCount: number;
    minCompetitors: number;
    planCanReach: boolean;
  } | null = null;
  if (offset === 0) {
    const [org] = await db
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const [counted] = await db
      .select({ value: count() })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          ne(competitors.type, "self"),
        ),
      );
    const plan = (org?.plan ?? "free") as Plan;
    eligibility = {
      competitorCount: Number(counted?.value ?? 0),
      minCompetitors: SECTORAL_MIN_COMPETITORS,
      planCanReach: planCanReachSectoral(plan),
    };
  }

  return c.json({ signals: rows, eligibility });
});

sectoralRouter.post("/:id/read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const existing = await db.query.sectoralSignals.findFirst({
    where: and(eq(sectoralSignals.id, id), eq(sectoralSignals.orgId, orgId)),
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db
    .update(sectoralSignals)
    .set({ readAt: new Date() })
    .where(eq(sectoralSignals.id, id));
  return c.json({ ok: true });
});

sectoralRouter.post("/:id/dismiss", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const existing = await db.query.sectoralSignals.findFirst({
    where: and(eq(sectoralSignals.id, id), eq(sectoralSignals.orgId, orgId)),
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Soft state — keep the row for history, just hide it from the feed.
  await db
    .update(sectoralSignals)
    .set({ dismissedAt: new Date() })
    .where(eq(sectoralSignals.id, id));
  return c.json({ ok: true });
});
