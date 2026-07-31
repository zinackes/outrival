import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, monitors, competitors, snapshots } from "@outrival/db";
import { AI_CONFIG, extractPricing, type PricingPlan } from "@outrival/ai";
import { listArchiveCaptures, sampleQuarterly, fetchArchivedRaw } from "@outrival/scrapers/backfill";
import {
  harvestPricing,
  reconcileBillingPeriods,
  pricingRatiosPlausible,
} from "@outrival/scrapers/pricing";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { detectDenyPage } from "@outrival/scrapers/deny-page";
import { htmlToText } from "../lib/html-to-text";
import {
  insertPricingHistory,
  insertPriceTiers,
  getArchivedPricingBatchTimes,
  loggedAi,
  logBackfillRun,
} from "../lib/analytics";
import { prepareRateStructures } from "../lib/rate-structures";

// Pricing Intelligence P5 — reconstruct a competitor's price TIMELINE from the
// Internet Archive, so a competitor added today has a chart on day one instead of
// a single dot and a promise.
//
// This is the pricing half of the L2 archive backfill, split out of
// backfill-history because the two answer different questions with different
// budgets. backfill-history wants ONE old page to diff against the live one (a
// day-0 "here's what moved" signal). This job wants a SERIES: a sparse, roughly
// quarterly walk over three years, which the availability API cannot enumerate
// and which must not cost a full AI extraction per point.
//
// THREE RULES CARRY IT.
//
// 1. NO SIGNAL, EVER. Not one change row, not one classification, not one
//    summary refresh. Backfilled rows exist to be plotted; a two-year-old price
//    is not news, and treating it as news would page someone at 3am about a
//    repricing that happened before they were a customer. This is why the job
//    writes pricing_history directly rather than routing through extract-pricing.
//
// 2. HARVEST FIRST. The deterministic DOM harvest (the L2 floor) does the work;
//    the AI is a fallback capped at MAX_AI_CALLS for the WHOLE backfill. Past the
//    cap a snapshot is skipped rather than half-read. Twelve AI extractions to
//    fill in history nobody asked for is not a trade worth making.
//
// 3. POLITE GUEST. One CDX index call, a hard cap on fetches, sequential with a
//    delay between them, a short timeout, and a silent per-snapshot abandon. The
//    Archive is a donation-funded shared resource; nothing here re-runs on its
//    own, and a failed snapshot never retries.
//
// WHAT DOES NOT APPLY. The coverage-regression guard (extract-pricing's R4
// anti-overwrite rule) is deliberately NOT run between Wayback snapshots. That
// guard exists to catch a mis-parse of TODAY's page against yesterday's capture
// of the same page. Two archive captures a quarter apart are different epochs: a
// page that genuinely went from six published tiers to one over that quarter is
// exactly the history this job exists to record, and refusing it as a "collapse"
// would delete the most interesting point on the chart. The per-snapshot ratio
// check (pricingRatiosPlausible) still runs — that one judges a batch against
// ITSELF, which stays valid across epochs.

const InputSchema = z.object({
  competitorId: z.string(),
  /** Explicit pricing URL; resolved from the monitor when absent. */
  url: z.string().optional(),
  /** Manual re-run (dev command): bypasses the once-per-competitor guard. */
  force: z.boolean().optional().default(false),
});

const DAY_MS = 86_400_000;
const numFromEnv = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/** How far back the timeline reaches. Beyond three years a price says more about
 * a different company than about this one. */
const lookbackYears = () => numFromEnv("PRICING_BACKFILL_YEARS", 3);
/** Hard cap on archived pages fetched per competitor — the politeness budget. */
const maxSnapshots = () => numFromEnv("PRICING_BACKFILL_MAX_SNAPSHOTS", 12);
/** Hard cap on AI extractions for the WHOLE backfill, across all snapshots. */
const maxAiCalls = () => numFromEnv("PRICING_BACKFILL_MAX_AI_CALLS", 4);
/** Courtesy gap between two fetches to web.archive.org. */
const fetchGapMs = () => numFromEnv("PRICING_BACKFILL_GAP_MS", 1500);
// A capture younger than this is not "history" — the live scrapes already cover it.
const MIN_ARCHIVE_AGE_DAYS = 30;
const MAX_PLANS_PER_BATCH = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BackfillPricingResult {
  skipped?: string;
  batchesWritten?: number;
  snapshotsRead?: number;
  aiCalls?: number;
}

export async function runBackfillPricingHistory(
  payload: z.input<typeof InputSchema>,
): Promise<BackfillPricingResult> {
  const input = InputSchema.parse(payload);
  logger.log("Starting backfill-pricing-history", input);

  const startedAt = Date.now();
  let monitorId = "";
  const logOutcome = (outcome: string, detail: string | null, seeded: number) =>
    logBackfillRun({
      monitor_id: monitorId,
      competitor_id: input.competitorId,
      source_type: "pricing",
      outcome,
      detail,
      archives_seeded: seeded,
      change_triggered: 0,
      duration_ms: Date.now() - startedAt,
    });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  // The user's own product has no competitive history worth reconstructing, and
  // its changes route to self_product_changes anyway.
  if (competitor.type === "self") {
    await logOutcome("self", null, 0);
    return { skipped: "self" };
  }

  const monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitor.id), eq(monitors.sourceType, "pricing")),
  });
  monitorId = monitor?.id ?? "";

  // The URL the live scrape settled on beats the configured one: a pricing page
  // is very often reached through a redirect, and the Archive indexes what was
  // actually served.
  const liveSnapshot = monitor
    ? await db.query.snapshots.findFirst({
        where: and(eq(snapshots.monitorId, monitor.id), eq(snapshots.origin, "live")),
        orderBy: (t) => desc(t.scrapedAt),
        columns: { resolvedUrl: true },
      })
    : null;
  const url =
    input.url ??
    liveSnapshot?.resolvedUrl ??
    (monitor?.config as { url?: string } | null)?.url ??
    null;
  if (!url) {
    await logOutcome("no_url", null, 0);
    return { skipped: "no_url" };
  }

  // ONE backfill per competitor. The archive inserts are not idempotent and the
  // Archive is not ours to poll, so a competitor that already has archive rows is
  // done — only an explicit manual re-run says otherwise.
  const existingArchiveBatches = await getArchivedPricingBatchTimes(competitor.id);
  if (!input.force && existingArchiveBatches.size > 0) {
    await logOutcome("already_backfilled", `${existingArchiveBatches.size} batches`, 0);
    return { skipped: "already_backfilled" };
  }

  const now = Date.now();
  const captures = await listArchiveCaptures(url, {
    from: new Date(now - lookbackYears() * 365 * DAY_MS),
    to: new Date(now - MIN_ARCHIVE_AGE_DAYS * DAY_MS),
  });
  const sampled = sampleQuarterly(captures, { max: maxSnapshots() });
  if (sampled.length === 0) {
    await logOutcome("no_archive_capture", `${captures.length} indexed`, 0);
    return { skipped: "no_archive_capture" };
  }
  logger.log("Archive captures sampled", {
    competitorId: competitor.id,
    url,
    indexed: captures.length,
    sampled: sampled.length,
  });

  let batches = 0;
  let read = 0;
  let aiCalls = 0;
  const skips = { duplicate: 0, unreachable: 0, blocked: 0, noPlans: 0, implausible: 0, aiCapped: 0 };

  for (const capture of sampled) {
    // Never two batches at one moment, and never a live batch overwritten: a
    // second run re-samples the SAME captures (sampleQuarterly is stable), so
    // without this the timeline would double every re-run.
    if (existingArchiveBatches.has(capture.capturedAt.getTime())) {
      skips.duplicate++;
      continue;
    }

    await sleep(fetchGapMs());
    const html = await fetchArchivedRaw(url, capture.waybackTimestamp);
    if (!html) {
      skips.unreachable++;
      continue;
    }
    read++;

    // An archived interstitial carries no prices, but it does carry text — and a
    // batch of zero plans read off one would look like "they stopped publishing
    // prices that quarter". Same guard backfill-history applies.
    if (isCloudflareChallenge(html) || detectDenyPage(html) !== null) {
      skips.blocked++;
      continue;
    }

    const text = htmlToText(html);
    // Harvest first: the deterministic floor is the workhorse here. It reads the
    // priced cards straight off the DOM, which is what an archived marketing page
    // is made of, and it costs nothing.
    let plans: PricingPlan[] = harvestPricing(html).plans;
    let usedAi = false;
    if (plans.length === 0) {
      if (aiCalls >= maxAiCalls()) {
        skips.aiCapped++;
        continue;
      }
      aiCalls++;
      const extracted = await loggedAi(
        "extract_pricing",
        AI_CONFIG.classification,
        () => extractPricing(text),
        { competitorId: competitor.id },
      );
      plans = extracted?.plans ?? [];
      usedAi = true;
    }

    // Same canonicalisation the live path runs, for the same reason: a "$16/mo
    // billed annually" read as a $16 yearly would draw a 12x cliff on the chart.
    plans = reconcileBillingPeriods(plans, text).slice(0, MAX_PLANS_PER_BATCH);
    if (plans.length === 0) {
      skips.noPlans++;
      continue;
    }
    // The P3 guard, applied to history exactly as to a live batch: a snapshot
    // whose monthly and yearly prices cannot both be true is a mis-read of an
    // old page, and one wrong point on a timeline is read as a real move.
    if (!pricingRatiosPlausible(plans)) {
      skips.implausible++;
      continue;
    }

    const recordedAt = capture.capturedAt;
    await insertPricingHistory(
      plans.map((p) => ({
        competitor_id: competitor.id,
        plan_name: p.plan_name,
        price: p.price,
        currency: p.currency,
        billing_period: p.billing_period,
        unit: p.unit ?? null,
        included_quantity: p.included_quantity ?? null,
        status: "unknown",
        promotional: 0,
        observed_region: process.env.SCRAPER_REGION ?? "FR",
        rate_structure: p.rate_structure ?? null,
        minimum_amount: p.minimum_amount ?? null,
        percentage_rate: p.percentage_rate ?? null,
        origin: "archive" as const,
        recorded_at: recordedAt,
      })),
    );
    // The published ladder of that capture, when the AI stage read one. The
    // harvest floor never emits tiers, so this is the AI path only. Cost points
    // are NOT written: what a plan cost at a reference volume is a reading of
    // the CURRENT ladder, and a historical one has no surface asking for it.
    if (usedAi) {
      const { tierRows } = prepareRateStructures({
        competitorId: competitor.id,
        plans,
        pageText: text,
        recordedAt,
      });
      await insertPriceTiers(tierRows.map((t) => ({ ...t, origin: "archive" as const })));
    }
    existingArchiveBatches.add(recordedAt.getTime());
    batches++;
  }

  const detail = Object.entries(skips)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
  // A backfill that read six of twelve captures is an honest partial success, not
  // a failure: every skip above is a page we could not read, never one we chose
  // to distort into a point.
  await logOutcome(
    batches > 0 ? "pricing_backfilled" : "no_significant_change",
    detail || null,
    batches,
  );
  logger.log("Completed backfill-pricing-history", {
    competitorId: competitor.id,
    sampled: sampled.length,
    snapshotsRead: read,
    batchesWritten: batches,
    aiCalls,
    skips,
  });
  return { batchesWritten: batches, snapshotsRead: read, aiCalls };
}
