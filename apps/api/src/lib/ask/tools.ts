import { and, count, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { competitors, signals, techStackEntries } from "@outrival/db";
import type { AskToolSpec } from "@outrival/ai";
import {
  isComparablePricePeriod,
  resolveCurrentPricing,
  SIGNAL_CATEGORIES,
  type PricingTier,
  type CompetitorOverrides,
} from "@outrival/shared";
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

const SIG_CATEGORIES = SIGNAL_CATEGORIES;
const SIG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
// Most recent signals handed to the synthesis. The real match count ships alongside
// so a busy org's answer says "42 of 300" instead of quietly meaning "the last 40".
const SIGNALS_LIMIT = 40;
// Verbatim complaints kept per competitor in the roster-wide review comparison —
// enough for the synthesis to spot a recurring theme, small enough that a ten-name
// roster still fits the serialisation budget.
const COMPLAINTS_PER_COMPETITOR = 3;
// How far back the roster-wide reads look for MOVEMENT. Levels answer "who is the
// biggest"; these answer "who moved", which is a different question the planner was
// otherwise routing to getSignals — narrative change data with no numbers in it.
const HIRING_TREND_DAYS = 28;
const PRICING_CHANGE_DAYS = 180;
const PRICING_CHANGES_PER_COMPETITOR = 5;
// Per-competitor bounds for the batched dimension reads. Each replaces a LIMIT that
// used to sit inside a per-competitor query, so a single-competitor answer sees the
// same rows it saw before; expressed as a rank over the batch, one loud competitor
// cannot eat the budget of the others (`code:PER-27`).
const PRICING_MOVES_PER_COMPETITOR = 10;
const VERBATIM_PER_COMPETITOR = 40;
const TECH_EVENTS_PER_COMPETITOR = 20;

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asWindowDays(v: unknown, def = 30): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 365) : def;
}

// Every RIVAL the org tracks — the self competitor (the user's own product) excluded.
// The rank* tools compare competitors against each other, and the user's own product
// is not one of them: ranking it in "who is hiring the most" answers a question nobody
// asked. Ordered by name so a tie in the ranking is at least stable between runs.
async function orgRivals(orgId: string) {
  return db
    .select({ id: competitors.id, name: competitors.name, overrides: competitors.overrides })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    )
    .orderBy(competitors.name);
}

// Bind a list of ids into one `IN (...)` predicate for the analytics reads. The
// roster-wide tools read the latest batch for EVERY competitor in a single query —
// the whole point is that the ranking never depends on how many calls the planner
// managed to emit.
function idPredicate(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
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
    columns: { id: true, name: true, url: true, overrides: true },
  });
}

const listCompetitors: AskTool = {
  name: "listCompetitors",
  description:
    "List the competitors the org tracks (id, name, url, category). The row flagged isSelf is the user's OWN product, not a rival.",
  args: "filter (optional substring match on name)",
  async run(orgId, args) {
    const filter = asString(args.filter)?.toLowerCase();
    const rows = await db
      .select({
        id: competitors.id,
        name: competitors.name,
        url: competitors.url,
        category: competitors.category,
        type: competitors.type,
      })
      .from(competitors)
      .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
    // The self competitor stays in the roster (the planner must resolve "how do I
    // compare to X" to it) but ships flagged: unflagged, it read as one more rival.
    const out = (filter ? rows.filter((r) => r.name.toLowerCase().includes(filter)) : rows).map(
      ({ type, ...r }) => (type === "self" ? { ...r, isSelf: true as const } : r),
    );
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
  description:
    'Recent strategic signals — things that CHANGED at competitors, written up as prose with an AI insight. PROSE ONLY: a signal carries no count, price or score. Best for an undirected "what happened / what is new / why did X move".',
  args:
    `competitorId (optional), window (days, default 30), category (optional: ${SIGNAL_CATEGORIES.join("|")}), severity (optional: low|medium|high|critical)`,
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

    const [rows, [totals]] = await Promise.all([
      db
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
        .limit(SIGNALS_LIMIT),
      db
        .select({ n: count() })
        .from(signals)
        .innerJoin(competitors, eq(competitors.id, signals.competitorId))
        .where(and(...conds)),
    ]);
    // `total` is the real match count; `signals` is only the most recent page of it.
    // Returning the page length as the count let the synthesis state "42 signals this
    // month" on an org with 300 — the cap was invisible, so it read as the answer.
    const total = totals?.n ?? rows.length;
    return {
      window,
      total,
      returned: rows.length,
      truncated: total > rows.length,
      signals: rows,
    };
  },
};

interface RawPricingPlan {
  // Every analytics read below now covers a SET of competitors, so each row has to
  // say which one it belongs to (`code:PER-27`).
  competitorId: string;
  planName: string;
  // null for quote-based tiers (Enterprise / Custom).
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
  // When this batch was captured. Every tool ships it so the synthesis can date the
  // figure: without it a six-week-old price answered "what do they charge today".
  capturedAt: string | null;
}
interface RawPricingChange {
  competitorId: string;
  planName: string;
  price: number;
  prevPrice: number;
  billingPeriod: string | null;
  recordedAt: string;
}
interface RawHiringDept {
  competitorId: string;
  department: string;
  count: number;
  capturedAt: string | null;
}
interface RawReviewScore {
  competitorId: string;
  source: string;
  score: number;
  reviewCount: number;
  sentiment: number | null;
  ease: number | null;
  support: number | null;
  features: number | null;
  value: number | null;
  capturedAt: string | null;
}
interface RawVerbatim {
  competitorId: string;
  source: string;
  author: string | null;
  content: string | null;
}
interface RawTechChange {
  competitorId: string;
  techId: string;
  event: string;
  importance: string;
  recordedAt: string;
}
interface RawTechEntry {
  competitorId: string;
  techName: string;
  category: string | null;
  importance: string | null;
}

// --- per-dimension reads, batched over a set of competitors ------------------------
// Each of the four dimension tools below answers about ONE competitor, and
// compareCompetitors called all four for each of up to six ids — so a single "how
// does X compare to Y" question issued dozens of round trips, two dozen of them
// re-establishing an ownership the compare had already established for the whole
// set in one query (`code:PER-27`).
//
// The reads are batched instead: a reader takes the competitors whose ownership is
// ALREADY resolved and answers for all of them in a fixed number of queries, keyed
// by id. The single-competitor tool is then the same reader over a one-element list,
// so there is one code path per dimension rather than a batched one and a loop one.

// What a batched read needs of an already-owned competitor: the id it keys on, the
// name it labels with, and the pricing overlay the user edited.
type DimensionSubject = { id: string; name: string; overrides: unknown };

/** Bucket rows carrying a competitorId, preserving the order the query returned. */
function byCompetitor<T extends { competitorId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.competitorId);
    if (bucket) bucket.push(row);
    else out.set(row.competitorId, [row]);
  }
  return out;
}

async function pricingForMany(owned: DimensionSubject[]) {
  const ids = idPredicate(owned.map((o) => o.id));
  const [detected, moves] = await Promise.all([
    analyticsQuery<RawPricingPlan>(sql`
      WITH latest AS (
        SELECT competitor_id, max(recorded_at) AS rid FROM pricing_history
        WHERE competitor_id IN (${ids}) AND origin = 'live'
        GROUP BY competitor_id
      )
      SELECT ph.competitor_id AS "competitorId", ph.plan_name AS "planName", ph.price,
             ph.currency, ph.billing_period AS "billingPeriod",
             (latest.rid AT TIME ZONE 'UTC') AS "capturedAt"
      FROM pricing_history ph
      JOIN latest ON latest.competitor_id = ph.competitor_id AND ph.recorded_at = latest.rid
      WHERE ph.origin = 'live'
      ORDER BY ph.competitor_id, ph.price
    `),
    // Bounded PER COMPETITOR, not globally: the per-competitor query this replaces
    // ended in LIMIT 10, and a flat limit over the batch would let one busy
    // competitor's moves crowd out every other column of the comparison.
    analyticsQuery<RawPricingChange>(sql`
      SELECT competitor_id AS "competitorId", plan_name AS "planName", price,
             prev_price AS "prevPrice", billing_period AS "billingPeriod",
             (recorded_at AT TIME ZONE 'UTC') AS "recordedAt"
      FROM (
        SELECT competitor_id, plan_name, price, billing_period, recorded_at, prev_price,
               row_number() OVER (PARTITION BY competitor_id ORDER BY recorded_at DESC) AS rn
        FROM (
          SELECT competitor_id, plan_name, price, billing_period, recorded_at,
                 lag(price) OVER (
                   PARTITION BY competitor_id, plan_name, billing_period ORDER BY recorded_at
                 ) AS prev_price
          FROM pricing_history WHERE competitor_id IN (${ids}) AND origin = 'live'
        ) lagged
        WHERE prev_price IS NOT NULL AND price <> prev_price
      ) ranked
      WHERE rn <= ${PRICING_MOVES_PER_COMPETITOR}
      ORDER BY competitor_id, recorded_at DESC
    `),
  ]);

  const detectedById = byCompetitor(detected);
  const movesById = byCompetitor(moves);
  return new Map(
    owned.map((o) => {
      const raw = detectedById.get(o.id) ?? [];
      // Apply the user's per-plan overlay so Ask grounds on the plans the user sees
      // (hand-edited/added/hidden), not just raw detection.
      const detectedTiers: PricingTier[] = raw.map((p) => ({
        planName: p.planName,
        price: p.price,
        currency: p.currency ?? "USD",
        billingPeriod: p.billingPeriod ?? "monthly",
      }));
      const plans = resolveCurrentPricing(
        detectedTiers,
        (o.overrides ?? null) as CompetitorOverrides | null,
      ).map((r) => ({
        planName: r.planName,
        price: r.price,
        currency: r.currency,
        billingPeriod: r.billingPeriod,
      }));
      return [
        o.id,
        {
          competitor: o.name,
          capturedAt: raw[0]?.capturedAt ?? null,
          plans,
          changes: (movesById.get(o.id) ?? []).map((m) => ({
            planName: m.planName,
            price: m.price,
            prevPrice: m.prevPrice,
            billingPeriod: m.billingPeriod,
            recordedAt: m.recordedAt,
          })),
        },
      ] as const;
    }),
  );
}

async function hiringForMany(owned: DimensionSubject[], dept?: string) {
  const ids = idPredicate(owned.map((o) => o.id));
  const latest = await analyticsQuery<RawHiringDept>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid FROM job_counts
      WHERE competitor_id IN (${ids})
      GROUP BY competitor_id
    )
    SELECT jc.competitor_id AS "competitorId", jc.department, jc.count::int AS count,
           (latest.rid AT TIME ZONE 'UTC') AS "capturedAt"
    FROM job_counts jc
    JOIN latest ON latest.competitor_id = jc.competitor_id AND jc.recorded_at = latest.rid
    ORDER BY jc.competitor_id, jc.count DESC
  `);

  const byId = byCompetitor(latest);
  return new Map(
    owned.map((o) => {
      const rows = byId.get(o.id) ?? [];
      const departments = dept
        ? rows.filter((d) => d.department.toLowerCase().includes(dept))
        : rows;
      return [
        o.id,
        {
          competitor: o.name,
          capturedAt: rows[0]?.capturedAt ?? null,
          totalOpen: departments.reduce((s, d) => s + d.count, 0),
          departments: departments.map(({ department, count }) => ({ department, count })),
        },
      ] as const;
    }),
  );
}

async function reviewsForMany(owned: DimensionSubject[], source?: string) {
  const ids = idPredicate(owned.map((o) => o.id));
  const [scores, verbatim] = await Promise.all([
    analyticsQuery<RawReviewScore>(sql`
      SELECT DISTINCT ON (competitor_id, source)
             competitor_id AS "competitorId", source, score,
             review_count AS "reviewCount", sentiment_score AS "sentiment",
             sub_ease_of_use AS ease, sub_support AS support,
             sub_features AS features, sub_value AS value,
             (recorded_at AT TIME ZONE 'UTC') AS "capturedAt"
      FROM review_scores WHERE competitor_id IN (${ids})
      ORDER BY competitor_id, source, recorded_at DESC
    `),
    // Same per-competitor bound the single-competitor query had, expressed as a rank
    // so one loud competitor cannot consume the whole batch.
    analyticsQuery<RawVerbatim>(sql`
      SELECT competitor_id AS "competitorId", source, author, content
      FROM (
        SELECT competitor_id, source, author, content,
               row_number() OVER (PARTITION BY competitor_id ORDER BY detected_at DESC) AS rn
        FROM reviews WHERE competitor_id IN (${ids})
      ) ranked
      WHERE rn <= ${VERBATIM_PER_COMPETITOR}
      ORDER BY competitor_id, rn
    `),
  ]);

  const scoresById = byCompetitor(scores);
  const verbatimById = byCompetitor(verbatim);
  return new Map(
    owned.map((o) => {
      const rows = verbatimById.get(o.id) ?? [];
      const filtered = source
        ? rows.filter((r) => r.source.toLowerCase().includes(source))
        : rows;
      return [
        o.id,
        {
          competitor: o.name,
          scores: (scoresById.get(o.id) ?? []).map((s) => ({
            source: s.source,
            score: s.score,
            reviewCount: s.reviewCount,
            sentiment: s.sentiment,
            ease: s.ease,
            support: s.support,
            features: s.features,
            value: s.value,
            capturedAt: s.capturedAt,
          })),
          praises: filtered
            .filter((r) => r.author === "praise" && r.content)
            .map((r) => r.content)
            .slice(0, 8),
          complaints: filtered
            .filter((r) => r.author === "complaint" && r.content)
            .map((r) => r.content)
            .slice(0, 8),
        },
      ] as const;
    }),
  );
}

async function techForMany(owned: DimensionSubject[]) {
  const ids = owned.map((o) => o.id);
  const [active, changes] = await Promise.all([
    db
      .select({
        competitorId: techStackEntries.competitorId,
        techName: techStackEntries.techName,
        category: techStackEntries.category,
        importance: techStackEntries.importance,
      })
      .from(techStackEntries)
      .where(
        and(inArray(techStackEntries.competitorId, ids), eq(techStackEntries.isActive, true)),
      ),
    analyticsQuery<RawTechChange>(sql`
      SELECT competitor_id AS "competitorId", tech_id AS "techId", event, importance,
             (recorded_at AT TIME ZONE 'UTC') AS "recordedAt"
      FROM (
        SELECT competitor_id, tech_id, event, importance, recorded_at,
               row_number() OVER (PARTITION BY competitor_id ORDER BY recorded_at DESC) AS rn
        FROM tech_stack_history WHERE competitor_id IN (${idPredicate(ids)})
      ) ranked
      WHERE rn <= ${TECH_EVENTS_PER_COMPETITOR}
      ORDER BY competitor_id, recorded_at DESC
    `),
  ]);

  const activeById = byCompetitor(active as RawTechEntry[]);
  const changesById = byCompetitor(changes);
  return new Map(
    owned.map(
      (o) =>
        [
          o.id,
          {
            competitor: o.name,
            active: (activeById.get(o.id) ?? []).map((t) => ({
              techName: t.techName,
              category: t.category,
              importance: t.importance,
            })),
            changes: (changesById.get(o.id) ?? []).map((c) => ({
              techId: c.techId,
              event: c.event,
              importance: c.importance,
              recordedAt: c.recordedAt,
            })),
          },
        ] as const,
    ),
  );
}

const getPricingHistory: AskTool = {
  name: "getPricingHistory",
  description: "A competitor's current pricing plans and recent price changes.",
  args: "competitorId (required)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { plans: [], changes: [] };
    return (
      (await pricingForMany([owned])).get(owned.id) ?? {
        competitor: owned.name,
        capturedAt: null,
        plans: [],
        changes: [],
      }
    );
  },
};

const getJobTrends: AskTool = {
  name: "getJobTrends",
  description:
    'ONE named competitor\'s open roles, counted per department (latest capture). Use for "what is X hiring for", "which teams is X growing", "how many roles is X running". For a ranking across all competitors use rankHiring instead.',
  args: "competitorId (required), dept (optional department substring)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { departments: [] };
    const dept = asString(args.dept)?.toLowerCase();
    return (
      (await hiringForMany([owned], dept)).get(owned.id) ?? {
        competitor: owned.name,
        capturedAt: null,
        totalOpen: 0,
        departments: [],
      }
    );
  },
};

const getReviewThemes: AskTool = {
  name: "getReviewThemes",
  description:
    "ONE competitor's review scores plus recent praises and complaints by source. For a comparison across all competitors use rankReviews instead.",
  args: "competitorId (required), source (optional: g2|capterra|appstore|...)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { scores: [], praises: [], complaints: [] };
    const source = asString(args.source)?.toLowerCase();
    return (
      (await reviewsForMany([owned], source)).get(owned.id) ?? {
        competitor: owned.name,
        scores: [],
        praises: [],
        complaints: [],
      }
    );
  },
};

const getTechStackChanges: AskTool = {
  name: "getTechStackChanges",
  description: "A competitor's current tech stack and recent appeared/disappeared technologies.",
  args: "competitorId (required)",
  async run(orgId, args) {
    const owned = await ownedCompetitor(orgId, asString(args.competitorId));
    if (!owned) return { active: [], changes: [] };
    return (
      (await techForMany([owned])).get(owned.id) ?? {
        competitor: owned.name,
        active: [],
        changes: [],
      }
    );
  },
};

// --- roster-wide tools ------------------------------------------------------------
// Every tool above answers about ONE competitor. A superlative question ("who is
// hiring the most") therefore needed one call per name — but the plan is capped at 6
// calls and the planner is told to prefer the fewest, so it emitted one and the
// synthesis faithfully reported a one-competitor ranking as the answer. These three
// read the WHOLE roster in a single query, so the ranking no longer depends on how
// many calls the planner happened to spend. Each also returns `noData`: a competitor
// missing from the ranking is a fact the answer must carry, not a silent omission.

interface RawRosterHiring {
  competitorId: string;
  department: string;
  count: number;
  capturedAt: string | null;
}

interface RawHiringTrend {
  competitorId: string;
  priorTotal: number;
  priorAt: string | null;
}

const rankHiring: AskTool = {
  name: "rankHiring",
  description:
    'Open roles for EVERY competitor the org tracks, ranked highest first, each with its capture date AND its change over the last month (openRolesChange). Use this for any roster-wide hiring question, whether about SIZE ("who is hiring the most") or MOVEMENT ("who is scaling fastest", "whose engineering team is growing") — it already covers all competitors, so never call getJobTrends once per name to build a ranking.',
  args: "none",
  async run(orgId) {
    const rivals = await orgRivals(orgId);
    if (rivals.length === 0) return { ranking: [], noData: [] };
    const ids = idPredicate(rivals.map((r) => r.id));

    const [rows, trend] = await Promise.all([
      analyticsQuery<RawRosterHiring>(sql`
        WITH latest AS (
          SELECT competitor_id, max(recorded_at) AS rid
          FROM job_counts WHERE competitor_id IN (${ids})
          GROUP BY competitor_id
        )
        SELECT j.competitor_id AS "competitorId", j.department, j.count::int AS count,
               (l.rid AT TIME ZONE 'UTC') AS "capturedAt"
        FROM job_counts j
        JOIN latest l ON l.competitor_id = j.competitor_id AND j.recorded_at = l.rid
        ORDER BY j.competitor_id, j.count DESC
      `),
      // "Who is scaling fastest" is a different question from "who is biggest", and
      // with only a level to offer the planner routed it to getSignals — narrative
      // change data with no numbers in it. Compare each competitor's latest total
      // against its own most recent capture at least a month older.
      analyticsQuery<RawHiringTrend>(sql`
        WITH totals AS (
          SELECT competitor_id, recorded_at, sum(count)::int AS total
          FROM job_counts WHERE competitor_id IN (${ids})
          GROUP BY competitor_id, recorded_at
        ), latest AS (
          SELECT DISTINCT ON (competitor_id) competitor_id, recorded_at
          FROM totals ORDER BY competitor_id, recorded_at DESC
        )
        SELECT DISTINCT ON (t.competitor_id)
               t.competitor_id AS "competitorId", t.total AS "priorTotal",
               (t.recorded_at AT TIME ZONE 'UTC') AS "priorAt"
        FROM totals t
        JOIN latest l ON l.competitor_id = t.competitor_id
        WHERE t.recorded_at <= l.recorded_at - ${sql.raw(`interval '${HIRING_TREND_DAYS} days'`)}
        ORDER BY t.competitor_id, t.recorded_at DESC
      `),
    ]);
    const trendById = new Map(trend.map((t) => [t.competitorId, t]));

    const byId = new Map<
      string,
      {
        totalOpen: number;
        // Named "top" on purpose: `totalOpen` counts every department, this lists the
        // biggest few (raw ATS labels run to dozens of near-duplicates). Called
        // `departments`, the synthesis would sum it and contradict the total.
        topDepartments: Array<{ department: string; count: number }>;
        capturedAt: string | null;
      }
    >();
    for (const r of rows) {
      let cur = byId.get(r.competitorId);
      if (!cur) {
        cur = { totalOpen: 0, topDepartments: [], capturedAt: r.capturedAt };
        byId.set(r.competitorId, cur);
      }
      cur.totalOpen += r.count;
      if (cur.topDepartments.length < 5) {
        cur.topDepartments.push({ department: r.department, count: r.count });
      }
    }

    const ranking = rivals
      .filter((r) => byId.has(r.id))
      .map((r) => {
        const cur = byId.get(r.id)!;
        const prior = trendById.get(r.id);
        return {
          id: r.id,
          name: r.name,
          ...cur,
          // null, never 0, when there is no earlier capture to compare against: a
          // competitor first scraped last week has not "held flat", it has no history.
          openRolesChange: prior ? cur.totalOpen - prior.priorTotal : null,
          comparedTo: prior ? { totalOpen: prior.priorTotal, capturedAt: prior.priorAt } : null,
        };
      })
      .sort((a, b) => b.totalOpen - a.totalOpen);
    const noData = rivals.filter((r) => !byId.has(r.id)).map((r) => r.name);
    return { rosterSize: rivals.length, ranking, noData };
  },
};

interface RawRosterPricing {
  competitorId: string;
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
  capturedAt: string | null;
}

interface RawRosterPriceMove {
  competitorId: string;
  planName: string;
  price: number;
  prevPrice: number;
  billingPeriod: string | null;
  recordedAt: string;
}

const rankPricing: AskTool = {
  name: "rankPricing",
  description:
    'Current entry and top price for EVERY competitor the org tracks, cheapest first, each with its capture date AND its actual price moves over the last 6 months (recentChanges: old price → new price, dated). Use this for any roster-wide pricing question, whether about LEVEL ("who is cheapest", "who is the most expensive") or MOVEMENT ("how has competitor pricing shifted this quarter", "who raised prices") — never call getPricingHistory once per name to build a ranking.',
  args: "none",
  async run(orgId) {
    const rivals = await orgRivals(orgId);
    if (rivals.length === 0) return { ranking: [], noData: [] };
    const ids = idPredicate(rivals.map((r) => r.id));

    const [detected, moves] = await Promise.all([
      analyticsQuery<RawRosterPricing>(sql`
        WITH latest AS (
          SELECT competitor_id, max(recorded_at) AS rid
          FROM pricing_history
          WHERE competitor_id IN (${ids}) AND origin = 'live'
          GROUP BY competitor_id
        )
        SELECT p.competitor_id AS "competitorId", p.plan_name AS "planName", p.price,
               p.currency, p.billing_period AS "billingPeriod",
               (l.rid AT TIME ZONE 'UTC') AS "capturedAt"
        FROM pricing_history p
        JOIN latest l ON l.competitor_id = p.competitor_id AND p.recorded_at = l.rid
        ORDER BY p.competitor_id, p.price
      `),
      // "How has pricing SHIFTED" is a movement question, and with only current
      // levels to offer the planner sent it to getSignals — which carries the prose
      // of a pricing change but never the two numbers. Same lag() shape
      // getPricingHistory uses per competitor, run once for the whole roster.
      analyticsQuery<RawRosterPriceMove>(sql`
        WITH ranked AS (
          SELECT competitor_id, plan_name, price, billing_period, recorded_at,
                 lag(price) OVER (
                   PARTITION BY competitor_id, plan_name, billing_period ORDER BY recorded_at
                 ) AS prev_price
          FROM pricing_history WHERE competitor_id IN (${ids}) AND origin = 'live'
        )
        SELECT competitor_id AS "competitorId", plan_name AS "planName", price,
               prev_price AS "prevPrice", billing_period AS "billingPeriod",
               (recorded_at AT TIME ZONE 'UTC') AS "recordedAt"
        FROM ranked
        WHERE prev_price IS NOT NULL AND price <> prev_price
          AND recorded_at >= now() - ${sql.raw(`interval '${PRICING_CHANGE_DAYS} days'`)}
        ORDER BY recorded_at DESC
      `),
    ]);

    const detectedById = new Map<string, RawRosterPricing[]>();
    for (const p of detected) {
      const arr = detectedById.get(p.competitorId);
      if (arr) arr.push(p);
      else detectedById.set(p.competitorId, [p]);
    }
    const movesById = new Map<string, RawRosterPriceMove[]>();
    for (const m of moves) {
      const arr = movesById.get(m.competitorId) ?? [];
      if (arr.length >= PRICING_CHANGES_PER_COMPETITOR) continue;
      arr.push(m);
      movesById.set(m.competitorId, arr);
    }

    const ranked: Array<{
      id: string;
      name: string;
      entry: number | null;
      top: number | null;
      currency: string | null;
      plans: Array<{ planName: string; price: number | null; billingPeriod: string | null }>;
      capturedAt: string | null;
      recentChanges: Array<{
        planName: string;
        from: number;
        to: number;
        billingPeriod: string | null;
        at: string;
      }>;
    }> = [];
    const noData: string[] = [];
    for (const r of rivals) {
      const raw = detectedById.get(r.id) ?? [];
      // Same overlay the pricing tab renders, so Ask ranks the plans the user SEES —
      // a hand-added or hidden plan changes the answer to "who is cheapest".
      const plans = resolveCurrentPricing(
        raw.map((p) => ({
          planName: p.planName,
          price: p.price,
          currency: p.currency ?? "USD",
          billingPeriod: p.billingPeriod ?? "monthly",
        })) satisfies PricingTier[],
        (r.overrides ?? null) as CompetitorOverrides | null,
      );
      if (plans.length === 0) {
        noData.push(r.name);
        continue;
      }
      let entry: number | null = null;
      let top: number | null = null;
      // A usage rate ($0.10 / call) is not comparable against a monthly subscription,
      // so it joins the plan list but never the band that decides "cheapest".
      for (const p of plans) {
        if (p.price == null || !isComparablePricePeriod(p.billingPeriod)) continue;
        entry = entry == null ? p.price : Math.min(entry, p.price);
        top = top == null ? p.price : Math.max(top, p.price);
      }
      ranked.push({
        id: r.id,
        name: r.name,
        entry,
        top,
        currency: plans[0]?.currency ?? null,
        plans: plans.map((p) => ({
          planName: p.planName,
          price: p.price,
          billingPeriod: p.billingPeriod,
        })),
        capturedAt: raw[0]?.capturedAt ?? null,
        // Named from/to rather than price/prevPrice: the synthesis reads these into a
        // sentence, and "prevPrice" next to "price" got the direction backwards.
        recentChanges: (movesById.get(r.id) ?? []).map((m) => ({
          planName: m.planName,
          from: m.prevPrice,
          to: m.price,
          billingPeriod: m.billingPeriod,
          at: m.recordedAt,
        })),
      });
    }
    // Quote-only competitors (no numeric entry) sort last: they have plans, so they
    // are not "no data", but they cannot win a cheapest/most-expensive comparison.
    ranked.sort((a, b) => (a.entry ?? Infinity) - (b.entry ?? Infinity));
    return { rosterSize: rivals.length, ranking: ranked, noData };
  },
};

interface RawRosterReview {
  competitorId: string;
  source: string;
  score: number;
  reviewCount: number;
  capturedAt: string | null;
}

const rankReviews: AskTool = {
  name: "rankReviews",
  description:
    'Review score, review count and recent complaints for EVERY competitor the org tracks, best-rated first. Use this for any roster-wide review question ("who has the best reviews", "what are the most common complaints across my competitors") — never call getReviewThemes once per name to build a comparison.',
  args: "none",
  async run(orgId) {
    const rivals = await orgRivals(orgId);
    if (rivals.length === 0) return { ranking: [], noData: [] };
    const ids = rivals.map((r) => r.id);

    const [scores, complaintRows] = await Promise.all([
      analyticsQuery<RawRosterReview>(sql`
        SELECT DISTINCT ON (competitor_id, source)
               competitor_id AS "competitorId", source, score,
               review_count AS "reviewCount", (recorded_at AT TIME ZONE 'UTC') AS "capturedAt"
        FROM review_scores WHERE competitor_id IN (${idPredicate(ids)})
        ORDER BY competitor_id, source, recorded_at DESC
      `),
      // Bounded PER COMPETITOR, not globally: a flat "most recent 200 complaints"
      // is dominated by whoever was scraped last, so the quiet competitors drop out
      // of a roster-wide complaints answer entirely.
      analyticsQuery<{ competitorId: string; content: string }>(sql`
        SELECT "competitorId", content FROM (
          SELECT competitor_id AS "competitorId", content,
                 row_number() OVER (PARTITION BY competitor_id ORDER BY detected_at DESC) AS rn
          FROM reviews
          WHERE competitor_id IN (${idPredicate(ids)})
            AND author = 'complaint' AND content IS NOT NULL
        ) t WHERE rn <= ${COMPLAINTS_PER_COMPETITOR}
      `),
    ]);

    const scoresById = new Map<string, RawRosterReview[]>();
    for (const s of scores) {
      const arr = scoresById.get(s.competitorId);
      if (arr) arr.push(s);
      else scoresById.set(s.competitorId, [s]);
    }
    const complaintsById = new Map<string, string[]>();
    for (const c of complaintRows) {
      if (!c.content) continue;
      const arr = complaintsById.get(c.competitorId) ?? [];
      arr.push(c.content);
      complaintsById.set(c.competitorId, arr);
    }

    const ranking = rivals
      .filter((r) => scoresById.has(r.id) || complaintsById.has(r.id))
      .map((r) => {
        const rows = scoresById.get(r.id) ?? [];
        // Best score across sources is what a "who is best rated" answer compares;
        // the per-source rows stay so the synthesis can name where it came from.
        const best = rows.reduce<number | null>(
          (m, s) => (m == null ? s.score : Math.max(m, s.score)),
          null,
        );
        return {
          id: r.id,
          name: r.name,
          bestScore: best,
          sources: rows.map((s) => ({
            source: s.source,
            score: s.score,
            reviewCount: s.reviewCount,
            capturedAt: s.capturedAt,
          })),
          complaints: complaintsById.get(r.id) ?? [],
        };
      })
      .sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1));
    const rankedIds = new Set(ranking.map((r) => r.id));
    const noData = rivals.filter((r) => !rankedIds.has(r.id)).map((r) => r.name);
    return { rosterSize: rivals.length, ranking, noData };
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
        // Read here so the batched pricing reader can apply the user's overlay
        // without going back for the row it already has (`code:PER-27`).
        overrides: competitors.overrides,
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

    // Four reads for the whole comparison, whatever the number of competitors.
    // This used to call the four single-competitor tools once per id — each of which
    // re-resolved an ownership the select above had just established for the entire
    // set — so six names meant ~66 round trips inside one streamed answer
    // (`code:PER-27`). A dimension not asked for is not read at all.
    const [pricing, hiring, reviewThemes, tech] = await Promise.all([
      dims.includes("pricing") ? pricingForMany(owned) : undefined,
      dims.includes("hiring") ? hiringForMany(owned) : undefined,
      dims.includes("reviews") ? reviewsForMany(owned) : undefined,
      dims.includes("tech") ? techForMany(owned) : undefined,
    ]);

    const cols = owned.map((o) => {
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
      if (pricing) col.pricing = pricing.get(o.id);
      if (hiring) col.hiring = hiring.get(o.id);
      if (reviewThemes) col.reviews = reviewThemes.get(o.id);
      if (tech) col.tech = tech.get(o.id);
      return col;
    });
    return { competitors: cols };
  },
};

export const ASK_TOOLS: AskTool[] = [
  listCompetitors,
  getCompetitorProfile,
  getSignals,
  rankHiring,
  rankPricing,
  rankReviews,
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
