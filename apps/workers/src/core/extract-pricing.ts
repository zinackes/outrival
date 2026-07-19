import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError } from "@outrival/queue";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots, monitors } from "@outrival/db";
import {
  extractPricing,
  summarizeSource,
  AI_CONFIG,
  PricingSchema,
  type PricingExtraction,
  type PricingPlan,
} from "@outrival/ai";
import { getFromR2, PRICING_STATUSES } from "@outrival/shared";
import { pricingFromStructured } from "@outrival/scrapers/structured-data";
import {
  pricingRatiosPlausible,
  detectTrial,
  detectFreePlan,
  harvestPricing,
  splitProductLines,
} from "@outrival/scrapers/pricing";
import { htmlToText } from "../lib/html-to-text";
import { insertPricingHistory, getPreviousPricing, loggedAi } from "../lib/analytics";
import { stagedExtract } from "../lib/staged-extract";
import { isSuspectedPricingCollapse } from "../lib/pricing-guard";

// Cap the aggregated tier list so a large catalog (many product-line sections ×
// per-section rows) can't flood the pricing tab or the change diff.
const MAX_TOTAL_PLANS = 40;

// Drop plans sharing (name, price, period) — a product page reachable twice, or the
// same tier stitched from overlapping sections.
function dedupePlans(plans: PricingPlan[]): PricingPlan[] {
  const seen = new Set<string>();
  const out: PricingPlan[] = [];
  for (const p of plans) {
    const key = `${p.plan_name.toLowerCase()}|${p.price}|${p.billing_period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  // patch-11 taxonomy, tagged onto each pricing_history row. Optional so a manual
  // re-trigger without scrape-monitor still works (falls back to unknown/FR).
  status: z.enum(PRICING_STATUSES).optional().default("unknown"),
  promotional: z.boolean().optional().default(false),
  observedRegion: z.string().optional().default("FR"),
  // L2 archive backfill: when set, this snapshot is a Wayback capture, not a live
  // scrape. We backdate the pricing_history rows to the capture time (trend depth
  // on day 0) and, because the page is historical, skip the monitor aiSummary
  // refresh so a stale archive never overwrites the current source summary.
  recordedAt: z.string().datetime().optional(),
});

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/extract-pricing.job.ts (deleted at the cutover). The
// body is byte-identical to the pre-migration job — only the header and the
// signature change, so the two runtimes cannot drift.
export async function runExtractPricing(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting extract-pricing", input);

    const snapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, input.snapshotId),
    });
    if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);

    const html = await getFromR2(`${snapshot.r2Key}.html`);
    const text = htmlToText(html);

    // Staged extraction (patch-30) per product-line section (patch — L3, Part II).
    // A catalog snapshot from the pricing scraper carries several
    // <section data-outrival-line> blocks (VPS / game / dedicated…); a normal
    // single-page snapshot has none → splitProductLines yields ONE section with
    // line=null, i.e. exactly the pre-aggregation path. Each section runs the full
    // ladder (structured-first → cached parser → AI self-heal → AI floor) then the
    // L2 harvest floor, and its plans are prefixed with the line so N product lines
    // become N labelled rows. Logs resolution to extraction_runs; ai_runs via aiFallback.
    const extractSection = (sectionHtml: string) =>
      stagedExtract<PricingExtraction>({
        kind: "pricing",
        sourceType: "pricing",
        competitorId: input.competitorId,
        html: sectionHtml,
        url: snapshot.resolvedUrl,
        schema: PricingSchema,
        // Reject results with no real (positive) price — a lone schema.org Offer with
        // price 0 is a "free to try" marker, not the pricing table — and a monthly↔yearly
        // ratio that betrays a mis-parse, so a weak structured/cached result falls
        // through to the AI floor (patch-32). `.some` also covers the empty case.
        plausible: (d) =>
          d.plans.some((p) => p.price != null && p.price > 0) &&
          pricingRatiosPlausible(d.plans),
        structuredFn: (h) => pricingFromStructured(h),
        aiFallback: (t) => extractPricing(t),
        aiFallbackTask: "extract_pricing",
        htmlToText,
      });

    const harvestEnabled = process.env.PRICING_HARVEST_ENABLED !== "false";
    const sections = splitProductLines(html);
    const collected: PricingPlan[] = [];
    let anyResolved = false;
    for (const section of sections) {
      const result = await extractSection(section.html);
      if (result.data) anyResolved = true;
      // L2 harvest floor: when the staged extractor found no plans yet the section
      // visibly carries prices, an AI-free DOM harvest recovers the entry price / band
      // / per-card rows the SaaS-tuned AI floor drops on hosting/e-commerce layouts.
      let sectionPlans: PricingPlan[] = result.data?.plans ?? [];
      if (sectionPlans.length === 0 && harvestEnabled) {
        const floor = harvestPricing(section.html);
        if (floor.plans.length > 0) sectionPlans = floor.plans;
      }
      if (section.line) {
        sectionPlans = sectionPlans.map((p) => ({
          ...p,
          plan_name: `${section.line} · ${p.plan_name}`,
        }));
      }
      collected.push(...sectionPlans);
    }
    const plans = dedupePlans(collected).slice(0, MAX_TOTAL_PLANS);
    logger.log("Pricing plans extracted", { count: plans.length, sections: sections.length });
    if (plans.length === 0) {
      // Nothing structured AND no visible price to harvest in any section.
      if (!anyResolved) {
        logger.warn("Pricing extraction returned null", {
          resolvedUrl: snapshot.resolvedUrl,
          textLen: text.length,
        });
        return { ok: false, reason: "parse_failed" };
      }
      return { ok: true, plansInserted: 0 };
    }

    // Read the prior batch before inserting the fresh one, so the summary can
    // describe what moved (price changes, new/dropped plans) since last scrape.
    const previous = await getPreviousPricing(input.competitorId);

    // R4 anti-overwrite guard (see lib/pricing-guard). A mis-parse that collapses a
    // healthy multi-tier page to a single plan would shadow the real pricing (reads
    // take the newest batch). Only block when the page STILL visibly carries several
    // prices — proof the tiers are there and we failed to capture them — so a genuine
    // simplification is never suppressed. The harvest probe runs only in that rare
    // collapse case. Live scrapes only: backfill rows are backdated, never "latest".
    if (!input.recordedAt && previous) {
      const pricedNow = plans.filter((p) => p.price != null && p.price > 0).length;
      const pricedBefore = previous.filter((r) => r.price != null && r.price > 0).length;
      if (pricedBefore >= 3 && pricedNow <= 1) {
        const visiblePrices = harvestPricing(html).plans.filter(
          (p) => p.price != null && p.price > 0,
        ).length;
        if (isSuspectedPricingCollapse({ pricedBefore, pricedNow, visiblePrices })) {
          logger.warn(
            "Suspected pricing mis-parse — page still shows multiple prices but extraction collapsed; keeping the prior batch",
            {
              competitorId: input.competitorId,
              pricedBefore,
              pricedNow,
              visiblePrices,
              resolvedUrl: snapshot.resolvedUrl,
            },
          );
          return { ok: false, reason: "coverage_regression_guard" as const };
        }
      }
    }

    // Free-trial detection (patch-33, AI-free regex on the same page text). A
    // page-level fact stamped identically onto every plan row of this batch, like
    // status/observedRegion — so the latest batch reflects the current trial state.
    const trial = detectTrial(text);
    // Permanent free plan (AI-free). The priced-card extractor misses a free tier
    // that isn't a priced card (e.g. a "Free" comparison column with no price token),
    // so this page-level fact is what keeps the tab from wrongly claiming "no free
    // tier". Stamped identically onto every plan row, like the trial facts.
    const freePlan = detectFreePlan(text);
    logger.log("Free-plan / trial detection", { freePlan, trial });

    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    // Backfill runs only seed the historical pricing_history rows — never the
    // qualitative source summary (a 90-day-old page would clobber the current one).
    // Retry-safety: run the throwing AI call (and the monitor update it feeds)
    // BEFORE the non-idempotent insertPricingHistory below, so a retried run
    // after an AI failure never leaves duplicate pricing rows behind.
    if (!input.recordedAt) {
      const summary = await loggedAi(
        "source_summary",
        AI_CONFIG.classificationFast,
        () =>
          summarizeSource({
            kind: "pricing",
            current: plans,
            previous,
          }),
        { competitorId: input.competitorId },
      );
      if (summary) {
        await db
          .update(monitors)
          .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
          .where(eq(monitors.id, snapshot.monitorId));
      }
    }

    // Keep every plan, including quote-based tiers (price null — "Enterprise",
    // "Contact sales", "Custom"): they're real plans the user wants to see. The
    // pricing_history.price column is nullable; numeric readers (charts, trends,
    // bands) filter null, but the tier list and comparison surface "Custom".
    await insertPricingHistory(
      plans.map((p) => ({
        competitor_id: input.competitorId,
        plan_name: p.plan_name,
        price: p.price,
        currency: p.currency,
        billing_period: p.billing_period,
        unit: p.unit ?? null,
        included_quantity: p.included_quantity ?? null,
        status: input.status,
        promotional: input.promotional ? 1 : 0,
        observed_region: input.observedRegion,
        has_trial: trial.hasTrial ? 1 : 0,
        trial_days: trial.days,
        trial_requires_card:
          trial.requiresCreditCard == null ? null : trial.requiresCreditCard ? 1 : 0,
        has_free_plan: freePlan ? 1 : 0,
        recorded_at: recordedAt,
      })),
    );

    logger.log("Completed extract-pricing", {
      competitorId: input.competitorId,
      plansInserted: plans.length,
    });
    return { ok: true, plansInserted: plans.length };
}
