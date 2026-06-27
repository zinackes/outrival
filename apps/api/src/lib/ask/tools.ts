import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { competitors, signals, reviews, techStackEntries } from "@outrival/db";
import type { AskToolSpec } from "@outrival/ai";
import { db } from "../db";
import { analyticsQuery, sql } from "../analytics-safe";

// Org-scoped tool registry for Ask Outrival. Each run() takes orgId FIRST (from the
// session, never from the model) and returns a small serialisable result the synthesis
// grounds on. Tenant isolation is ABSOLUTE: every competitor-keyed tool resolves the
// competitor WITHIN the org before touching the org-agnostic analytics tables
// (pricing_history / job_counts / review_scores / tech_stack_history carry no org_id),
// so a foreign or forged competitorId yields nothing. Thin wrappers over the same reads
// the cockpit routes (trends.ts / compare.ts / signals.ts) already use.

export interface AskTool extends AskToolSpec {
  run(orgId: string, args: Record<string, unknown>): Promise<unknown>;
}

const SIG_CATEGORIES = ["pricing", "product", "hiring", "reviews", "content", "funding"] as const;
const SIG_SEVERITIES = ["low", "medium", "high", "critical"] as const;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asWindowDays(v: unknown, def = 30): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 365) : def;
}

// The isolation gate: resolve a competitor owned by the org. null for a foreign,
// unknown, or soft-deleted id — callers then return an empty result.
async function ownedCompetitor(orgId: string, competitorId?: string) {
  if (!competitorId) return null;
  return db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
    columns: { id: true, name: true, url: true },
  });
}

const listCompetitors: AskTool = {
  name: "listCompetitors",
  description: "List the competitors the org tracks (id, name, url, category).",
  args: "filter (optional substring match on name)",
  async run(orgId, args) {
    const filter = asString(args.filter)?.toLowerCase();
    const rows = await db
      .select({
        id: competitors.id,
        name: competitors.name,
        url: competitors.url,
        category: competitors.category,
      })
      .from(competitors)
      .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
    const out = filter ? rows.filter((r) => r.name.toLowerCase().includes(filter)) : rows;
    return { competitors: out.slice(0, 50) };
  },
};

const getCompetitorProfile: AskTool = {
  name: "getCompetitorProfile",
  description:
    'What a competitor IS and does — category, description, AI-written summary, and overlap with your product. Use for "what is X / who is X / what does X do", and as the qualitative base of any comparison (this data exists even when a competitor has no signals or pricing/hiring/reviews yet).',
  args: "competitorId (required)",
  async run(orgId, args) {
    const id = asString(args.competitorId);
    if (!id) return { profile: null };
    const row = await db.query.competitors.findFirst({
      where: and(
        eq(competitors.id, id),
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
      ),
      columns: {
        id: true,
        name: true,
        url: true,
        category: true,
        description: true,
        aiSummary: true,
        overlapScore: true,
      },
    });
    return { profile: row ?? null };
  },
};

const getSignals: AskTool = {
  name: "getSignals",
  description: "Recent strategic signals — detected competitor changes with AI insight.",
  args:
    "competitorId (optional), window (days, default 30), category (optional: pricing|product|hiring|reviews|content|funding), severity (optional: low|medium|high|critical)",
  async run(orgId, args) {
    const competitorId = asString(args.competitorId);
    if (competitorId && !(await ownedCompetitor(orgId, competitorId))) return { signals: [] };

    const window = asWindowDays(args.window, 30);
    const since = new Date(Date.now() - window * 86_400_000);
    const conds = [
      eq(signals.orgId, orgId),
      isNull(competitors.deletedAt),
      gte(signals.createdAt, since),
    ];
    if (competitorId) conds.push(eq(signals.competitorId, competitorId));

    const category = asString(args.category);
    if (category && (SIG_CATEGORIES as readonly string[]).includes(category)) {
      conds.push(eq(signals.category, category as (typeof SIG_CATEGORIES)[number]));
    }
    const severity = asString(args.severity);
    if (severity && (SIG_SEVERITIES as readonly string[]).includes(severity)) {
      conds.push(eq(signals.severity, severity as (typeof SIG_SEVERITIES)[number]));
    }

    const rows = await db
      .select({
        id: signals.id,
        severity: signals.severity,
        category: signals.category,
        insight: signals.insight,
        soWhat: signals.soWhat,
        recommendedAction: signals.recommendedAction,
        createdAt: signals.createdAt,
        competitorId: signals.competitorId,
        competitorName: competitors.name,
      })
      .from(signals)
      .innerJoin(competitors, eq(competitors.id, signals.competitorId))
      .where(and(...conds))
      .orderBy(desc(signals.createdAt))
      .limit(40);
    return { window, count: rows.length, signals: rows };
  },
};

interface RawPricingPlan {
  planName: string;
  // null for quote-based tiers (Enterprise / Custom).
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
}
interface RawPricingChange {
  planName: string;
  price: number;
  prevPrice: number;
  billingPeriod: string | null;
  recordedAt: string;
}

const getPricingHistory: AskTool = {
  name: "getPricingHistory",
  description: "A competitor's current pricing plans and recent price changes.",
  args: "competitorId (required)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { plans: [], changes: [] };
    const id = owned.id;

    const plans = await analyticsQuery<RawPricingPlan>(sql`
      WITH latest AS (SELECT max(recorded_at) AS rid FROM pricing_history WHERE competitor_id = ${id})
      SELECT plan_name AS "planName", price, currency, billing_period AS "billingPeriod"
      FROM pricing_history, latest
      WHERE competitor_id = ${id} AND recorded_at = latest.rid
      ORDER BY price
    `);
    const changes = await analyticsQuery<RawPricingChange>(sql`
      WITH ranked AS (
        SELECT plan_name, price, billing_period, recorded_at,
               lag(price) OVER (PARTITION BY plan_name, billing_period ORDER BY recorded_at) AS prev_price
        FROM pricing_history WHERE competitor_id = ${id}
      )
      SELECT plan_name AS "planName", price, prev_price AS "prevPrice",
             billing_period AS "billingPeriod", recorded_at AS "recordedAt"
      FROM ranked WHERE prev_price IS NOT NULL AND price <> prev_price
      ORDER BY recorded_at DESC LIMIT 10
    `);
    return { competitor: owned.name, plans, changes };
  },
};

interface RawHiringDept {
  department: string;
  count: number;
}

const getJobTrends: AskTool = {
  name: "getJobTrends",
  description: "A competitor's open-roles count by department (latest snapshot).",
  args: "competitorId (required), dept (optional department substring)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { departments: [] };
    const id = owned.id;

    const latest = await analyticsQuery<RawHiringDept>(sql`
      WITH latest AS (SELECT max(recorded_at) AS rid FROM job_counts WHERE competitor_id = ${id})
      SELECT department, count::int AS count
      FROM job_counts, latest
      WHERE competitor_id = ${id} AND recorded_at = latest.rid
      ORDER BY count DESC
    `);
    const dept = asString(args.dept)?.toLowerCase();
    const departments = dept
      ? latest.filter((d) => d.department.toLowerCase().includes(dept))
      : latest;
    const totalOpen = departments.reduce((s, d) => s + d.count, 0);
    return { competitor: owned.name, totalOpen, departments };
  },
};

interface RawReviewScore {
  source: string;
  score: number;
  reviewCount: number;
  sentiment: number | null;
  ease: number | null;
  support: number | null;
  features: number | null;
  value: number | null;
}

const getReviewThemes: AskTool = {
  name: "getReviewThemes",
  description: "A competitor's review scores plus recent praises and complaints by source.",
  args: "competitorId (required), source (optional: g2|capterra|appstore|...)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { scores: [], praises: [], complaints: [] };
    const id = owned.id;

    const scores = await analyticsQuery<RawReviewScore>(sql`
      SELECT DISTINCT ON (source)
             source, score, review_count AS "reviewCount", sentiment_score AS "sentiment",
             sub_ease_of_use AS ease, sub_support AS support,
             sub_features AS features, sub_value AS value
      FROM review_scores WHERE competitor_id = ${id}
      ORDER BY source, recorded_at DESC
    `);

    const rows = await db
      .select({
        source: reviews.source,
        author: reviews.author,
        content: reviews.content,
        detectedAt: reviews.detectedAt,
      })
      .from(reviews)
      .where(eq(reviews.competitorId, id))
      .orderBy(desc(reviews.detectedAt))
      .limit(40);

    const source = asString(args.source)?.toLowerCase();
    const filtered = source ? rows.filter((r) => r.source.toLowerCase().includes(source)) : rows;
    const praises = filtered
      .filter((r) => r.author === "praise" && r.content)
      .map((r) => r.content)
      .slice(0, 8);
    const complaints = filtered
      .filter((r) => r.author === "complaint" && r.content)
      .map((r) => r.content)
      .slice(0, 8);
    return { competitor: owned.name, scores, praises, complaints };
  },
};

interface RawTechChange {
  techId: string;
  event: string;
  importance: string;
  recordedAt: string;
}

const getTechStackChanges: AskTool = {
  name: "getTechStackChanges",
  description: "A competitor's current tech stack and recent appeared/disappeared technologies.",
  args: "competitorId (required)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { active: [], changes: [] };
    const id = owned.id;

    const active = await db
      .select({
        techName: techStackEntries.techName,
        category: techStackEntries.category,
        importance: techStackEntries.importance,
      })
      .from(techStackEntries)
      .where(and(eq(techStackEntries.competitorId, id), eq(techStackEntries.isActive, true)));

    const changes = await analyticsQuery<RawTechChange>(sql`
      SELECT tech_id AS "techId", event, importance, recorded_at AS "recordedAt"
      FROM tech_stack_history WHERE competitor_id = ${id}
      ORDER BY recorded_at DESC LIMIT 20
    `);
    return { competitor: owned.name, active, changes };
  },
};

const COMPARE_DIMENSIONS = ["pricing", "hiring", "reviews", "tech"] as const;

const compareCompetitors: AskTool = {
  name: "compareCompetitors",
  description:
    'Side-by-side comparison of 2+ competitors. Always returns each one\'s profile (category, description, AI summary, overlap) plus pricing, hiring, reviews, and tech. Use for any "how does X compare to Y" question — the profile grounds the answer even when the analytics dimensions are empty.',
  args: "ids (required array of competitorIds), dimension (optional: pricing|hiring|reviews|tech)",
  async run(orgId, args) {
    const raw = Array.isArray(args.ids) ? args.ids : [];
    const requested = raw.map((x) => String(x)).filter(Boolean).slice(0, 6);
    if (requested.length === 0) return { competitors: [] };

    const owned = await db
      .select({
        id: competitors.id,
        name: competitors.name,
        category: competitors.category,
        description: competitors.description,
        aiSummary: competitors.aiSummary,
        overlapScore: competitors.overlapScore,
      })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          inArray(competitors.id, requested),
          isNull(competitors.deletedAt),
        ),
      );
    if (owned.length === 0) return { competitors: [] };

    const dim = asString(args.dimension)?.toLowerCase();
    const dims = (COMPARE_DIMENSIONS as readonly string[]).includes(dim ?? "")
      ? [dim]
      : [...COMPARE_DIMENSIONS];

    const cols = await Promise.all(
      owned.map(async (o) => {
        // The qualitative substrate is always present so a comparison never comes back
        // empty just because two competitors haven't been scraped/changed yet.
        const col: Record<string, unknown> = {
          id: o.id,
          name: o.name,
          profile: {
            category: o.category,
            description: o.description,
            aiSummary: o.aiSummary,
            overlapScore: o.overlapScore,
          },
        };
        if (dims.includes("pricing")) col.pricing = await getPricingHistory.run(orgId, { competitorId: o.id });
        if (dims.includes("hiring")) col.hiring = await getJobTrends.run(orgId, { competitorId: o.id });
        if (dims.includes("reviews")) col.reviews = await getReviewThemes.run(orgId, { competitorId: o.id });
        if (dims.includes("tech")) col.tech = await getTechStackChanges.run(orgId, { competitorId: o.id });
        return col;
      }),
    );
    return { competitors: cols };
  },
};

export const ASK_TOOLS: AskTool[] = [
  listCompetitors,
  getCompetitorProfile,
  getSignals,
  getPricingHistory,
  getJobTrends,
  getReviewThemes,
  getTechStackChanges,
  compareCompetitors,
];

export const ASK_TOOL_SPECS: AskToolSpec[] = ASK_TOOLS.map(({ name, description, args }) => ({
  name,
  description,
  args,
}));

const BY_NAME = new Map(ASK_TOOLS.map((t) => [t.name, t]));
export function getAskTool(name: string): AskTool | undefined {
  return BY_NAME.get(name);
}
