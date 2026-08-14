import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  audiencePages,
  caseStudies,
  messagingVersions,
  namedCompetitors,
} from "@outrival/db";
import { db } from "./db";
import { analyticsQuery } from "./analytics-safe";
import { industryLabel, pricingModelOf, type MeteredRow, type PricingModel } from "@outrival/shared";
import { PAGE_SOURCES } from "@outrival/scrapers/positioning";
import { namedBy } from "./market-map";
import { shareOfModelFor, type ShareOfModel } from "./share-of-model";

/**
 * The two reads the Positioning tab needs that no other endpoint answers
 * (Positioning Intelligence v2 P4).
 *
 * P4 is an assembly phase: the narrative, the claims, the market map and the ICP
 * already have endpoints of their own (P1/P2/P3), and this file deliberately does
 * not wrap them. What is here is only what was missing — the identity line above
 * the sections, and the deterministic fact set the battle card renders.
 *
 * Nothing in this file calls a model. Every value is read off a captured row.
 */

/** A comparison target opened inside this window still reads as a live front. */
export const COMPARISON_TARGET_WINDOW_DAYS = 90;

/** Claims carried by the battle-card section. Three is a talking point. */
const FACT_CLAIMS_SHOWN = 3;
/** Comparison targets named in the section before it becomes a list. */
const FACT_TARGETS_SHOWN = 3;
/** Personas / industries named in the section. */
const FACT_SEGMENTS_SHOWN = 4;

export interface PositioningSummary {
  /** How they charge, from the same pure function the compare price lens uses. */
  pricingModel: PricingModel | null;
  /**
   * When the current wording was first captured — and only when an EARLIER
   * wording exists. One version is a first capture, not a repositioning, and
   * dating a competitor's story to the day we started watching them would put a
   * "changed 3 days ago" badge on every competitor added this week.
   */
  lastRepositionedAt: string | null;
  versionsTotal: number;
  /**
   * What the answer engines say about them (P5).
   *
   * Three states, and the section renders all three: nothing collected yet, not
   * enough runs in the window to average, or the real board. It stays on this
   * response rather than moving to an endpoint of its own so the tab paints the
   * section in the same pass as the identity line above it.
   */
  shareOfModel: ShareOfModel;
}

/** The rows `pricingModelOf` reads, as pricing_history stores them. */
interface PricingRow {
  plan_name: string;
  price: number | null;
  currency: string | null;
  billing_period: string | null;
  unit: string | null;
}

export async function positioningSummary(args: {
  competitorId: string;
  orgId: string;
}): Promise<PositioningSummary> {
  const { competitorId, orgId } = args;

  const [pricingRows, versions, som] = await Promise.all([
    // The latest LIVE batch only. An override is a number a user typed, and the
    // badge is a claim about how the competitor charges, not about what we show.
    analyticsQuery<PricingRow>(sql`
      SELECT plan_name, price, currency, billing_period, unit
      FROM pricing_history
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at = (
          SELECT max(recorded_at) FROM pricing_history
          WHERE competitor_id = ${competitorId} AND origin = 'live'
        )
    `),
    db
      .select({
        capturedAt: messagingVersions.capturedAt,
        total: sql<number>`count(*) over ()`,
      })
      .from(messagingVersions)
      .where(eq(messagingVersions.competitorId, competitorId))
      .orderBy(desc(messagingVersions.capturedAt))
      .limit(1),
    shareOfModelFor({ competitorId, orgId }),
  ]);

  const newest = versions[0];
  const versionsTotal = Number(newest?.total ?? 0);

  return {
    pricingModel: pricingModelOf((pricingRows ?? []) as MeteredRow[]),
    lastRepositionedAt:
      newest && versionsTotal >= 2 ? newest.capturedAt.toISOString() : null,
    versionsTotal,
    shareOfModel: som,
  };
}

// ---------------------------------------------------------------------------
// Battle card — the deterministic fact set
// ---------------------------------------------------------------------------

/**
 * What the battle card's Positioning section states, and nothing else.
 *
 * Every field is nullable and every list can be empty, because the section
 * renders one line per fact and drops the line when the fact is missing. A card
 * for a competitor we started watching yesterday must lose four lines and keep
 * the fifth, not print "unknown" four times — the same rule the customer-proof
 * block learned the hard way (a data gap read back to the model as a weakness).
 */
export interface PositioningFacts {
  tagline: {
    /** Their current hero headline, verbatim. */
    h1: string;
    /** When this wording was FIRST captured. */
    capturedAt: string;
    /** Their current primary CTA, when the capture carried one. */
    primaryCta: string | null;
    /** The wording it replaced, when there is one. */
    previousH1: string | null;
  } | null;
  /** Their loudest quantified claims, as the page printed them. */
  claims: Array<{ rawText: string; observedAt: string }>;
  /** Rivals they built a comparison PAGE against. A blog mention is not one. */
  comparison: {
    /** Targets first seen inside the window, newest first. */
    recent: string[];
    /** Names for the sentence, recent first then the rest. */
    named: string[];
    total: number;
    windowDays: number;
  } | null;
  icp: {
    personas: string[];
    /** Verticals they publish a page for AND have stories in, else the declared. */
    industries: string[];
    /** True when `industries` is the proven-and-declared intersection. */
    industriesProven: boolean;
  } | null;
  /** How many competitors in THIS workspace name them in public. */
  namedByCount: number;
}

/** Empty in every dimension — the section hides rather than render this. */
export function isPositioningFactsEmpty(f: PositioningFacts): boolean {
  return (
    f.tagline === null &&
    f.claims.length === 0 &&
    f.comparison === null &&
    f.icp === null &&
    f.namedByCount === 0
  );
}

export async function positioningFacts(args: {
  competitorId: string;
  orgId: string;
  competitorName: string;
  competitorUrl: string | null;
}): Promise<PositioningFacts> {
  const { competitorId, orgId } = args;
  const cutoff = new Date(Date.now() - COMPARISON_TARGET_WINDOW_DAYS * 86_400_000);

  const [versions, claimRows, targets, recentTargets, personaRows, provenRows, namers] =
    await Promise.all([
      // Two rows: the current wording and the one it replaced. The pair is what
      // makes "they repositioned" a fact rather than "this is their headline".
      db
        .select({
          h1: messagingVersions.h1,
          primaryCta: messagingVersions.primaryCta,
          capturedAt: messagingVersions.capturedAt,
        })
        .from(messagingVersions)
        .where(eq(messagingVersions.competitorId, competitorId))
        .orderBy(desc(messagingVersions.capturedAt))
        .limit(2),
      // One row per claim key, latest observation, most recent first. The battle
      // card quotes `raw_text`: a claim reworded into our own numbers is exactly
      // the kind of line a prospect can disprove on their homepage.
      analyticsQuery<{ raw_text: string; observed_at: string }>(sql`
        SELECT DISTINCT ON (pattern, unit, context)
               raw_text, observed_at::text AS observed_at
        FROM numeric_claims
        WHERE competitor_id = ${competitorId}
        ORDER BY pattern, unit, context, observed_at DESC
      `),
      // Page sources only, in BOTH queries. The card states this as "they publish
      // comparison pages against X", so a name a blog post happened to write must
      // never reach it — that sentence would be false about a company they have
      // never built a page against.
      db
        .select({ n: sql<number>`count(distinct ${namedCompetitors.nameNormalized})::int` })
        .from(namedCompetitors)
        .where(
          and(
            eq(namedCompetitors.competitorId, competitorId),
            inArray(namedCompetitors.source, [...PAGE_SOURCES]),
          ),
        ),
      db
        .selectDistinctOn([namedCompetitors.nameNormalized], {
          name: namedCompetitors.displayName,
          firstSeenAt: namedCompetitors.firstSeenAt,
        })
        .from(namedCompetitors)
        .where(
          and(
            eq(namedCompetitors.competitorId, competitorId),
            inArray(namedCompetitors.source, [...PAGE_SOURCES]),
            gte(namedCompetitors.firstSeenAt, cutoff),
          ),
        )
        .orderBy(namedCompetitors.nameNormalized, desc(namedCompetitors.firstSeenAt)),
      db
        .select({
          kind: audiencePages.kind,
          slug: audiencePages.slug,
          displayName: audiencePages.displayName,
        })
        .from(audiencePages)
        .where(eq(audiencePages.competitorId, competitorId))
        .orderBy(desc(audiencePages.firstSeenAt)),
      db
        .select({ slug: caseStudies.customerIndustry })
        .from(caseStudies)
        .where(
          and(
            eq(caseStudies.competitorId, competitorId),
            sql`${caseStudies.customerIndustry} is not null`,
          ),
        ),
      namedBy({
        competitorId,
        orgId,
        name: args.competitorName,
        url: args.competitorUrl,
      }),
    ]);

  const current = versions[0];
  const previous = versions[1];
  const tagline =
    current?.h1
      ? {
          h1: current.h1,
          capturedAt: current.capturedAt.toISOString(),
          primaryCta: current.primaryCta,
          previousH1: previous?.h1 ?? null,
        }
      : null;

  const claims = (claimRows ?? [])
    .filter((r) => r.raw_text?.trim())
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
    .slice(0, FACT_CLAIMS_SHOWN)
    .map((r) => ({ rawText: r.raw_text.trim(), observedAt: r.observed_at }));

  const targetsTotal = Number(targets[0]?.n ?? 0);
  const recent = [...recentTargets]
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
    .map((t) => t.name);
  const comparison =
    targetsTotal > 0
      ? {
          recent,
          named: recent.slice(0, FACT_TARGETS_SHOWN),
          total: targetsTotal,
          windowDays: COMPARISON_TARGET_WINDOW_DAYS,
        }
      : null;

  const personas = personaRows
    .filter((p) => p.kind === "persona")
    .map((p) => p.displayName)
    .slice(0, FACT_SEGMENTS_SHOWN);
  const declared = personaRows.filter((p) => p.kind === "industry");
  const provenSlugs = new Set(
    provenRows.map((r) => r.slug).filter((s): s is string => typeof s === "string"),
  );
  // Proven-and-declared first: a vertical with stories behind it is a claim we can
  // hand a salesperson. Falling back to the declared list keeps the line honest by
  // being labelled differently, never by pretending the stories exist.
  const both = declared.filter((d) => provenSlugs.has(d.slug));
  const industriesProven = both.length > 0;
  const industries = (industriesProven ? both : declared)
    .map((d) => industryLabel(d.slug) || d.displayName)
    .slice(0, FACT_SEGMENTS_SHOWN);

  const icp =
    personas.length > 0 || industries.length > 0
      ? { personas, industries, industriesProven }
      : null;

  return { tagline, claims, comparison, icp, namedByCount: namers.length };
}
