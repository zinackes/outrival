import { Hono } from "hono";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  isNotNull,
  ne,
  or,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import { captureServerEvent } from "../lib/posthog";
import {
  detectPlatform,
  scrapeMonitor,
  refreshCompetitorSummary,
  USER_SCRAPE_PRIORITY,
} from "@outrival/queue";
import {
  competitors,
  monitors,
  changes,
  signals,
  snapshots,
  jobPostings,
  postingFacts,
  reviews,
  techStackEntries,
  organizations,
  products,
  productCompetitors,
  caseStudies,
  knownCustomers,
} from "@outrival/db";
import { db } from "../lib/db";
import { scoreCompetitorOverlap, scoreCompetitorsOverlap } from "../lib/overlap";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import {
  associateCompetitorWithScopedProduct,
  liveProductId,
  productCompetitorIds,
} from "../lib/products";
import {
  seedCompetitorMonitors,
  enqueueFirstScrapes,
  addSourcesToCompetitors,
} from "../lib/seed-monitors";
import { analyticsQuery } from "../lib/analytics-safe";
import { notFound } from "../lib/errors";
import { translateToEnglish } from "../lib/translate";
import { detectContentLanguage } from "../lib/detect-language";
import { readGtm, productNavItems, type GtmRead } from "../lib/homepage-gtm";
import { dedupeVerbatims } from "../lib/review-verbatims";
import {
  checkCompetitorQuota,
  getOrgPlan,
  isFrequencyAllowed,
  pausedByPlanCap,
} from "../lib/plan";
import {
  SOURCE_TYPES,
  MONITOR_FREQUENCIES,
  PRICING_STATUSES,
  isReviewSource,
  validateMonitorUrl,
  validateCustomMonitorUrl,
  normalizeCustomUrl,
  CUSTOM_MONITOR_HINTS,
  customMonitorLimit,
  validatePublicUrl,
  aggregateFreshness,
  deriveAnalysisStatus,
  computeNextScanAt,
  TECH_STACK_SCRAPE_INTERVAL_DAYS,
  isValidCompetitorColor,
  COMPETITOR_NAME_MAX_LENGTH,
  classifyLogoName,
  isBlankSvgDataUri,
  isStoreBadgeSrc,
  isLanguageFlagSrc,
  resolveCurrentPricing,
  normalizePlanKey,
  DEPARTMENT_BUCKETS,
  DEPARTMENT_BUCKET_LABELS,
  disclosureVerdict,
  isCountryKey,
  getBytesFromR2,
  getFromR2,
  isHiddenSource,
  isAutomaticSource,
  isConfigurableSource,
  planAllowsMonitorSource,
  isRefused,
  blockedReach,
  buildCoverage,
  type SourceState,
  creditBurnActionKey,
  industryLabel,
  type SourceType,
  type MonitorFrequency,
  type PricingTier,
  type PricingPlanOverride,
  type CompetitorOverrides,
  type DepartmentBucket,
} from "@outrival/shared";

type Variables = { user: { id: string } };

export const competitorsRouter = new Hono<{ Variables: Variables }>();

competitorsRouter.use("*", authMiddleware);

const CreateCompetitorSchema = z.object({
  name: z.string().min(1).max(COMPETITOR_NAME_MAX_LENGTH),
  url: z.string().url(),
  description: z.string().optional(),
  // The product scope the competitor is being added from. Loose on purpose: an id that
  // doesn't resolve in this org falls back to the primary product rather than 400-ing a
  // create over a stale cookie.
  productId: z.string().min(1).optional(),
});

// Resolves a competitor the caller owns, EXCLUDING soft-deleted rows (deletedAt).
// A deleted competitor must be invisible everywhere it's served — the detail page
// and every sub-route (signals/jobs/reviews/pricing…) resolve through this helper,
// so filtering here 404s them all at once instead of relying on a per-handler check.
async function assertOwnedCompetitor(competitorId: string, orgId: string) {
  return db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
}

// Subset of @outrival/scrapers' HomepageStructure we read off the snapshot jsonb.
// The API can't import the scrapers package (monorepo boundary), so the shape the
// parser produces (patch-16/17) is restated here for the fields the fact sheet needs.
type StoredHomepage = {
  language?: string | null;
  hero?: {
    headline?: string | null;
    subheadline?: string | null;
    primaryCta?: { text?: string | null; href?: string | null } | null;
    secondaryCta?: { text?: string | null; href?: string | null } | null;
  };
  navigation?: { items?: Array<{ text?: string | null; href?: string | null }> };
  sections?: Array<{ heading?: string; type?: string }>;
  socialProof?: {
    // Legacy snapshots stored a single string (alt || src); patch stores objects.
    customerLogos?: Array<string | { name?: string | null; src?: string | null }>;
    testimonials?: Array<{ quote?: string; author?: string | null }>;
  };
};

// A captured customer logo surfaced to the fact sheet: brand name and/or absolute
// image URL. Old string-shaped entries are mapped into this by `toLogo` below.
type FactSheetLogo = { name: string | null; src: string | null };

function toLogo(entry: string | { name?: string | null; src?: string | null }): FactSheetLogo {
  if (typeof entry === "string") {
    const v = entry.trim();
    // Legacy single string was alt-or-src: an absolute URL is the image, else a name.
    return /^(https?:\/\/|data:image\/)/i.test(v)
      ? { name: null, src: v }
      : { name: v || null, src: null };
  }
  return { name: entry.name?.trim() || null, src: entry.src?.trim() || null };
}

// Brand tokens that identify the competitor itself (its name + the second-level
// host label), normalized to lowercase alphanumerics. Used to strip the
// competitor's OWN logo from its "customers" wall.
function brandTokensFor(name: string | null, url: string | null): string[] {
  const tokens = new Set<string>();
  const add = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (t.length >= 4) tokens.add(t); // >= 4 avoids a short token (e.g. "box") matching real customers
  };
  if (name) add(name);
  if (url) {
    try {
      add(new URL(url).host.replace(/^www\./, "").split(".")[0] ?? "");
    } catch {
      /* malformed url — name token alone */
    }
  }
  return [...tokens];
}

// The broad social-proof selector also matches header/footer brand marks and
// tracking pixels, so a competitor's own logo (and blank placeholders) otherwise
// show up repeated on its "customers" wall. Drop them at read time so already-
// captured snapshots clean up without a re-scrape.
function isOwnOrJunkLogo(
  logo: FactSheetLogo,
  brandTokens: string[],
  competitorHost: string | null,
): boolean {
  const nameStem = (logo.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (nameStem && brandTokens.some((t) => nameStem.includes(t))) return true;
  const src = logo.src ?? "";
  // data: gif/png tracking pixels render as blank tiles, never a real logo.
  if (/^data:image\/(gif|png);base64,/i.test(src) && src.length < 512) return true;
  if (!src) return false;
  try {
    const u = new URL(src);
    if (competitorHost && u.host.replace(/^www\./, "") === competitorHost) {
      const file = (u.pathname.split("/").pop() ?? "").toLowerCase();
      const stem = file.replace(/\.(png|jpe?g|svg|webp|gif|avif|ico)$/i, "");
      // Own-hosted asset whose filename is literally "logo*" or carries the brand
      // (customer logos under /customers/ are filed by the CUSTOMER's name).
      if (/^logo\b/.test(stem) || brandTokens.some((t) => stem.includes(t))) return true;
    }
  } catch {
    /* relative/garbage src — the renderer drops unrenderable ones */
  }
  return false;
}

// Map a stored logo entry to a clean fact-sheet logo, or null to drop it. Runs
// the shared brand-name classifier (frames, colour codes, review/compliance
// badges, person names, descriptive phrases are NOT customers), recovers the
// clean brand name ("ramp client logo" → "ramp"), drops blank-SVG spacers and
// store-download badges, and finally the competitor's own/junk marks. Read-time
// so already-captured snapshots clean up without a re-scrape.
function refineLogo(
  raw: string | { name?: string | null; src?: string | null },
  brandTokens: string[],
  competitorHost: string | null,
): FactSheetLogo | null {
  const logo = toLogo(raw);
  const verdict = classifyLogoName(logo.name);
  if (verdict.kind === "junk") return null;
  const name = verdict.kind === "brand" ? verdict.name : null;

  let src = logo.src;
  if (src && (isBlankSvgDataUri(src) || isStoreBadgeSrc(src) || isLanguageFlagSrc(src)))
    src = null;

  const cleaned: FactSheetLogo = { name, src };
  if (!cleaned.name && !cleaned.src) return null;
  if (isOwnOrJunkLogo(cleaned, brandTokens, competitorHost)) return null;
  return cleaned;
}

// The homepage "fact sheet" fields surfaced on the Overview tab, derived from the
// latest homepage snapshot's parsed structure (patch-16/17). Shared by the overview
// builder and the on-demand translate route, which reads the same source strings.
type HomepageFacts = {
  language: string | null;
  headline: string | null;
  subheadline: string | null;
  valueProps: string[];
  customerLogos: FactSheetLogo[];
  testimonials: Array<{ quote: string; author: string | null }>;
  // How they ask a visitor to buy, and the product vocabulary in their own nav.
  // Both come out of the same stored structure as the copy above, so they cost no
  // extra query and exist on every capture we already hold.
  gtm: GtmRead;
  navItems: string[];
};

// Latest parsed homepage structure for a competitor → fact-sheet shape. Self-
// contained (resolves the homepage monitor + newest successful snapshot itself)
// so both buildOverview and the translate route can reuse it. Null when nothing
// captured / pre-patch snapshot.
// How many recent homepage captures the positioning history walks. A daily
// homepage scrape makes this roughly a year of history, and it bounds the query
// by work done rather than by versions found: a competitor that never rewrites
// its homepage must not make us read its entire snapshot table.
const POSITIONING_HISTORY_SCAN_LIMIT = 400;
// Distinct rewrites returned. Past a handful the list stops being a story.
const POSITIONING_HISTORY_MAX_VERSIONS = 12;

/**
 * The copy a competitor positions itself with, derived from one stored homepage
 * structure. Shared by the fact sheet and by the positioning history, so a "then"
 * capture and a "now" capture are always derived the same way. Re-implementing
 * this for the history would make any drift in the derivation look like drift in
 * their messaging, which is the one thing an over-time view must never invent.
 */
function positioningCopyOf(s: StoredHomepage): {
  headline: string | null;
  subheadline: string | null;
  valueProps: string[];
} {
  // Section headings carrying the value proposition (feature blocks and
  // integration showcases), in document order, capped for the glance.
  // Scroll-driven "stepped" layouts repeat a mockup label (e.g. an H3
  // "Product Brief") across every panel, and it classifies as a feature
  // heading — so dedupe case-insensitively and drop any heading recurring
  // 3+ times (a template/UI label, never a distinct highlight).
  const headings = (s.sections ?? [])
    .filter((sec) => sec.type === "features" || sec.type === "integrations")
    .map((sec) => sec.heading?.trim() ?? "")
    .filter((h) => h.length > 0);
  const counts = new Map<string, number>();
  for (const h of headings) {
    const k = h.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const valueProps: string[] = [];
  for (const h of headings) {
    const k = h.toLowerCase();
    if ((counts.get(k) ?? 0) >= 3) continue; // template/UI label, not a highlight
    if (seen.has(k)) continue;
    seen.add(k);
    valueProps.push(h);
  }
  return {
    headline: s.hero?.headline ?? null,
    subheadline: s.hero?.subheadline ?? null,
    valueProps: valueProps.slice(0, 8),
  };
}

async function buildHomepageFacts(
  competitorId: string,
): Promise<{ capturedAt: Date | null; homepage: HomepageFacts | null }> {
  const [homepageMonitor] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "homepage")))
    .limit(1);
  if (!homepageMonitor) return { capturedAt: null, homepage: null };

  const [snap] = await db
    .select({ structure: snapshots.homepageStructure, scrapedAt: snapshots.scrapedAt })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.monitorId, homepageMonitor.id),
        eq(snapshots.status, "success"),
        isNotNull(snapshots.homepageStructure),
      ),
    )
    .orderBy(desc(snapshots.scrapedAt))
    .limit(1);
  if (!snap?.structure) return { capturedAt: null, homepage: null };

  // Own-logo / placeholder filtering needs the competitor's own brand + host.
  const [comp] = await db
    .select({ name: competitors.name, url: competitors.url })
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);
  const brandTokens = brandTokensFor(comp?.name ?? null, comp?.url ?? null);
  let competitorHost: string | null = null;
  try {
    if (comp?.url) competitorHost = new URL(comp.url).host.replace(/^www\./, "");
  } catch {
    /* malformed competitor url */
  }

  const s = snap.structure as StoredHomepage;

  const { headline, subheadline, valueProps } = positioningCopyOf(s);
  const testimonials = (s.socialProof?.testimonials ?? [])
    .map((t) => ({ quote: t.quote?.trim() ?? "", author: t.author ?? null }))
    .filter((t) => t.quote.length > 0)
    .slice(0, 3);

  // Real customer brands only: classify each captured logo, dedupe by clean name
  // (so "ramp client logo" and "ramp logo" collapse to one) / image, cap for the
  // glance.
  const seenLogo = new Set<string>();
  const customerLogos: FactSheetLogo[] = [];
  for (const entry of s.socialProof?.customerLogos ?? []) {
    const l = refineLogo(entry, brandTokens, competitorHost);
    if (!l) continue;
    const key = (l.name ?? l.src ?? "").toLowerCase();
    if (!key || seenLogo.has(key)) continue;
    seenLogo.add(key);
    customerLogos.push(l);
    if (customerLogos.length >= 24) break;
  }

  // Drive the foreign-language badge + Translate action off the actual scraped
  // copy, not just <html lang>: pages routinely declare lang="en" (or nothing)
  // while the body — or only the subheadline under an English headline — is in
  // another language, which left the Translate button hidden. Detect on the
  // aggregated text; fall back to <html lang> when there's too little copy for a
  // confident guess.
  const detectedLanguage = detectContentLanguage(
    [headline, subheadline, ...valueProps, ...testimonials.map((t) => t.quote)]
      .filter((t): t is string => !!t)
      .join(". "),
  );

  return {
    capturedAt: snap.scrapedAt,
    homepage: {
      language: detectedLanguage ?? s.language ?? null,
      headline,
      subheadline,
      valueProps,
      customerLogos,
      testimonials,
      gtm: readGtm(s.hero),
      navItems: productNavItems(s.navigation?.items, brandTokens),
    },
  };
}

// "Fact sheet" / state view of a competitor (Overview tab): the current homepage
// facts we capture but never surfaced — positioning, value props, customers,
// numeric claims — plus a compact snapshot of pricing/hiring/reviews. Pure
// surfacing of existing data: no AI call, no scrape. Analytics reads are
// best-effort (return [] on error), so the fact sheet degrades gracefully.
async function buildOverview(competitorId: string) {
  // Eight independent reads about ONE competitor, previously issued one at a time.
  // None of them feeds another — they are eight separate questions about the same
  // competitor id — so the handler paid eight network round-trips to answer them in
  // a fixed order nothing required. This sits on the competitor detail page's
  // critical path, the page the product is actually read from.
  const [
    facts,
    numericClaims,
    pricingNow,
    reviews,
    hiringRows,
    pricingMovedRows,
    rolesDeltaRows,
    scoreDeltaRows,
  ] = await Promise.all([
    // Positioning + value props + social proof from the latest homepage snapshot's
    // parsed structure (only homepage snapshots carry it; null pre-patch).
    buildHomepageFacts(competitorId),

    analyticsQuery<{
      pattern: string;
      value: number | null;
      unit: string | null;
      raw_text: string;
    }>(sql`
      SELECT pattern, value, unit, raw_text
      FROM (
        SELECT DISTINCT ON (pattern) pattern, value, unit, raw_text, observed_at
        FROM numeric_claims
        WHERE competitor_id = ${competitorId}
          AND observed_at >= now() - make_interval(days => 90)
        ORDER BY pattern, observed_at DESC
      ) t
      ORDER BY observed_at DESC
      LIMIT 8
    `),

    // Current tier set = the most recent recorded_at batch for this competitor.
    analyticsQuery<{
      plan_name: string;
      price: number | null;
      currency: string;
      billing_period: string;
    }>(sql`
      SELECT plan_name, price, currency, billing_period
      FROM pricing_history
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at = (
          SELECT max(recorded_at) FROM pricing_history
          WHERE competitor_id = ${competitorId} AND origin = 'live'
        )
      ORDER BY price ASC
    `),

    analyticsQuery<{
      source: string;
      score: number;
      review_count: number;
      sentiment_score: number;
    }>(sql`
      SELECT source, score, review_count, sentiment_score
      FROM (
        SELECT DISTINCT ON (source) source, score, review_count, sentiment_score, recorded_at
        FROM review_scores
        WHERE competitor_id = ${competitorId}
        ORDER BY source, recorded_at DESC
      ) t
      ORDER BY recorded_at DESC
    `),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobPostings)
      .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true))),

    // --- Movement ---------------------------------------------------------------
    // The overview stated levels only, and on a monitoring product the derivative is
    // the product: "3 open roles" is inventory, "+2 this month" is the finding. Each
    // of these is best-effort like everything else here, so a missing series simply
    // leaves its delta null and the cell renders as a level.

    // When the entry price last differed from today's. Compared on the CHEAPEST
    // priced tier per batch, not on the batch as a whole: a competitor adding a top
    // tier has not moved its entry point, and reading any row would call that a
    // price change.
    analyticsQuery<{ changed_at: string | null }>(sql`
      WITH entry AS (
        SELECT recorded_at, min(price) AS price
        FROM pricing_history
        WHERE competitor_id = ${competitorId} AND origin = 'live'
          AND price IS NOT NULL AND price > 0
        GROUP BY recorded_at
      )
      SELECT max(recorded_at)::text AS changed_at
      FROM entry
      WHERE price IS DISTINCT FROM (SELECT price FROM entry ORDER BY recorded_at DESC LIMIT 1)
    `),

    // Open-role movement over 30 days, from the job_counts series rather than from
    // the live postings table, so it reflects what we OBSERVED rather than what
    // happens to be flagged active right now.
    analyticsQuery<{ delta: number | null }>(sql`
      WITH totals AS (
        SELECT recorded_at, sum(count) AS total
        FROM job_counts
        WHERE competitor_id = ${competitorId}
          AND recorded_at >= now() - make_interval(days => 30)
        GROUP BY recorded_at
      )
      SELECT (
        (SELECT total FROM totals ORDER BY recorded_at DESC LIMIT 1) -
        (SELECT total FROM totals ORDER BY recorded_at ASC LIMIT 1)
      )::int AS delta
      FROM totals
      LIMIT 1
    `),

    // Rating movement over 90 days for the source the headline rating comes from.
    // Mixing sources would compare an App Store score against a Trustpilot one.
    analyticsQuery<{ delta: number | null }>(sql`
      WITH latest AS (
        SELECT source, score, recorded_at
        FROM review_scores
        WHERE competitor_id = ${competitorId}
        ORDER BY recorded_at DESC
        LIMIT 1
      )
      SELECT (
        (SELECT score FROM latest) -
        (SELECT score FROM review_scores
          WHERE competitor_id = ${competitorId}
            AND source = (SELECT source FROM latest)
            AND recorded_at >= now() - make_interval(days => 90)
          ORDER BY recorded_at ASC LIMIT 1)
      )::real AS delta
      FROM latest
    `),
  ]);

  const { capturedAt, homepage } = facts;
  const hiringRow = hiringRows[0];
  const pricingMoved = pricingMovedRows[0];
  const rolesDelta = rolesDeltaRows[0];
  const scoreDelta = scoreDeltaRows[0];

  return {
    capturedAt,
    homepage,
    numericClaims,
    pricingNow,
    reviews,
    hiring: { openRoles: hiringRow?.count ?? 0 },
    movement: {
      // Null when the entry price has never differed, which is "unchanged for as
      // long as we have watched" and reads differently from "changed recently".
      entryPriceChangedAt: pricingMoved?.changed_at ?? null,
      openRoles30d: rolesDelta?.delta ?? null,
      reviewScore90d: scoreDelta?.delta ?? null,
    },
  };
}

/* ── Bulk actions over a roster selection ──────────────────────────────────────
 *
 * The competitors list lets the user select rows and act on all of them at once.
 * These routes are registered BEFORE every "/:id/…" route below on purpose: Hono
 * matches in registration order, so declared later they would be swallowed as a
 * competitor whose id is the literal string "bulk".
 *
 * Each one resolves the selection through ONE org-scoped read (resolveBulkSelection),
 * so the tenant guard is the query rather than a per-id check, and an id belonging to
 * another org is simply absent from the result instead of erroring the whole sweep.
 * The self-competitor is excluded everywhere: it is the user's own product, it has its
 * own page, and no roster sweep should be able to pause or delete it.
 */

// A selection is what fits on screen and in a user's head, not a whole database.
const BULK_MAX = 200;
// AI actions cap lower. Re-scoring puts every selected competitor's evidence into ONE
// prompt, and the reply carries one row per competitor: past this the JSON gets
// truncated, which parses as "nobody scored" rather than as an error.
const BULK_AI_MAX = 25;

const BulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(BULK_MAX),
});
const BulkAiIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(BULK_AI_MAX),
});

/**
 * The rows a bulk action may touch. Deliberately narrow: id/name label the outcome,
 * url + description + aiSummary are the overlap scorer's evidence ladder, and the two
 * flags let a handler report what actually changed.
 */
async function resolveBulkSelection(orgId: string, ids: string[]) {
  return db.query.competitors.findMany({
    where: and(
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
      ne(competitors.type, "self"),
      inArray(competitors.id, [...new Set(ids)]),
    ),
    columns: {
      id: true,
      name: true,
      url: true,
      description: true,
      aiSummary: true,
      overlapScore: true,
      monitoringPaused: true,
      alertsMuted: true,
    },
  });
}

// Pause / resume monitoring across the selection. Same semantics as the per-competitor
// route: the scheduler skips a paused competitor without touching its monitors' own
// isActive flags, so resuming restores each source's prior state.
competitorsRouter.post("/bulk/monitoring", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkIdsSchema.extend({ paused: z.boolean() }).safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ ok: true, updated: 0 });

  await db
    .update(competitors)
    .set({ monitoringPaused: parsed.data.paused, updatedAt: new Date() })
    .where(inArray(competitors.id, rows.map((r) => r.id)));

  return c.json({ ok: true, updated: rows.length, paused: parsed.data.paused });
});

// Mute / unmute real-time alerts across the selection. Signals keep being tracked and
// still reach the feed and the digests; only the immediate send is skipped.
competitorsRouter.post("/bulk/alerts", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkIdsSchema.extend({ muted: z.boolean() }).safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ ok: true, updated: 0 });

  await db
    .update(competitors)
    .set({ alertsMuted: parsed.data.muted, updatedAt: new Date() })
    .where(inArray(competitors.id, rows.map((r) => r.id)));

  return c.json({ ok: true, updated: rows.length, muted: parsed.data.muted });
});

/**
 * Re-score the selection's overlap, each competitor against the product it belongs
 * to — the roster-wide version of the kebab action, and the one the whole feature
 * was asked for: after a product profile changes, every competitor's score is stale
 * at once.
 *
 * ONE model call per product in the set (scoreOverlap grades a list, independently
 * per entry against the fixed scale), so this costs one rate-limit hit instead of N,
 * and a competitor with nothing to judge it on keeps the score it already has rather
 * than taking one derived from a bare domain.
 */
competitorsRouter.post("/bulk/recompute-overlap", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkAiIdsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ scored: [], skipped: [] });

  const outcomes = await scoreCompetitorsOverlap(orgId, rows);

  const scored: Array<{ id: string; name: string; overlapScore: number }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  rows.forEach((row, i) => {
    const outcome = outcomes[i];
    if (outcome?.status === "scored") {
      scored.push({ id: row.id, name: row.name, overlapScore: outcome.overlapScore });
    } else {
      skipped.push({ id: row.id, name: row.name, reason: outcome?.status ?? "failed" });
    }
  });

  const now = new Date();
  await Promise.all(
    scored.map((s) =>
      db
        .update(competitors)
        .set({ overlapScore: s.overlapScore, updatedAt: now })
        .where(eq(competitors.id, s.id)),
    ),
  );

  return c.json({ scored, skipped });
});

/**
 * Re-run the AI summary for the selection. Unlike the per-competitor action these
 * jobs land silently (no "summary ready" notification each): twenty-five durable
 * notifications for one click is the notification spam the moderation layer exists to
 * prevent. The roster polls, so each row updates as its job finishes.
 */
competitorsRouter.post("/bulk/refresh-summary", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkAiIdsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ enqueued: 0 });

  let enqueued = 0;
  for (const row of rows) {
    try {
      await enqueueJob(refreshCompetitorSummary, {
        competitorId: row.id,
        notifyOnComplete: false,
      });
      enqueued++;
    } catch (e) {
      // One failed enqueue must not lose the rest of the sweep.
      console.error("Failed to enqueue bulk summary refresh", {
        competitorId: row.id,
        error: String(e),
      });
    }
  }

  return c.json({ enqueued });
});

/**
 * Move the selection to a product. A competitor belongs to exactly ONE product, so
 * this REPLACES its membership instead of adding a second link: the junction row IS
 * the membership, and leaving the old link behind would put the competitor in two
 * feeds while the UI shows one.
 *
 * Past signals keep the product tags they were written with (`signals.product_ids` is
 * stamped at classification time) — this changes who tracks the competitor from now
 * on, not the history.
 */
competitorsRouter.post("/bulk/product", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkIdsSchema.extend({ productId: z.string().min(1) }).safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const orgProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.orgId, orgId));
  const target = orgProducts.find((p) => p.id === parsed.data.productId);
  if (!target) return c.json({ error: "product_not_found" }, 404);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ ok: true, moved: 0 });
  const ids = rows.map((r) => r.id);

  // Scoped to this org's products: a link is only ever dropped from a product the
  // caller owns, so a corrupt cross-org row can't be touched from here.
  await db
    .delete(productCompetitors)
    .where(
      and(
        inArray(productCompetitors.competitorId, ids),
        inArray(
          productCompetitors.productId,
          orgProducts.map((p) => p.id),
        ),
      ),
    );
  await db
    .insert(productCompetitors)
    .values(
      rows.map((r) => ({
        productId: target.id,
        competitorId: r.id,
        relevanceScore: r.overlapScore ?? null,
      })),
    )
    .onConflictDoNothing();

  return c.json({ ok: true, moved: ids.length, productId: target.id });
});

/**
 * Turn one source on across the selection — the roster answer to "I just realised I'm
 * not watching anyone's pricing page". ADD only and idempotent: a competitor that
 * already has the source (even switched off) keeps its row untouched.
 *
 * Only sources that need no per-competitor URL are accepted. App Store reviews and a
 * GitHub repo can't be derived from a domain, so enabling them in bulk could only
 * create monitors that fail every run — they stay on the per-competitor flow.
 */
competitorsRouter.post("/bulk/sources", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkIdsSchema.extend({ sourceType: z.enum(SOURCE_TYPES) }).safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const { sourceType } = parsed.data;
  if (!isConfigurableSource(sourceType)) {
    return c.json({ error: "source_not_enableable", source: sourceType }, 400);
  }
  if (isReviewSource(sourceType) || sourceType === "github_repo") {
    return c.json({ error: "source_requires_url", source: sourceType }, 400);
  }
  // Plan is per-org, so it is checked once here rather than once per competitor.
  const plan = await getOrgPlan(orgId);
  if (!planAllowsMonitorSource(plan, sourceType)) {
    return c.json({ error: "plan_locked_source", source: sourceType, plan }, 403);
  }
  if (sourceType === "trustpilot_public" && !process.env.TRUSTPILOT_API_KEY) {
    return c.json({ error: "trustpilot_key_missing", source: sourceType }, 400);
  }

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ created: 0, competitorsTouched: 0 });

  const result = await addSourcesToCompetitors({
    sources: [sourceType],
    competitorIds: rows.map((r) => r.id),
  });

  void captureServerEvent(user.id, "monitor_enabled", {
    sourceType,
    orgId,
    bulk: true,
    competitors: result.competitorsTouched,
  });

  return c.json({ created: result.created, competitorsTouched: result.competitorsTouched });
});

// Soft-delete the selection. Same write as the per-competitor DELETE (deletedAt), so
// everything downstream that already filters on it hides them at once.
competitorsRouter.post("/bulk/delete", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const parsed = BulkIdsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const rows = await resolveBulkSelection(orgId, parsed.data.ids);
  if (rows.length === 0) return c.json({ ok: true, deleted: 0 });

  await db
    .update(competitors)
    .set({ deletedAt: new Date() })
    .where(inArray(competitors.id, rows.map((r) => r.id)));

  void captureServerEvent(user.id, "competitor_deleted", {
    orgId,
    bulk: true,
    count: rows.length,
  });

  return c.json({ ok: true, deleted: rows.length });
});

competitorsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateCompetitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  // SSRF: this URL becomes the homepage monitor target the scraper fetches
  // directly, so reject IP literals / internal hosts before it's persisted.
  const safeUrl = validatePublicUrl(parsed.data.url);
  if (!safeUrl.ok) return c.json({ error: "invalid_url", reason: safeUrl.error }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const plan = await getOrgPlan(orgId);
  const quota = await checkCompetitorQuota(orgId, plan);
  if (!quota.allowed) {
    return c.json(
      { error: "plan_limit_competitors", used: quota.used, limit: quota.limit, plan },
      403,
    );
  }

  const [competitor] = await db
    .insert(competitors)
    .values({
      orgId,
      name: parsed.data.name,
      url: safeUrl.url,
      description: parsed.data.description ?? null,
    })
    .returning();
  if (!competitor) return c.json({ error: "Failed to create competitor" }, 500);

  // patch-28 — tag this competitor into the product the user added it from so its
  // signals show in the feed they were looking at (shared; reclassify/attach to others
  // from the UI). Without the scope this always tagged the primary, so a competitor
  // added while scoped to another SKU landed in a feed the user wasn't watching.
  await associateCompetitorWithScopedProduct(orgId, competitor.id, parsed.data.productId);

  // patch-31 — detect the platform profile (fire-and-forget) so the first scrapes
  // can route via structured connectors. Never blocks the create.
  try {
    await enqueueJob(detectPlatform, { competitorId: competitor.id });
  } catch (e) {
    console.error("Failed to trigger platform detection", {
      competitorId: competitor.id,
      error: String(e),
    });
  }

  // Score the competitive overlap against the profile of the product this competitor
  // was just linked to (best-effort, fire-and-forget) — hence after the association
  // above. The manual-add path had no overlap at all — unlike the
  // discovery-add path, which carries the score from discovery. Shares the scorer
  // (and its evidence ladder) with /recompute-overlap; the list/overview refetch
  // (while the first scrape runs) picks the value up. Nothing is written when the
  // org has no profile, or when the competitor carries no description to judge:
  // a competitor added without one is scored on its first Recompute instead,
  // once refresh-competitor-summary has given it an aiSummary.
  void (async () => {
    try {
      const outcome = await scoreCompetitorOverlap(orgId, {
        id: competitor.id,
        name: competitor.name,
        url: safeUrl.url,
        description: competitor.description,
        aiSummary: competitor.aiSummary,
      });
      if (outcome.status !== "scored") return;
      await db
        .update(competitors)
        .set({ overlapScore: outcome.overlapScore, updatedAt: new Date() })
        .where(eq(competitors.id, competitor.id));
    } catch (e) {
      console.error("Failed to score competitor overlap", {
        competitorId: competitor.id,
        error: String(e),
      });
    }
  })();

  // Seed the org's default sources (plan-narrowed) plus the internal anchors, then
  // kick their first scrape. scrapeStartedAt is stamped on seed so the detail page
  // and the list show the first scrape as in-progress straight away instead of
  // looking idle until the hourly cron.
  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { defaultSources: true },
  });
  const createdMonitors = await seedCompetitorMonitors({
    competitorId: competitor.id,
    plan,
    orgDefaultSources: orgRow?.defaultSources ?? null,
  });
  await enqueueFirstScrapes(createdMonitors);

  void captureServerEvent(user.id, "competitor_added", {
    competitorId: competitor.id,
    competitorName: competitor.name,
    orgId,
  });

  return c.json({ competitor, monitors: createdMonitors }, 201);
});

const AddMonitorSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
  // Required for review sources (g2/capterra/appstore): the exact review-page
  // URL. Validated + host-locked below.
  url: z.string().optional(),
});

// Slow-changing review sources default to weekly; everything else daily.
// Clamped to a plan-allowed frequency below (weekly is allowed on every plan).
function defaultFrequencyFor(source: SourceType): MonitorFrequency {
  // `docs` joins the weekly set: documentation moves on release cycles, and a run
  // costs a sitemap walk plus a capped batch of page fetches. `roadmap` too — a
  // portal's statuses move on sprint cadence, and the vote bands are built to ignore
  // day-to-day drift, so a daily read would spend requests to observe nothing.
  return source.endsWith("_reviews") ||
    source === "trustpilot_public" ||
    source === "docs" ||
    source === "roadmap"
    ? "weekly"
    : "daily";
}

competitorsRouter.post("/:id/monitors", async (c) => {
  const competitorId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = AddMonitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(competitorId, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Competitor not found" }, 404);

  const { sourceType } = parsed.data;
  // Custom pages are user-selectable but through their OWN flow (POST
  // /:id/custom-monitors): they carry a {url, label, hint} config, a per-competitor
  // quota, and allow several per competitor — none of which this single-source
  // enable path models. Reject here so the two never overlap.
  if (sourceType === "custom") {
    return c.json({ error: "use_custom_monitor_endpoint", source: sourceType }, 400);
  }
  // Everything else is enableable iff the shared catalog says it gets a user row —
  // one list instead of a hand-maintained exclusion chain that drifted every time a
  // source was added (it was still missing wellknown's siblings and the anchors).
  if (!isConfigurableSource(sourceType)) {
    return c.json({ error: "source_not_enableable", source: sourceType }, 400);
  }
  const plan = await getOrgPlan(orgId);
  // Mirrors the scheduler's gate (planAllowsMonitorSource) rather than the strict
  // allowlist: an UNGATED source (changelog, github_repo) belongs to no plan's
  // allowedSources, so isSourceAllowed rejected it on every tier — including
  // business — even though the scheduler would have happily run it.
  if (!planAllowsMonitorSource(plan, sourceType)) {
    return c.json({ error: "plan_locked_source", source: sourceType, plan }, 403);
  }
  // Trustpilot public surface (Reviews v2) reads the official API — with no key it can
  // only fail. Refuse to create a doomed monitor (clean degradation, not a retry
  // loop). The domain is derived from the competitor URL, so no review URL is needed.
  if (sourceType === "trustpilot_public" && !process.env.TRUSTPILOT_API_KEY) {
    return c.json({ error: "trustpilot_key_missing", source: sourceType }, 400);
  }

  // Review sources scrape a specific review page (not the homepage), so they
  // require an explicit URL. Every other source accepts an OPTIONAL URL override
  // — when absent, the scraper auto-discovers the page (e.g. /pricing). Both are
  // host-locked (SSRF + correctness) via validateMonitorUrl.
  let config: { url: string } | undefined;
  if (isReviewSource(sourceType) && !parsed.data.url) {
    return c.json({ error: "review_url_required", source: sourceType }, 400);
  }
  // A repo can't be derived from the competitor's site (nothing discovers it), so
  // without an explicit github.com/owner/repo the scraper would only ever throw.
  if (sourceType === "github_repo" && !parsed.data.url) {
    return c.json({ error: "repo_url_required", source: sourceType }, 400);
  }
  if (parsed.data.url) {
    const valid = validateMonitorUrl(sourceType, parsed.data.url, competitor.url);
    if (!valid.ok) {
      return c.json({ error: "invalid_monitor_url", reason: valid.error, source: sourceType }, 400);
    }
    config = { url: valid.url };
  }

  const desired = parsed.data.frequency ?? defaultFrequencyFor(sourceType);
  const frequency: MonitorFrequency = isFrequencyAllowed(plan, desired) ? desired : "weekly";

  // Idempotent: one monitor per (competitor, source). When re-enabling a review
  // source with a corrected URL, update the stored config rather than no-op.
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, sourceType)),
  });
  if (existing) {
    const currentUrl =
      existing.config && typeof existing.config === "object" && "url" in existing.config
        ? String((existing.config as { url: unknown }).url)
        : null;
    if (config && config.url !== currentUrl) {
      const [updated] = await db
        .update(monitors)
        .set({ config })
        .where(eq(monitors.id, existing.id))
        .returning();
      return c.json({ monitor: updated ?? existing, created: false });
    }
    return c.json({ monitor: existing, created: false });
  }

  const [monitor] = await db
    .insert(monitors)
    .values({ competitorId, sourceType, frequency, config })
    .returning();
  if (!monitor) return c.json({ error: "Failed to create monitor" }, 500);

  void captureServerEvent(user.id, "monitor_enabled", {
    competitorId,
    sourceType,
    frequency,
    orgId,
  });

  return c.json({ monitor, created: true }, 201);
});

// Dedicated "Watch a custom page" flow — a source for the long tail (any /about,
// ToS, /security, /enterprise or docs page on the competitor's own domain) that
// the single-source enable route above doesn't model: it carries a {url,label,hint}
// config, a per-competitor quota, and allows several customs per competitor.
const AddCustomMonitorSchema = z.object({
  url: z.string(),
  // Short display label for the page (shown in the source tabs).
  label: z.string().trim().min(1).max(60),
  // Page-type hint → grounds classify ("this page is the competitor's {hint} page").
  hint: z.enum(CUSTOM_MONITOR_HINTS),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
});

competitorsRouter.post("/:id/custom-monitors", async (c) => {
  const competitorId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = AddCustomMonitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(competitorId, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Competitor not found" }, 404);

  // Domain lock (eTLD+1 of the competitor's own site, subdomains OK) + syntactic
  // SSRF guard. custom_url_domain_mismatch is the structured rejection.
  const valid = validateCustomMonitorUrl(parsed.data.url, competitor.url);
  if (!valid.ok) {
    if (valid.error === "custom_url_domain_mismatch") {
      return c.json({ error: "custom_url_domain_mismatch", competitorUrl: competitor.url }, 400);
    }
    return c.json({ error: "invalid_monitor_url", reason: valid.error }, 400);
  }

  // All existing customs on this competitor — powers BOTH the dedup and the quota
  // count from a single read.
  const existingCustoms = await db.query.monitors.findMany({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "custom")),
    columns: { id: true, config: true },
  });

  // Applicative uniqueness on the NORMALIZED url. The (competitor, sourceType)
  // uniqueness the standard route leans on can't apply — several customs coexist —
  // so we dedupe on the canonical url so the same page isn't watched twice. Runs
  // BEFORE the quota gate: re-submitting a page already watched isn't a new slot.
  const normalized = normalizeCustomUrl(valid.url);
  const dup = existingCustoms.find((m) => {
    const u = (m.config as { url?: string } | null)?.url;
    return u ? normalizeCustomUrl(u) === normalized : false;
  });
  if (dup) return c.json({ error: "custom_url_duplicate", monitorId: dup.id }, 409);

  // Per-competitor quota — BACKEND gate. free's limit is 0, so the feature is fully
  // locked there (plan_limit_custom_monitors, limit 0). paywallFromError parses any
  // `plan_` 403.
  const plan = await getOrgPlan(orgId);
  const limit = customMonitorLimit(plan);
  const used = existingCustoms.length;
  if (used >= limit) {
    return c.json({ error: "plan_limit_custom_monitors", plan, used, limit }, 403);
  }

  const desired = parsed.data.frequency ?? "weekly";
  const frequency: MonitorFrequency = isFrequencyAllowed(plan, desired) ? desired : "weekly";

  const [monitor] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "custom",
      frequency,
      config: { url: valid.url, label: parsed.data.label.trim(), hint: parsed.data.hint },
    })
    .returning();
  if (!monitor) return c.json({ error: "Failed to create monitor" }, 500);

  void captureServerEvent(user.id, "custom_monitor_enabled", {
    competitorId,
    hint: parsed.data.hint,
    frequency,
    orgId,
  });

  return c.json({ monitor, created: true }, 201);
});

// Days of daily signal counts shipped per competitor for the roster sparkline.
// Matches the 14 day window the roster's count/trend pair is already computed over.
const ACTIVITY_DAYS = 14;

competitorsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // patch-28 — optional product scope: restrict to the competitors linked to a given
  // product (product_competitors). Absent → all org competitors (unchanged). The join
  // on products.orgId keeps it tenant-safe (a forged productId yields no rows).
  // An archived / unknown product resolves to null here, i.e. all products. Serving its
  // roster instead showed a removed SKU's competitors and hid every live one, with no
  // switcher left to change scope on a single-product org.
  const productIdFilter = await liveProductId(orgId, c.req.query("productId"));
  let restrictIds: string[] | null = null;
  if (productIdFilter) {
    restrictIds = await productCompetitorIds(orgId, productIdFilter);
    if (restrictIds.length === 0) return c.json({ competitors: [] });
  }

  const list = await db.query.competitors.findMany({
    // Exclude the self-competitor (the user's own product) — it has its own page.
    where: and(
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
      ne(competitors.type, "self"),
      restrictIds ? inArray(competitors.id, restrictIds) : undefined,
    ),
    orderBy: desc(competitors.createdAt),
    // Projected to what this roster response + enrichment actually use (plan-012):
    // excludes selfProfile/overrides/platformProfile/metadata — heavy jsonb never
    // read on this list path (only by the :id detail handler + pricing helpers).
    columns: {
      id: true,
      name: true,
      url: true,
      description: true,
      category: true,
      color: true,
      overlapScore: true,
      aiSummary: true,
      aiSummaryUpdatedAt: true,
      pricingStatus: true,
      pricingObservedRegion: true,
      pricingPromotional: true,
      pricingDemoUrl: true,
      pricingNote: true,
      pricingManualOverride: true,
      monitoringPaused: true,
      alertsMuted: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (list.length === 0) return c.json({ competitors: [] });

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const sevenDaysAgo = new Date(now - 7 * day);
  const fourteenDaysAgo = new Date(now - 14 * day);
  const sevenIso = sevenDaysAgo.toISOString();
  const fourteenIso = fourteenDaysAgo.toISOString();

  const ids = list.map((c) => c.id);
  const dayExpr = sql`date_trunc('day', ${signals.createdAt})`;

  // Every read below answers a question about the SAME org and the SAME competitor
  // ids, and none of them feeds another's input, yet they used to run one after the
  // other — nine sequential round-trips to a database that sits across a network. On
  // this endpoint that ordering was pure latency: it is requested by the roster, the
  // sidebar, the overview seed and the compare picker, and re-requested by a 30s
  // poll, so it is the single most-fetched handler in the product. Issued together,
  // the wall-clock cost collapses to the slowest one instead of their sum.
  const [
    aggregates,
    latestRows,
    dailyRows,
    monitorRows,
    homepageRows,
    linkRows,
    activeProductRows,
    planAndCap,
  ] = await Promise.all([
    db
      .select({
        competitorId: signals.competitorId,
        signals7d: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp)::int`,
        signalsPrev: sql<number>`count(*) filter (where ${signals.createdAt} >= ${fourteenIso}::timestamp and ${signals.createdAt} < ${sevenIso}::timestamp)::int`,
        lastSignalAt: sql<string | null>`max(${signals.createdAt})`,
        catPricing: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'pricing')::int`,
        catProduct: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'product')::int`,
        catHiring: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'hiring')::int`,
        catReviews: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'reviews')::int`,
        catContent: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'content')::int`,
        catFunding: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'funding')::int`,
      })
      .from(signals)
      .where(
        and(
          eq(signals.orgId, orgId),
          gte(signals.createdAt, fourteenDaysAgo),
          // When scoped to a product, only aggregate that product's competitors
          // instead of scanning the whole org's 14-day signals.
          restrictIds ? inArray(signals.competitorId, restrictIds) : undefined,
        ),
      )
      .groupBy(signals.competitorId),

    // What each competitor last DID, not how many times they did something. The
    // roster leads with the finding now, so the row carries the latest signal's own
    // text. Deliberately NOT bounded by the 14 day window above: a competitor that
    // has been silent for three weeks still has a last move, and "quiet since" is
    // the most useful thing its row can say. `distinct on` walks
    // signals_competitor_created_idx once and stops at the first row per competitor.
    db
      .selectDistinctOn([signals.competitorId], {
        competitorId: signals.competitorId,
        insight: signals.insight,
        severity: signals.severity,
        category: signals.category,
        createdAt: signals.createdAt,
      })
      .from(signals)
      .where(and(eq(signals.orgId, orgId), inArray(signals.competitorId, ids)))
      .orderBy(signals.competitorId, desc(signals.createdAt)),

    // Daily counts for the row's sparkline. A percentage cannot tell "eleven quiet
    // days then four loud ones" from a steady hum, and that shape is what says
    // whether something is building. Same window and same index as the aggregate.
    db
      .select({
        competitorId: signals.competitorId,
        day: sql<string>`${dayExpr}::date::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(signals)
      .where(
        and(
          eq(signals.orgId, orgId),
          gte(signals.createdAt, fourteenDaysAgo),
          restrictIds ? inArray(signals.competitorId, restrictIds) : undefined,
        ),
      )
      .groupBy(signals.competitorId, dayExpr),

    // Per-competitor freshness for the global list dot (patch-14). A competitor is
    // only as fresh as its STALEST active source, and a failed last scan wins. We
    // ship the (lastScrapedAt, status) pair the FreshnessDot expects and let the
    // shared computeFreshness derive the level client-side.
    // Two sources are kept OUT of the aggregate, matching the detail view's Sources
    // filter so the dot reflects exactly what the user sees scrape:
    //   - markedUnscrapable monitors — a dead/abandoned source keeps its old
    //     lastFailedAt forever, which otherwise pins the whole competitor to
    //     "Last scan failed" and drags the shown date back to its last success
    //     (the bug: a blog stuck since Jun 5 made an otherwise-fresh competitor
    //     read "last scan failed · Jun 5"). It has its own "unavailable" state.
    //   - internal anchors (tech_stack/sitemap/news) — infra, not user-facing.
    // markedUnscrapable rows ARE selected here (they were filtered out in SQL before)
    // because the roster's coverage cell has to name a blocked source; they are
    // dropped again before aggregateFreshness, so the dot behaves exactly as it did.
    db
      .select({
        competitorId: monitors.competitorId,
        sourceType: monitors.sourceType,
        lastRunAt: monitors.lastRunAt,
        lastFailedAt: monitors.lastFailedAt,
        markedUnscrapable: monitors.markedUnscrapable,
        // A refusal is not a failure, and the roster said it was: a site that
        // declines automated collection was counted alongside broken URLs and
        // timeouts, so a well-covered competitor read as failing.
        refusedAt: monitors.refusedAt,
        lastFailureCategory: monitors.lastFailureCategory,
      })
      .from(monitors)
      .where(
        and(
          inArray(monitors.competitorId, ids),
          // A refusal also switches the source OFF, so `isActive = true` alone hid
          // every blocked row from the roster — the comment above promised they were
          // selected, and they were not. Refused rows are readmitted by name, which
          // leaves a source the USER paused out of it, as before.
          or(eq(monitors.isActive, true), isNotNull(monitors.refusedAt)),
          notInArray(monitors.sourceType, ["tech_stack", "sitemap", "news", "subdomains"]),
        ),
      ),

    // Homepage monitor per competitor — the anchor whose scrape feeds the AI summary.
    // Kept separate from the freshness aggregate (which excludes unscrapable rows):
    // here we WANT markedUnscrapable so a blocked homepage reads as "needs attention".
    db
      .select({
        competitorId: monitors.competitorId,
        lastRunAt: monitors.lastRunAt,
        lastFailedAt: monitors.lastFailedAt,
        scrapeStartedAt: monitors.scrapeStartedAt,
        scrapePickedUpAt: monitors.scrapePickedUpAt,
        markedUnscrapable: monitors.markedUnscrapable,
        isActive: monitors.isActive,
      })
      .from(monitors)
      .where(and(inArray(monitors.competitorId, ids), eq(monitors.sourceType, "homepage"))),

    // Per-competitor product attribution for the all-products chip (patch-28): the
    // products a competitor is linked to. This used to list only the ones it was
    // *specific* to, but every link was written shared, so the chips were empty for
    // every competitor and the surface answered nothing. Org-joined so a forged
    // productId can't leak.
    db
      .select({
        competitorId: productCompetitors.competitorId,
        productId: productCompetitors.productId,
      })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .where(
        and(
          eq(products.orgId, orgId),
          ne(products.status, "archived"),
          inArray(productCompetitors.competitorId, ids),
        ),
      ),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.orgId, orgId), ne(products.status, "archived"))),

    // Competitors frozen by the plan cap (over-cap after a downgrade). Org-level and
    // independent of any product scope — the oldest `maxCompetitors` stay monitored,
    // everything newer is paused. Empty set for orgs within their cap / unlimited.
    // The cap read needs the plan, so this pair stays ordered — but it runs beside
    // everything above instead of after it.
    (async () => {
      const plan = await getOrgPlan(orgId);
      return { plan, overCap: await pausedByPlanCap(orgId, plan) };
    })(),
  ]);

  const byCompetitor = new Map(aggregates.map((a) => [a.competitorId, a]));
  const latestByCompetitor = new Map(latestRows.map((r) => [r.competitorId, r]));
  const homepageByCompetitor = new Map(homepageRows.map((m) => [m.competitorId, m]));

  // Oldest day first, so the bar chart reads left to right like a calendar.
  const dayKeys: string[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    dayKeys.push(new Date(now - i * day).toISOString().slice(0, 10));
  }
  const dailyByCompetitor = new Map<string, Map<string, number>>();
  for (const r of dailyRows) {
    const byDay = dailyByCompetitor.get(r.competitorId) ?? new Map<string, number>();
    byDay.set(r.day, r.count);
    dailyByCompetitor.set(r.competitorId, byDay);
  }

  const monitorsByCompetitor = new Map<string, typeof monitorRows>();
  for (const m of monitorRows) {
    const arr = monitorsByCompetitor.get(m.competitorId) ?? [];
    arr.push(m);
    monitorsByCompetitor.set(m.competitorId, arr);
  }

  // "Are we actually watching them" is the one question only the roster can
  // answer, and until now it got a 6px dot. A source counts as failing when it
  // was marked unscrapable (a refusal, per the collection doctrine) or when its
  // last run ended in failure. Pure arithmetic on rows already in hand.
  function coverageOf(rows: typeof monitorRows) {
    let failing = 0;
    let failingSource: string | null = null;
    const blocked: string[] = [];
    for (const m of rows) {
      // A refusal is reported on its own terms, never inside `failing`: nothing is
      // broken and there is nothing to repair, so counting it as a failure made a
      // well-covered competitor read as falling over.
      if (isRefused({ ...m, sourceType: m.sourceType as SourceType })) {
        blocked.push(m.sourceType);
        continue;
      }
      const run = m.lastRunAt ? new Date(m.lastRunAt).getTime() : null;
      const failed = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : null;
      const isFailing =
        m.markedUnscrapable || (failed !== null && (run === null || failed >= run));
      if (!isFailing) continue;
      failing++;
      if (failingSource === null || m.markedUnscrapable) failingSource = m.sourceType;
    }
    // How far the refusals reach, so the roster only speaks up when what we know
    // about this competitor actually changed (a blocked blog stays on its own row,
    // a blocked homepage does not). The states below are the coarse ones this cell
    // can see; `blockedReach` only ever separates blocked from still-collecting.
    const reach = blockedReach(
      buildCoverage(
        rows.map((m) => ({
          sourceType: m.sourceType as SourceType,
          state: (blocked.includes(m.sourceType) ? "blocked" : "tracking") as SourceState,
        })),
      ),
    );
    return {
      sources: rows.length,
      failing,
      failingSource,
      blocked: blocked.length,
      blockedSource: blocked[0] ?? null,
      blockedReach: reach,
    };
  }

  // A competitor linked to EVERY product is relevant everywhere: chips would repeat
  // the same row on every competitor and disambiguate nothing, so it gets none. That
  // keeps the anti-noise intent the isSpecific filter was reaching for, without
  // hiding the attribution that actually distinguishes one competitor from another.
  const activeProductCount = activeProductRows[0]?.n ?? 0;
  const productsByCompetitor = new Map<string, string[]>();
  for (const r of linkRows) {
    const arr = productsByCompetitor.get(r.competitorId) ?? [];
    arr.push(r.productId);
    productsByCompetitor.set(r.competitorId, arr);
  }
  const attributionOf = (competitorId: string) => {
    const ids = productsByCompetitor.get(competitorId) ?? [];
    return ids.length >= activeProductCount ? [] : ids;
  };

  const pausedByPlan = new Set(planAndCap.overCap.map((p) => p.id));

  const nowMs = Date.now();
  const enriched = list.map((c) => {
    const a = byCompetitor.get(c.id);
    const rows = monitorsByCompetitor.get(c.id) ?? [];
    const freshness =
      aggregateFreshness(rows.filter((m) => !m.markedUnscrapable)) ??
      ({ lastScrapedAt: null, status: "success" } as const);
    const latest = latestByCompetitor.get(c.id);
    const byDay = dailyByCompetitor.get(c.id);
    // Where the first AI analysis is at (queued → scraping → summarizing → ready),
    // so the list can mark a freshly-added competitor as "Analyzing…" instead of
    // looking idle until its summary lands.
    const analysis = deriveAnalysisStatus(
      { hasSummary: Boolean(c.aiSummary), anchor: homepageByCompetitor.get(c.id) ?? null },
      nowMs,
    );
    return {
      ...c,
      productIds: attributionOf(c.id),
      pausedByPlan: pausedByPlan.has(c.id),
      freshness,
      analysis,
      coverage: coverageOf(rows),
      latestMove: latest
        ? {
            insight: latest.insight,
            severity: latest.severity,
            category: latest.category,
            createdAt: latest.createdAt,
          }
        : null,
      activity: dayKeys.map((k) => byDay?.get(k) ?? 0),
      stats: {
        signals7d: a?.signals7d ?? 0,
        signalsPrev: a?.signalsPrev ?? 0,
        lastSignalAt: a?.lastSignalAt ?? null,
        categoryCounts: {
          pricing: a?.catPricing ?? 0,
          product: a?.catProduct ?? 0,
          hiring: a?.catHiring ?? 0,
          reviews: a?.catReviews ?? 0,
          content: a?.catContent ?? 0,
          funding: a?.catFunding ?? 0,
        },
      },
    };
  });

  return c.json({ competitors: enriched });
});

competitorsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  // plan / allMonitors / recentSignals / techStack only need orgId or competitor.id
  // and are independent of each other — run them concurrently. recentChanges depends
  // on the monitor ids derived below, so it stays a second step. Org plan ships with
  // the payload so the UI can gate per-source actions without a second roundtrip.
  const [plan, allMonitors, recentSignals, techRows] = await Promise.all([
    getOrgPlan(orgId),
    db.query.monitors.findMany({ where: eq(monitors.competitorId, competitor.id) }),
    db
      .select({
        id: signals.id,
        severity: signals.severity,
        category: signals.category,
        insight: signals.insight,
        soWhat: signals.soWhat,
        recommendedAction: signals.recommendedAction,
        isRead: signals.isRead,
        createdAt: signals.createdAt,
        changeId: signals.changeId,
        sourceType: monitors.sourceType,
        monitorUrl: sql<string | null>`COALESCE(${snapshots.resolvedUrl}, ${monitors.config}->>'url')`,
      })
      .from(signals)
      .leftJoin(changes, eq(changes.id, signals.changeId))
      .leftJoin(monitors, eq(monitors.id, changes.monitorId))
      .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
      .where(eq(signals.competitorId, competitor.id))
      .orderBy(desc(signals.createdAt))
      .limit(20),
    db.query.techStackEntries.findMany({
      where: and(
        eq(techStackEntries.competitorId, competitor.id),
        eq(techStackEntries.isActive, true),
      ),
    }),
  ]);
  // Split by what the user can act on, per the shared source catalog:
  //   monitorList       — configurable + custom: toggle, frequency, URL.
  //   automaticMonitors — seeded and scraped on their own cadence, read-only.
  //   (hidden)          — infra anchors that are never scraped (tech_stack,
  //                       ai_visibility, review_shift, hiring_shift,
  //                       comparison_page) and the retired review aggregators.
  // The previous hand-written exclusion list only covered four of those, so
  // youtube/hackernews/wellknown and the dormant anchors leaked into the Sources UI.
  // The exact page each source last landed on: resolved_url is where the scraper
  // actually went (it discovers /pricing, /careers… from the homepage), config.url
  // only when the user pinned one. Lets the Sources page link each source to its
  // page. We deliberately do NOT fall back to the competitor's homepage here — an
  // anchor source with no real page (Hacker News, subdomains) must stay unlinked.
  const resolvedByMonitor = new Map<string, string | null>();
  const allMonitorIds = allMonitors.map((m) => m.id);
  if (allMonitorIds.length) {
    const urlRows = await db
      .select({
        monitorId: snapshots.monitorId,
        resolvedUrl: sql<
          string | null
        >`(array_agg(${snapshots.resolvedUrl} ORDER BY ${snapshots.scrapedAt} DESC) FILTER (WHERE ${snapshots.resolvedUrl} IS NOT NULL))[1]`,
      })
      .from(snapshots)
      .where(inArray(snapshots.monitorId, allMonitorIds))
      .groupBy(snapshots.monitorId);
    for (const r of urlRows) resolvedByMonitor.set(r.monitorId, r.resolvedUrl);
  }
  const withPageUrl = <T extends { id: string; config: unknown }>(m: T) => ({
    ...m,
    pageUrl: resolvedByMonitor.get(m.id) ?? (m.config as { url?: string } | null)?.url ?? null,
  });

  const monitorList = allMonitors
    .filter((m) => !isHiddenSource(m.sourceType) && !isAutomaticSource(m.sourceType))
    .map(withPageUrl);
  const automaticMonitors = allMonitors
    .filter((m) => isAutomaticSource(m.sourceType))
    .map(withPageUrl);

  // Changes are read-only data, so they are NOT filtered by the configurable/
  // automatic split: an automatic source can't be turned off, but a Show HN launch
  // or a funding item is exactly what the Product & Positioning feed is made of,
  // and the never-scraped anchors (comparison_page, review_shift, hiring_shift,
  // ai_visibility) are pure carriers of synthetic signals. Only tech_stack stays
  // out — it has its own card, and its churn drowned the feed.
  const monitorIds = allMonitors.filter((m) => m.sourceType !== "tech_stack").map((m) => m.id);
  const recentChanges = monitorIds.length
    ? await db
        .select({
          id: changes.id,
          // Preview renders ≤18 lines — cap the payload (rows run up to 50KB).
          diffText: sql<string | null>`left(${changes.diffText}, 4000)`,
          summary: changes.summary,
          detectedAt: changes.detectedAt,
          monitorId: changes.monitorId,
          sourceType: monitors.sourceType,
          // resolved_url is the exact page the scraper landed on (it discovers
          // /pricing, /tarifs… from the homepage), so it's the right "View page"
          // target. config.url is only set when the user pinned a URL manually.
          monitorUrl: sql<string | null>`COALESCE(${snapshots.resolvedUrl}, ${monitors.config}->>'url')`,
          // Engagement, projected out of rawDiff rather than shipping the blob:
          // the column holds the full added/removed arrays and only Hacker News
          // carries these two keys (scrape-monitor). Null on every other source,
          // and on HN captures that predate them.
          engagementPoints: sql<number | null>`(${changes.rawDiff}->>'points')::int`,
          engagementComments: sql<number | null>`(${changes.rawDiff}->>'numComments')::int`,
        })
        .from(changes)
        .innerJoin(monitors, eq(monitors.id, changes.monitorId))
        .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
        .where(inArray(changes.monitorId, monitorIds))
        .orderBy(desc(changes.detectedAt))
        .limit(20)
    : [];

  // recentSignals + techRows (techStack) were fetched in the Promise.all above.
  const techStack = {
    entries: techRows.map((t) => ({
      techId: t.techId,
      name: t.techName,
      category: t.category,
      importance: t.importance,
      firstDetectedAt: t.firstDetectedAt,
      lastDetectedAt: t.lastDetectedAt,
    })),
    lastScrapedAt: competitor.techStackScrapedAt,
    // When the next monthly tech-stack scan is due (patch-18). Derived, not stored:
    // the scan is interval-driven on techStackScrapedAt, not a monitor with a
    // nextRunAt. Null when never scanned (UI shows an ETA instead). Same interval
    // (env override + shared default) the worker enqueues on, so they never drift.
    nextScanAt: computeNextScanAt(
      competitor.techStackScrapedAt,
      Number(
        process.env.TECH_STACK_SCRAPE_INTERVAL_DAYS ?? TECH_STACK_SCRAPE_INTERVAL_DAYS,
      ),
    ),
    // Auto-detected platform profile (patch-31): framework / CMS / ATS / status
    // page / changelog / pricing widget. Detected for routing, surfaced read-only
    // here next to the third-party tech. Null when never detected.
    platformProfile: competitor.platformProfile,
  };

  // Frozen by the plan cap (over-cap after a downgrade): the scheduler skips it
  // exactly like a user pause, so the detail page has to say so too — the list
  // already did, and a competitor that reads "active" here would never scrape.
  const [overview, overCap] = await Promise.all([
    buildOverview(competitor.id),
    pausedByPlanCap(orgId, plan),
  ]);
  const pausedByPlan = overCap.some((p) => p.id === competitor.id);

  return c.json({
    competitor: { ...competitor, pausedByPlan },
    monitors: monitorList,
    // Read-only on the Sources page: freshness only, no toggle / frequency / URL.
    automaticMonitors,
    recentChanges,
    recentSignals,
    techStack,
    overview,
    plan,
  });
});

competitorsRouter.get("/:id/signals", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db
    .select({
      id: signals.id,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
      isRead: signals.isRead,
      createdAt: signals.createdAt,
      changeId: signals.changeId,
    })
    .from(signals)
    .where(eq(signals.competitorId, competitor.id))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return c.json({ signals: rows });
});

competitorsRouter.get("/:id/jobs", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  // Explicit columns, not the row: `description_text` holds up to 15k characters
  // of job description per posting (Hiring Intelligence v2 P1), and a fifty-role
  // board would ship most of a megabyte of prose the tab never renders. What the
  // tab shows is mined into posting_facts and joined below.
  const all = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      department: jobPostings.department,
      location: jobPostings.location,
      url: jobPostings.url,
      seniority: jobPostings.seniority,
      postedAt: jobPostings.postedAt,
      salaryMin: jobPostings.salaryMin,
      salaryMax: jobPostings.salaryMax,
      salaryCurrency: jobPostings.salaryCurrency,
      remoteMode: jobPostings.remoteMode,
      employmentType: jobPostings.employmentType,
      detectedAt: jobPostings.detectedAt,
    })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitor.id), eq(jobPostings.isActive, true)))
    .orderBy(desc(jobPostings.detectedAt));

  // What each posting said about their stack and their plans. Best-effort: the
  // tab renders unchanged when nothing has been mined.
  const factRows = all.length
    ? await db
        .select({
          postingId: postingFacts.postingId,
          kind: postingFacts.kind,
          value: postingFacts.value,
          evidenceSnippet: postingFacts.evidenceSnippet,
        })
        .from(postingFacts)
        .where(eq(postingFacts.competitorId, competitor.id))
    : [];
  const factsByPosting = new Map<string, typeof factRows>();
  for (const f of factRows) {
    const arr = factsByPosting.get(f.postingId) ?? [];
    arr.push(f);
    factsByPosting.set(f.postingId, arr);
  }
  const withFacts = all.map((j) => ({
    ...j,
    facts: (factsByPosting.get(j.id) ?? []).map(({ kind, value, evidenceSnippet }) => ({
      kind,
      value,
      evidenceSnippet,
    })),
  }));

  const byDepartment = new Map<string, typeof withFacts>();
  for (const job of withFacts) {
    const key = job.department ?? "Other";
    const arr = byDepartment.get(key) ?? [];
    arr.push(job);
    byDepartment.set(key, arr);
  }

  return c.json({
    total: all.length,
    departments: Array.from(byDepartment.entries()).map(([department, jobs]) => ({
      department,
      count: jobs.length,
      jobs,
    })),
  });
});

competitorsRouter.get("/:id/job-trends", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    department: string;
    count: number;
    recorded_at: string;
  }>(sql`
    SELECT department, count, (recorded_at AT TIME ZONE 'UTC') AS recorded_at
    FROM job_counts
    WHERE competitor_id = ${competitor.id}
      AND recorded_at >= now() - make_interval(days => 90)
    ORDER BY recorded_at ASC
  `);

  return c.json({ trends: rows });
});

// Hiring velocity per canonical department bucket (hiring-velocity feature): the
// per-week open-role count that powers the Hiring tab sparklines. Read from
// hiring_metrics (one authoritative row per bucket per ISO week), pivoted into a
// per-bucket ascending series. `unknown` is omitted — it's a data-quality bucket,
// not a department. Best-effort: empty series on any analytics failure.
competitorsRouter.get("/:id/hiring-velocity", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    department_bucket: string;
    open_count: number;
    week_start: string;
  }>(sql`
    SELECT department_bucket, open_count, week_start
    FROM hiring_metrics
    WHERE competitor_id = ${competitor.id}
      AND recorded_at >= now() - make_interval(days => 112)
    ORDER BY week_start ASC
  `);

  const byBucket = new Map<string, Array<{ week_start: string; open_count: number }>>();
  for (const r of rows) {
    const arr = byBucket.get(r.department_bucket) ?? [];
    arr.push({ week_start: r.week_start, open_count: r.open_count });
    byBucket.set(r.department_bucket, arr);
  }

  // Stable order (DEPARTMENT_BUCKETS), only buckets with data, `unknown` dropped.
  const velocity = DEPARTMENT_BUCKETS.filter(
    (b): b is Exclude<DepartmentBucket, "unknown"> => b !== "unknown" && byBucket.has(b),
  ).map((bucket) => {
    const points = byBucket.get(bucket)!;
    return {
      bucket,
      label: DEPARTMENT_BUCKET_LABELS[bucket],
      series: points.map((p) => p.open_count),
      current: points[points.length - 1]?.open_count ?? 0,
    };
  });

  return c.json({ velocity });
});

// Where a competitor's open roles are (Hiring Intelligence v2 P2). Reads the most
// recent ISO week of hiring_geo plus, per key, the first week it ever appeared —
// which is what lets the tab flag a country they only just started hiring in.
//
// The three reserved lowercase keys ("remote", "region", "unresolved") come back in
// `other`, separated from the countries but NOT dropped: the share of a board we
// could not place is what tells the reader how much of the map to believe, and it
// is the only honest denominator for the rest of the card. Best-effort like every
// analytics read — an empty footprint hides the card rather than breaking the tab.
competitorsRouter.get("/:id/hiring-geo", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    country_code: string;
    open_count: number;
    week_start: string;
    first_week: string;
  }>(sql`
    WITH latest AS (
      SELECT max(week_start) AS w FROM hiring_geo WHERE competitor_id = ${competitor.id}
    ),
    firsts AS (
      SELECT country_code, min(week_start) AS first_week
      FROM hiring_geo WHERE competitor_id = ${competitor.id}
      GROUP BY country_code
    )
    SELECT g.country_code, g.open_count, g.week_start, firsts.first_week
    FROM hiring_geo g
    JOIN latest ON g.week_start = latest.w
    LEFT JOIN firsts ON firsts.country_code = g.country_code
    WHERE g.competitor_id = ${competitor.id} AND g.open_count > 0
    ORDER BY g.open_count DESC
  `);

  const newSince = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const shaped = rows.map((r) => ({
    code: r.country_code,
    openCount: r.open_count,
    // A country whose FIRST recorded week is inside the last 30 days. Not "it grew"
    // — it did not exist in this competitor's footprint a month ago.
    isNew: Boolean(r.first_week && r.first_week >= newSince),
  }));

  return c.json({
    weekStart: rows[0]?.week_start ?? null,
    countries: shaped.filter((r) => isCountryKey(r.code)),
    other: shaped
      .filter((r) => !isCountryKey(r.code))
      .map(({ code, openCount }) => ({ code, openCount })),
  });
});

// What a competitor pays, per department and per currency (Hiring Intelligence v2
// P3). Two reads, deliberately different in kind:
//
//   `bands`      — the stored weekly percentiles (hiring_salary_bands), latest week
//                  plus the p50 history behind each one for the sparkline. Analytics,
//                  best-effort: no bands hides the card rather than breaking the tab.
//   `disclosure` — computed ON READ from the CURRENT open roles, because the
//                  question a reader asks is "if I look at their board today, will I
//                  see pay?", not "what was the average over the last quarter". It
//                  counts every posting carrying a figure, including the hourly rates
//                  and currency-less amounts the bands exclude: publishing pay and
//                  publishing pay we can band are two different claims.
competitorsRouter.get("/:id/hiring-salary", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const [rows, [stats]] = await Promise.all([
    analyticsQuery<{
      department_bucket: string;
      currency: string;
      p25: number;
      p50: number;
      p75: number;
      n: number;
      week_start: string;
    }>(sql`
      SELECT department_bucket, currency, p25, p50, p75, n, week_start
      FROM hiring_salary_bands
      WHERE competitor_id = ${competitor.id}
        AND recorded_at >= now() - make_interval(days => 196)
      ORDER BY week_start ASC
    `),
    db
      .select({
        total: sql<number>`count(*)::int`,
        disclosed: sql<number>`count(*) filter (
          where ${jobPostings.salaryMin} is not null or ${jobPostings.salaryMax} is not null
        )::int`,
        currency: sql<string | null>`mode() within group (order by ${jobPostings.salaryCurrency})
          filter (where ${jobPostings.salaryCurrency} is not null)`,
      })
      .from(jobPostings)
      .where(and(eq(jobPostings.competitorId, competitor.id), eq(jobPostings.isActive, true))),
  ]);

  const latestWeek = rows.reduce<string | null>(
    (mx, r) => (mx === null || r.week_start > mx ? r.week_start : mx),
    null,
  );

  // p50 history per (bucket, currency) — the shape behind the current number.
  const seriesByKey = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.department_bucket}|${r.currency}`;
    seriesByKey.set(key, [...(seriesByKey.get(key) ?? []), r.p50]);
  }

  const bands = rows
    .filter((r) => r.week_start === latestWeek)
    .map((r) => ({
      bucket: r.department_bucket,
      label: DEPARTMENT_BUCKET_LABELS[r.department_bucket as DepartmentBucket] ?? r.department_bucket,
      currency: r.currency,
      p25: r.p25,
      p50: r.p50,
      p75: r.p75,
      n: r.n,
      series: seriesByKey.get(`${r.department_bucket}|${r.currency}`) ?? [],
    }))
    // Widest evidence first: a band over eight roles says more than one over three.
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const total = stats?.total ?? 0;
  const disclosed = stats?.disclosed ?? 0;
  return c.json({
    weekStart: latestWeek,
    bands,
    disclosure: {
      disclosed,
      total,
      share: total > 0 ? disclosed / total : 0,
      verdict: disclosureVerdict(disclosed, total),
      currency: stats?.currency ?? null,
    },
  });
});

/** How many praises / complaints "In their words" shows once restatements are out. */
const VERBATIM_LIMIT = 5;

competitorsRouter.get("/:id/reviews", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await db.query.reviews.findMany({
    where: eq(reviews.competitorId, competitor.id),
    orderBy: desc(reviews.detectedAt),
    limit: 60,
  });

  const praises = rows.filter((r) => r.author === "praise");
  const complaints = rows.filter((r) => r.author === "complaint");
  const recent = rows.slice(0, 30);

  // Latest per-criterion breakdown (patch-32). Persisted on review_scores but never
  // surfaced until now — take the most recent scrape that actually carried a
  // breakdown (G2/Capterra expose it; App Store doesn't). Best-effort.
  const [subRow] = await analyticsQuery<{
    easeOfUse: number | null;
    support: number | null;
    features: number | null;
    value: number | null;
  }>(sql`
    SELECT sub_ease_of_use AS "easeOfUse", sub_support AS "support",
           sub_features AS "features", sub_value AS "value"
    FROM review_scores
    WHERE competitor_id = ${competitor.id}
      AND (sub_ease_of_use IS NOT NULL OR sub_support IS NOT NULL
           OR sub_features IS NOT NULL OR sub_value IS NOT NULL)
    ORDER BY recorded_at DESC
    LIMIT 1
  `);

  // Recurring complaint themes (gap-B): the latest scrape that clustered any. Cast
  // to text + parse so it's driver-agnostic. Each theme = a competitive opening.
  const [themeRow] = await analyticsQuery<{ themes: string | null }>(sql`
    SELECT complaint_themes::text AS themes
    FROM review_scores
    WHERE competitor_id = ${competitor.id} AND complaint_themes IS NOT NULL
    ORDER BY recorded_at DESC
    LIMIT 1
  `);
  let complaintThemes: Array<{ theme: string; prevalence: string }> = [];
  if (themeRow?.themes) {
    try {
      const parsed = JSON.parse(themeRow.themes);
      if (Array.isArray(parsed)) complaintThemes = parsed;
    } catch {
      complaintThemes = [];
    }
  }

  return c.json({
    summary: {
      // Deduped, not just sliced: each run re-writes the same page's verbatims, so
      // the five newest rows were often three points with two of them said twice.
      praises: dedupeVerbatims(praises.map((r) => r.content), VERBATIM_LIMIT),
      complaints: dedupeVerbatims(complaints.map((r) => r.content), VERBATIM_LIMIT),
      lastUpdatedAt: rows[0]?.detectedAt ?? null,
      subScores: subRow ?? null,
      complaintThemes,
    },
    recent,
  });
});


competitorsRouter.get("/:id/review-scores", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
    recorded_at: string;
  }>(sql`
    SELECT source, score, review_count, sentiment_score, (recorded_at AT TIME ZONE 'UTC') AS recorded_at
    FROM review_scores
    WHERE competitor_id = ${competitor.id}
      AND recorded_at >= now() - make_interval(days => 180)
    ORDER BY recorded_at ASC
  `);

  return c.json({ scores: rows });
});

export type PositioningVersion = {
  capturedAt: string;
  headline: string | null;
  subheadline: string | null;
  valueProps: string[];
};

/**
 * Collapse newest-first homepage captures into DISTINCT versions of the
 * positioning copy.
 *
 * Two properties this has to get right, hence its own function and its own test:
 * consecutive captures carrying identical copy are one version, not many, and a
 * version's `capturedAt` is when that wording FIRST appeared. Walking newest to
 * oldest we meet the newest capture of a version first, so the timestamp is
 * corrected downward on every older identical capture; without that, two adjacent
 * versions would both be stamped with the day we last SAW them and the pair would
 * read as a rewrite that never happened on that date.
 */
export function collapsePositioningVersions(
  rows: Array<{ structure: unknown; scrapedAt: Date }>,
  maxVersions: number = POSITIONING_HISTORY_MAX_VERSIONS,
): PositioningVersion[] {
  const versions: PositioningVersion[] = [];
  let previousKey: string | null = null;
  for (const row of rows) {
    if (!row.structure) continue;
    const copy = positioningCopyOf(row.structure as StoredHomepage);
    const key = JSON.stringify([copy.headline, copy.subheadline, copy.valueProps]);
    if (key === previousKey) {
      const current = versions[versions.length - 1];
      if (current) current.capturedAt = row.scrapedAt.toISOString();
      continue;
    }
    previousKey = key;
    versions.push({ capturedAt: row.scrapedAt.toISOString(), ...copy });
    if (versions.length >= maxVersions) break;
  }
  return versions;
}

/**
 * How this competitor's positioning copy has changed over time.
 *
 * Returns DISTINCT versions, newest first, not one entry per capture. A homepage
 * is scraped daily and rewritten a handful of times a year, so a raw capture list
 * would be hundreds of identical rows; collapsing on the copy itself means every
 * entry in the response is a real rewrite, and `capturedAt` is the first capture
 * that carried it.
 *
 * Lazy-loaded by the Positioning tab alone, so it stays off the competitor detail
 * payload that every other tab pays for.
 */
competitorsRouter.get("/:id/positioning-history", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const [homepageMonitor] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.competitorId, id), eq(monitors.sourceType, "homepage")))
    .limit(1);
  if (!homepageMonitor) return c.json({ versions: [] });

  // Bounded by captures scanned, not by versions found: a competitor that never
  // rewrites its homepage must not make us walk its entire snapshot history.
  const rows = await db
    .select({ structure: snapshots.homepageStructure, scrapedAt: snapshots.scrapedAt })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.monitorId, homepageMonitor.id),
        eq(snapshots.status, "success"),
        isNotNull(snapshots.homepageStructure),
      ),
    )
    .orderBy(desc(snapshots.scrapedAt))
    .limit(POSITIONING_HISTORY_SCAN_LIMIT);

  return c.json({ versions: collapsePositioningVersions(rows) });
});

// The price TIMELINE — and the one pricing read in the product that keeps
// `origin='archive'` rows (P5). Everywhere else a batch reconstructed from the
// Internet Archive is filtered out, because every other read makes a claim
// ("they charge X", "their entry price moved") and a Wayback capture cannot
// support one. Here the rows ARE the claim: this is what the page charged, and
// when. The UI marks the archived points so the two never read as one series
// captured the same way.
competitorsRouter.get("/:id/pricing-history", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    plan_name: string;
    price: number | null;
    currency: string;
    billing_period: string;
    has_trial: boolean | null;
    trial_days: number | null;
    trial_requires_card: boolean | null;
    has_free_plan: boolean | null;
    origin: string;
    recorded_at: string;
  }>(sql`
    SELECT plan_name, price, currency, billing_period,
           (has_trial = 1) AS has_trial,
           trial_days,
           (trial_requires_card = 1) AS trial_requires_card,
           (has_free_plan = 1) AS has_free_plan,
           origin,
           recorded_at::text AS recorded_at
    FROM pricing_history
    WHERE competitor_id = ${competitor.id}
    ORDER BY recorded_at ASC
  `);

  return c.json({ history: rows });
});

// P3 — how the latest capture's metered plans charge: the published ladder,
// the monthly minimum and the percentage rate. A separate read from
// pricing-history on purpose: that endpoint is the whole time series behind the
// chart, and a ladder per row would multiply it for a fact only the current
// capture answers. Best-effort like every analytics read.
competitorsRouter.get("/:id/rate-structures", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const plans = await analyticsQuery<{
    planName: string;
    unit: string | null;
    currency: string | null;
    rateStructure: string | null;
    minimumAmount: number | null;
    percentageRate: number | null;
    capturedAt: string | null;
  }>(sql`
    SELECT plan_name AS "planName", unit, currency,
           rate_structure AS "rateStructure", minimum_amount AS "minimumAmount",
           percentage_rate AS "percentageRate", recorded_at::text AS "capturedAt"
    FROM pricing_history
    WHERE competitor_id = ${competitor.id} AND origin = 'live'
      AND recorded_at = (
        SELECT max(recorded_at) FROM pricing_history
        WHERE competitor_id = ${competitor.id} AND origin = 'live'
      )
      AND (rate_structure IS NOT NULL OR minimum_amount IS NOT NULL OR percentage_rate IS NOT NULL)
    ORDER BY plan_name
  `);

  const tiers = await analyticsQuery<{
    planName: string;
    unit: string | null;
    fromQty: number;
    toQty: number | null;
    unitPrice: number | null;
    flatFee: number | null;
  }>(sql`
    SELECT plan_name AS "planName", unit, from_qty AS "fromQty", to_qty AS "toQty",
           unit_price AS "unitPrice", flat_fee AS "flatFee"
    FROM price_tiers
    WHERE competitor_id = ${competitor.id} AND origin = 'live'
      AND recorded_at = (
        SELECT max(recorded_at) FROM price_tiers
        WHERE competitor_id = ${competitor.id} AND origin = 'live'
      )
    ORDER BY plan_name, from_qty
  `);

  // P3/P4 — what those meters COST at the reference volumes. Two provenances in
  // one list: `computed_from_tiers` (our arithmetic over the published ladder)
  // and `calculator_probe` (measured on the competitor's own calculator, with a
  // screenshot behind it). The measured one wins at an equal (unit, qty), the
  // same rule the comparison applies — a page can publish a ladder AND price
  // differently in its calculator, and the calculator is what a buyer pays.
  const pointRows = await analyticsQuery<{
    planName: string;
    meterUnit: string;
    referenceQty: number;
    cost: number;
    currency: string;
    method: string;
    capturedAt: string;
    hasEvidence: boolean;
    evidenceKind: "screenshot" | "api_response" | null;
  }>(sql`
    WITH latest AS (
      SELECT method, max(recorded_at) AS rid
      FROM price_points WHERE competitor_id = ${competitor.id} GROUP BY method
    )
    SELECT pp.plan_name AS "planName", pp.meter_unit AS "meterUnit",
           pp.reference_qty AS "referenceQty", pp.effective_monthly_cost AS "cost",
           pp.currency, pp.method, pp.recorded_at::text AS "capturedAt",
           (pp.evidence_key IS NOT NULL) AS "hasEvidence",
           pp.evidence_kind AS "evidenceKind"
    FROM price_points pp
    JOIN latest l ON l.method = pp.method AND pp.recorded_at = l.rid
    WHERE pp.competitor_id = ${competitor.id}
    ORDER BY pp.meter_unit, pp.reference_qty
  `);
  const byMeter = new Map<string, (typeof pointRows)[number]>();
  for (const row of pointRows) {
    const key = `${row.meterUnit}|${row.referenceQty}`;
    const held = byMeter.get(key);
    if (!held || (row.method === "calculator_probe" && held.method !== "calculator_probe")) {
      byMeter.set(key, row);
    }
  }
  const points = [...byMeter.values()].sort(
    (a, b) => a.meterUnit.localeCompare(b.meterUnit) || a.referenceQty - b.referenceQty,
  );

  // P5 — what each published action SPENDS from a credit balance, plus what it
  // spent in the batch before, so the tab can show the rise rather than only the
  // current number. Two batches, one query: the pack price is what a page
  // advertises, the burn rate is what actually determines how far the pack goes.
  const burnRows = await analyticsQuery<{
    action: string;
    credits: number;
    isCurrent: boolean;
  }>(sql`
    WITH batches AS (
      SELECT DISTINCT recorded_at FROM credit_burn_rates
      WHERE competitor_id = ${competitor.id}
      ORDER BY recorded_at DESC LIMIT 2
    ), cur AS (SELECT max(recorded_at) AS ts FROM batches),
       prev AS (SELECT min(recorded_at) AS ts FROM batches)
    SELECT b.action, b.credits, (b.recorded_at = (SELECT ts FROM cur)) AS "isCurrent"
    FROM credit_burn_rates b
    WHERE b.competitor_id = ${competitor.id}
      AND b.recorded_at IN ((SELECT ts FROM cur), (SELECT ts FROM prev))
    ORDER BY b.action
  `);
  const previousBurns = new Map(
    burnRows.filter((r) => !r.isCurrent).map((r) => [creditBurnActionKey(r.action), r.credits]),
  );
  const burns = burnRows
    .filter((r) => r.isCurrent)
    .map((r) => {
      // Undefined = the action is new (or there is no prior batch at all, in which
      // case every action is "new" and the UI shows no deltas — correct: a first
      // capture has nothing to compare against).
      const before = previousBurns.get(creditBurnActionKey(r.action));
      return {
        action: r.action,
        credits: r.credits,
        previousCredits: before ?? null,
      };
    });

  return c.json({ plans, tiers, points, burns, capturedAt: plans[0]?.capturedAt ?? null });
});

// P4 — the proof behind one measured cost: the screenshot taken while the
// competitor's own calculator displayed it. Org-scoped, and the R2 key never
// leaves the server (a proxy, like the signal screenshot route): the caller asks
// for a meter and a volume, the server resolves which object that is.
competitorsRouter.get("/:id/calculator-evidence", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const unit = c.req.query("unit") ?? "";
  const qty = Number(c.req.query("qty"));
  if (!unit || !Number.isFinite(qty)) return c.json(notFound("evidence"), 404);

  const [row] = await analyticsQuery<{ key: string; kind: string | null }>(sql`
    SELECT evidence_key AS key, evidence_kind AS kind
    FROM price_points
    WHERE competitor_id = ${competitor.id}
      AND method = 'calculator_probe'
      AND meter_unit = ${unit}
      AND reference_qty = ${qty}
      AND evidence_key IS NOT NULL
    ORDER BY recorded_at DESC
    LIMIT 1
  `);
  if (!row?.key) return c.json(notFound("evidence"), 404);

  try {
    // A screenshot is served as an image; a replayed point's proof is the pricing
    // request and the body it answered with, served as the JSON it is.
    if (row.kind === "api_response") {
      const json = await getFromR2(row.key);
      return new Response(json, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }
    const bytes = await getBytesFromR2(row.key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        // Written once under a timestamped key and never rewritten.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return c.json(notFound("evidence"), 404);
  }
});

// P2 — the features × plans matrix: the two most recent entitlement batches,
// so the tab can render the current matrix and highlight cells that moved
// since the previous capture. Best-effort like every analytics read.
competitorsRouter.get("/:id/entitlements", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    plan_name: string;
    feature_slug: string;
    feature_label: string;
    kind: string;
    value_num: number | null;
    value_text: string | null;
    unit: string | null;
    reset_period: string | null;
    is_canonical: boolean;
    recorded_at: string;
    side: "current" | "previous";
  }>(sql`
    WITH batches AS (
      SELECT DISTINCT recorded_at FROM plan_entitlements
      WHERE competitor_id = ${competitor.id}
      ORDER BY recorded_at DESC LIMIT 2
    ), latest AS (SELECT max(recorded_at) AS ts FROM batches)
    SELECT pe.plan_name, pe.feature_slug, pe.feature_label, pe.kind,
           pe.value_num, pe.value_text, pe.unit, pe.reset_period,
           (pe.is_canonical = 1) AS is_canonical,
           pe.recorded_at::text AS recorded_at,
           CASE WHEN pe.recorded_at = latest.ts THEN 'current' ELSE 'previous' END AS side
    FROM plan_entitlements pe, latest
    WHERE pe.competitor_id = ${competitor.id}
      AND pe.recorded_at IN (SELECT recorded_at FROM batches)
    ORDER BY pe.plan_name, pe.feature_label
  `);

  const current = rows.filter((r) => r.side === "current");
  const previous = rows.filter((r) => r.side === "previous");
  return c.json({
    current,
    previous,
    recordedAt: current[0]?.recorded_at ?? null,
  });
});

/**
 * Who this competitor says it is winning (Content Intelligence v2 P3).
 *
 * Three readings of the same two tables, all deterministic — the battle card
 * section built on this is rendered from these numbers, not written by a model, so
 * it can never claim a customer the competitor has not published.
 *
 *  - VERTICALS: the markets their stories are set in. Canonical slugs only: a
 *    free-text slug is one page's wording, so counting it as a vertical would
 *    report a market that exists in exactly one case study.
 *  - WINS: customers first seen inside the recent window. "First seen" is OUR date,
 *    which is the only one we have — the page carries none.
 *  - MARQUEE: the oldest names we hold. A customer that was already on the wall
 *    when we arrived is one they have had long enough to be a reference.
 *
 * Every list travels with the count it was taken from, so a section built on three
 * stories cannot read like a survey.
 */
competitorsRouter.get("/:id/customers", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const [stories, registry] = await Promise.all([
    db
      .select({
        industry: caseStudies.customerIndustry,
        isCanonical: caseStudies.isCanonicalIndustry,
        industryLabel: caseStudies.customerIndustryLabel,
      })
      .from(caseStudies)
      .where(eq(caseStudies.competitorId, competitor.id)),
    db
      .select({
        name: knownCustomers.displayName,
        firstSeenAt: knownCustomers.firstSeenAt,
        evidenceUrl: knownCustomers.evidenceUrl,
      })
      .from(knownCustomers)
      .where(eq(knownCustomers.competitorId, competitor.id))
      .orderBy(knownCustomers.firstSeenAt),
  ]);

  const counts = new Map<string, number>();
  for (const s of stories) {
    if (!s.industry || s.isCanonical !== 1) continue;
    counts.set(s.industry, (counts.get(s.industry) ?? 0) + 1);
  }
  const verticals = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([slug, count]) => ({ slug, label: industryLabel(slug), count }));

  const cutoff = Date.now() - CUSTOMER_WIN_WINDOW_DAYS * 86_400_000;
  const toIso = (d: Date) => new Date(d).toISOString();
  const wins = registry
    .filter((r) => new Date(r.firstSeenAt).getTime() >= cutoff)
    .slice(-10)
    .reverse()
    .map((r) => ({ name: r.name, firstSeenAt: toIso(r.firstSeenAt), evidenceUrl: r.evidenceUrl }));

  return c.json({
    verticals,
    wins,
    // Oldest first — the ones already on the wall when we arrived.
    marquee: registry.slice(0, 6).map((r) => ({ name: r.name, firstSeenAt: toIso(r.firstSeenAt) })),
    storiesTotal: stories.length,
    customersTotal: registry.length,
    windowDays: CUSTOMER_WIN_WINDOW_DAYS,
  });
});

/** How recent a first sighting has to be to still read as a win. */
const CUSTOMER_WIN_WINDOW_DAYS = 90;

const PricingOverrideSchema = z.object({
  status: z.enum(PRICING_STATUSES),
  demoUrl: z.string().url().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

// Manual override: the user fills pricing in by hand (typically after an
// "unknown" auto-detection). Sets pricingManualOverride so scrapes stop
// overwriting it.
competitorsRouter.put("/:id/pricing", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const body = PricingOverrideSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({
      pricingStatus: body.data.status,
      pricingDemoUrl: body.data.demoUrl ?? null,
      pricingNote: body.data.note ?? null,
      pricingManualOverride: true,
      updatedAt: new Date(),
    })
    .where(eq(competitors.id, id));
  return c.json({ ok: true });
});

// Hand pricing back to auto-detection and re-scrape now if a pricing monitor exists.
competitorsRouter.post("/:id/pricing/redetect", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db
    .update(competitors)
    .set({ pricingManualOverride: false, updatedAt: new Date() })
    .where(eq(competitors.id, id));

  const pricingMonitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, id), eq(monitors.sourceType, "pricing")),
  });
  if (pricingMonitor) {
    await enqueueJob(scrapeMonitor, { monitorId: pricingMonitor.id, force: true }, {
      priority: USER_SCRAPE_PRIORITY,
    });
  }
  return c.json({ ok: true, rescraped: Boolean(pricingMonitor) });
});

// ─── Per-plan pricing overlay (user content editing) ─────────────────────────
// The user edits/adds/hides individual pricing plans. Overrides live on
// competitors.overrides (jsonb), merged with the latest detected pricing_history
// batch at read time via resolveCurrentPricing — the append-only log (and thus
// the price-over-time chart) is never touched. The scraper keeps running: an
// untouched plan stays fresh, a new plan appears on its own, an edited plan whose
// detection diverges surfaces `drift` instead of being overwritten.

// The most recent detected batch as plain tiers (the overlay's baseline). Best-effort.
async function latestDetectedPricing(competitorId: string): Promise<PricingTier[]> {
  const rows = await analyticsQuery<{
    plan_name: string;
    price: number | null;
    currency: string;
    billing_period: string;
    unit: string | null;
    included_quantity: number | null;
    recorded_at: string;
  }>(sql`
    SELECT plan_name, price, currency, billing_period, unit, included_quantity,
           (recorded_at AT TIME ZONE 'UTC')::text AS recorded_at
    FROM pricing_history
    WHERE competitor_id = ${competitorId} AND origin = 'live'
    ORDER BY recorded_at DESC
    LIMIT 60
  `);
  const latestAt = rows[0]?.recorded_at ?? null;
  if (!latestAt) return [];
  return rows
    .filter((r) => r.recorded_at === latestAt)
    .map((r) => ({
      planName: r.plan_name,
      price: r.price,
      currency: r.currency,
      billingPeriod: r.billing_period,
      unit: r.unit,
      includedQuantity: r.included_quantity,
    }));
}

const PricingTierBodySchema = z.object({
  planName: z.string().min(1).max(120),
  price: z.number().finite().nullable(),
  currency: z.string().min(1).max(8),
  billingPeriod: z.string().min(1).max(24),
});

const PricingPlanOverrideBodySchema = z
  .object({
    planKey: z.string().min(1).max(120),
    action: z.enum(["edit", "add", "hide"]),
    value: PricingTierBodySchema.optional(),
    lastEditedByUserAt: z.string().datetime().optional(),
  })
  .refine((o) => o.action === "hide" || o.value != null, {
    message: "edit and add overrides require a value",
  });

const PutPricingPlansSchema = z.object({
  plans: z.array(PricingPlanOverrideBodySchema).max(40),
});

competitorsRouter.get("/:id/pricing-plans", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const detected = await latestDetectedPricing(competitor.id);
  const overrides = (competitor.overrides ?? null) as CompetitorOverrides | null;
  return c.json({
    detected,
    overrides: overrides?.pricingPlans ?? [],
    resolved: resolveCurrentPricing(detected, overrides),
  });
});

// Replace the pricing overlay wholesale (the client manages add/edit/hide/revert
// as a list and PUTs it). The server re-derives each merge key from the plan name
// so identity always tracks the value, dedupes by key (last wins), and stamps the
// edit time. Revert-all = PUT { plans: [] }.
competitorsRouter.put("/:id/pricing-plans", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const body = PutPricingPlansSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", issues: body.error.issues }, 400);

  const now = new Date().toISOString();
  const byKey = new Map<string, PricingPlanOverride>();
  for (const p of body.data.plans) {
    const key = p.value ? normalizePlanKey(p.value.planName) : normalizePlanKey(p.planKey);
    byKey.set(key, {
      planKey: key,
      action: p.action,
      value: p.value,
      lastEditedByUserAt: p.lastEditedByUserAt ?? now,
    });
  }
  const plans = [...byKey.values()];

  const existing = (competitor.overrides ?? {}) as CompetitorOverrides;
  const overrides: CompetitorOverrides = { ...existing, pricingPlans: plans };
  await db
    .update(competitors)
    .set({ overrides, updatedAt: new Date() })
    .where(eq(competitors.id, competitor.id));

  const detected = await latestDetectedPricing(competitor.id);
  return c.json({ ok: true, overrides: plans, resolved: resolveCurrentPricing(detected, overrides) });
});

competitorsRouter.post("/:id/refresh-summary", aiIntensiveRateLimit, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const jobId = await enqueueJob(refreshCompetitorSummary, {
    competitorId: id,
    // User-initiated refresh → drop a durable "summary ready" notification when it
    // lands, so leaving the page doesn't lose the result. Automated refreshes
    // (post-scrape, onboarding, battle-card) omit the flag and stay silent.
    notifyOnComplete: true,
  });
  return c.json({ runId: jobId });
});

// On-demand English translation of the homepage fact sheet (headline, subheadline,
// value props, testimonials) for a foreign-language competitor. Reads OUR stored
// facts server-side (no client-supplied text → not abusable as a free MT proxy),
// translates in one batched Azure call, returns the English copy. Rate-limited like
// other AI-intensive actions; the UI keeps the original until the user opts in.
competitorsRouter.post("/:id/translate", aiIntensiveRateLimit, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const { homepage } = await buildHomepageFacts(id);
  if (!homepage) return c.json({ error: "nothing_to_translate" }, 404);

  const valueProps = homepage.valueProps;
  const quotes = homepage.testimonials.map((t) => t.quote);
  // One ordered batch: [headline, subheadline, ...valueProps, ...testimonialQuotes].
  const batch = [homepage.headline ?? "", homepage.subheadline ?? "", ...valueProps, ...quotes];

  const res = await translateToEnglish(batch);
  if (!res.ok) return c.json({ error: res.error }, 503);

  let i = 0;
  const headline = res.translations[i++] || null;
  const subheadline = res.translations[i++] || null;
  const translatedValueProps = valueProps.map(() => res.translations[i++] ?? "");
  const translatedTestimonials = quotes.map((_, idx) => ({
    quote: res.translations[i++] ?? "",
    author: homepage.testimonials[idx]?.author ?? null,
  }));

  return c.json({
    translated: {
      headline: homepage.headline ? headline : null,
      subheadline: homepage.subheadline ? subheadline : null,
      valueProps: translatedValueProps,
      testimonials: translatedTestimonials,
    },
    sourceLanguage: res.detectedLanguage ?? homepage.language ?? null,
  });
});

// Edit the competitor's display fields (kebab → Edit details). Name/url/category/
// description are user-correctable — scrapes don't own these. url is SSRF-validated
// below (it's what the homepage monitor fetches), the rest are free text.
const UpdateCompetitorSchema = z
  .object({
    name: z.string().min(1).max(COMPETITOR_NAME_MAX_LENGTH).optional(),
    url: z.string().url().max(2048).optional(),
    category: z.string().max(100).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    // Palette token or "#rrggbb". null clears it (back to neutral).
    color: z
      .string()
      .refine(isValidCompetitorColor, { message: "Invalid color" })
      .nullable()
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

competitorsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = UpdateCompetitorSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  // SSRF: the scraper fetches competitor.url directly, so host-check any new url
  // (IP literals / internal hosts) before it's persisted.
  if (parsed.data.url !== undefined) {
    const safeUrl = validatePublicUrl(parsed.data.url);
    if (!safeUrl.ok) return c.json({ error: "invalid_url", reason: safeUrl.error }, 400);
    parsed.data.url = safeUrl.url;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "url", "category", "description", "color"] as const) {
    if (parsed.data[k] !== undefined) patch[k] = parsed.data[k];
  }

  const [updated] = await db
    .update(competitors)
    .set(patch)
    .where(eq(competitors.id, id))
    .returning();
  return c.json({ competitor: updated });
});

// Pause / resume monitoring (kebab → Pause). The scheduler skips a paused
// competitor's monitors without mutating their isActive flags, so resuming keeps
// each source's prior state. Per-source "Run now" still works while paused.
const MonitoringSchema = z.object({ paused: z.boolean() });

competitorsRouter.patch("/:id/monitoring", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = MonitoringSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({ monitoringPaused: parsed.data.paused, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ ok: true, paused: parsed.data.paused });
});

// Mute / unmute real-time alerts (kebab → Mute alerts). Signals are still tracked
// and surface in the feed + digests; generate-signal just skips the immediate
// send-alert (email/Slack/in-app) when muted.
const AlertsSchema = z.object({ muted: z.boolean() });

competitorsRouter.patch("/:id/alerts", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = AlertsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({ alertsMuted: parsed.data.muted, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ ok: true, muted: parsed.data.muted });
});

// Recompute the overlap score (kebab → Recompute overlap). Re-scores this single
// competitor against the current profile of the product it belongs to — useful after
// that profile changed. Synchronous AI call (like discovery), reusing the discovery
// scorer through the shared evidence ladder (lib/overlap.ts) so a solo re-score is
// judged on the same kind of material discovery had, for the same product, against
// the same anchored scale.
competitorsRouter.post("/:id/recompute-overlap", aiIntensiveRateLimit, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const outcome = await scoreCompetitorOverlap(orgId, competitor);
  if (outcome.status === "no_url") return c.json({ error: "no_url" }, 400);
  if (outcome.status === "no_profile") return c.json({ error: "missing_profile" }, 400);
  // Nothing to judge the competitor on yet (no summary, no description). Keep the
  // score it already has rather than replace it with one the model produced from a
  // bare domain — that swap is exactly what turned discovery's 85 into a 5.
  if (outcome.status === "no_evidence") return c.json({ error: "no_evidence" }, 400);
  if (outcome.status === "failed") return c.json({ error: "scoring_failed" }, 502);

  await db
    .update(competitors)
    .set({ overlapScore: outcome.overlapScore, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ overlapScore: outcome.overlapScore, reason: outcome.reason });
});

// Product memberships for the "Assign to products" dialog (patch-28): every org
// product plus the subset this competitor is currently linked to. Attach/detach
// reuse the products router endpoints (POST/DELETE /products/:pid/competitors/:cid).
competitorsRouter.get("/:id/products", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const all = await db
    .select({
      id: products.id,
      name: products.name,
      isPrimary: products.isPrimary,
      status: products.status,
    })
    .from(products)
    .where(eq(products.orgId, orgId))
    .orderBy(asc(products.position), asc(products.name));

  const links = await db
    .select({
      productId: productCompetitors.productId,
    })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(and(eq(productCompetitors.competitorId, id), eq(products.orgId, orgId)));

  return c.json({ products: all, links });
});

// CSV export of this competitor's signals (kebab → Export signals). Returns a
// downloadable text/csv body, not JSON — the client triggers a Blob download.
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // CSV/formula injection: a cell starting with = + - @ (or tab/CR) is executed
  // as a formula by Excel/Sheets. Prefix a single quote to neutralize it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

competitorsRouter.get("/:id/export", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const rows = await db
    .select({
      detectedAt: signals.createdAt,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
    })
    .from(signals)
    .where(eq(signals.competitorId, id))
    .orderBy(desc(signals.createdAt))
    .limit(1000);

  const header = ["detected_at", "severity", "category", "insight", "so_what", "recommended_action"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.detectedAt instanceof Date ? r.detectedAt.toISOString() : String(r.detectedAt),
        r.severity,
        r.category,
        r.insight,
        r.soWhat,
        r.recommendedAction,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const slug = competitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "competitor";

  void captureServerEvent(user.id, "competitor_signals_exported", {
    competitorId: id,
    competitorName: competitor.name,
    signalCount: rows.length,
    orgId,
  });

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-signals.csv"`,
    },
  });
});

competitorsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db.update(competitors).set({ deletedAt: new Date() }).where(eq(competitors.id, id));

  void captureServerEvent(user.id, "competitor_deleted", {
    competitorId: id,
    competitorName: competitor.name,
    orgId,
  });

  return c.json({ ok: true });
});
