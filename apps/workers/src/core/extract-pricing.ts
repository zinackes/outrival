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
import {
  getFromR2,
  PRICING_STATUSES,
  diffPriceTiers,
  diffCreditBurns,
  type CreditBurnRow,
} from "@outrival/shared";
import { pricingFromStructured } from "@outrival/scrapers/structured-data";
import {
  pricingRatiosPlausible,
  reconcileBillingPeriods,
  detectTrial,
  detectFreePlan,
  harvestPricing,
  splitProductLines,
} from "@outrival/scrapers/pricing";
import { classifyChange } from "@outrival/queue";
import { htmlToText } from "../lib/html-to-text";
import {
  insertPricingHistory,
  getPreviousPricing,
  insertPlanEntitlements,
  getPreviousEntitlements,
  insertPriceTiers,
  insertPricePoints,
  insertCreditBurnRates,
  getPreviousPriceTiers,
  getPreviousCreditBurns,
  loggedAi,
  type PriceTierRow,
} from "../lib/analytics";
import { prepareCreditBurns } from "../lib/credit-burns";
import { prepareRateStructures } from "../lib/rate-structures";
import { stagedExtract } from "../lib/staged-extract";
import { isSuspectedPricingCollapse } from "../lib/pricing-guard";
import { routePricingSignal } from "../lib/pricing-signals";
import { captureEntitlements } from "../lib/entitlements";

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
  // Pricing Intelligence P1 — the pricing change of the SAME scrape, deferred by
  // scrape-monitor: this job owns its signal routing (deterministic batch diff
  // first, lexical classifier fallback). See lib/pricing-signals.ts.
  changeId: z.string().optional(),
  lexicalWorth: z.boolean().optional().default(false),
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

    // A deferred change must never be stranded: every path that ends without a
    // deterministic emission hands it back to the lexical classifier (iff
    // scrape-monitor judged the text diff worth one) — the exact pre-P1 behavior.
    const enqueueLexicalFallback = async () => {
      if (input.changeId && input.lexicalWorth && !input.recordedAt) {
        await classifyChange.enqueue({ changeId: input.changeId });
      }
    };

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
        // The ratio is judged on RECONCILED plans: a stage that read "$16/mo billed
        // annually" as a $16 yearly is repairable arithmetic, not a mis-parse, and must
        // not cost an AI call. Reconciling here without page text uses the ratio rule only.
        plausible: (d) => {
          const reconciled = reconcileBillingPeriods(d.plans);
          return (
            reconciled.some((p) => p.price != null && p.price > 0) &&
            pricingRatiosPlausible(reconciled)
          );
        },
        structuredFn: (h) => pricingFromStructured(h),
        aiFallback: (t) => extractPricing(t),
        aiFallbackTask: "extract_pricing",
        htmlToText,
      });

    const harvestEnabled = process.env.PRICING_HARVEST_ENABLED !== "false";
    const sections = splitProductLines(html);
    const collected: PricingPlan[] = [];
    // P5 — the credit burn table is a PAGE-level fact (one mapping for the whole
    // product), so it is collected across sections rather than per line. Only the
    // AI stage emits it; a page resolved by structured-first / the cached parser /
    // the harvest floor publishes none, which reads as "we saw no mapping".
    const collectedBurns: Array<{ action: string; credits: number }> = [];
    let anyResolved = false;
    for (const section of sections) {
      const result = await extractSection(section.html);
      if (result.data) anyResolved = true;
      if (result.data?.credit_burns) collectedBurns.push(...result.data.credit_burns);
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
    // Canonicalize the billing periods before anything reads them: a `yearly` row
    // must be the amount charged for a YEAR. Whatever stage produced the plans —
    // schema.org, cached parser, AI floor, harvest — a "$16/mo billed annually"
    // read as a $16 yearly is restated as $192/year (and the per-month figure kept
    // as the monthly row), so monthlyEquivalent, the price ladder, medians and
    // battle cards stop reading a 12x-understated price. See
    // @outrival/scrapers/pricing normalize-periods. AI-free, runs before dedupe so
    // a derived row can still collapse against an identical detected one.
    const plans = dedupePlans(reconcileBillingPeriods(collected, text)).slice(
      0,
      MAX_TOTAL_PLANS,
    );
    logger.log("Pricing plans extracted", { count: plans.length, sections: sections.length });
    if (plans.length === 0) {
      await enqueueLexicalFallback();
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
          // Never a deterministic signal from a blocked batch (the "diff" is our
          // own mis-parse) — but the lexical path keeps its pre-P1 shot.
          await enqueueLexicalFallback();
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

    // P2 — entitlement matrix of the same capture (live runs only: a backfill
    // page is historical, and its "changes" would be time travel). Runs BEFORE
    // the non-idempotent inserts because its AI stage can throw — but the whole
    // stage is ADDITIVE by contract: any failure here leaves the pricing run
    // exactly as it was pre-P2 (plans still write, signal still routes).
    let entitlements: Awaited<ReturnType<typeof captureEntitlements>> | null = null;
    if (!input.recordedAt) {
      try {
        entitlements = await captureEntitlements({
          competitorId: input.competitorId,
          html,
          text,
          plans,
          previous: await getPreviousEntitlements(input.competitorId),
          recordedAt,
        });
      } catch (err) {
        logger.warn("Entitlement capture failed (non-fatal)", {
          competitorId: input.competitorId,
          error: String(err),
        });
      }
    }

    // P3 — the rate structures of the same capture: the published ladder and
    // what it costs at the reference volumes. Live runs only (a backfill page
    // is historical), pure and AI-free, and reached only past the collapse
    // guard above — a batch we refused to trust must not seed cost points.
    let rateStructures: ReturnType<typeof prepareRateStructures> | null = null;
    let previousTiers: PriceTierRow[] | null = null;
    if (!input.recordedAt) {
      previousTiers = await getPreviousPriceTiers(input.competitorId);
      rateStructures = prepareRateStructures({
        competitorId: input.competitorId,
        plans,
        pageText: text,
        recordedAt,
      });
      const { invalidLadders, unknownUnits, ungroundedExamples } = rateStructures.dropped;
      if (invalidLadders + unknownUnits + ungroundedExamples > 0) {
        logger.log("Rate-structure rows dropped by guards", {
          competitorId: input.competitorId,
          ...rateStructures.dropped,
        });
      }
    }

    // P5 — what one action SPENDS from a credit balance. Live runs only, same
    // reasoning as P2/P3, and grounded in code against the page text before a
    // single row is believed (lib/credit-burns). Zero extra AI: the burns rode
    // the pricing extraction's own response.
    let creditBurns: CreditBurnRow[] = [];
    let previousBurns: CreditBurnRow[] | null = null;
    if (!input.recordedAt) {
      const prepared = prepareCreditBurns({ raw: collectedBurns, pageText: text });
      creditBurns = prepared.rows;
      const { substring, ungrounded, invalid, cap } = prepared.dropped;
      if (substring + ungrounded + invalid + cap > 0) {
        logger.log("Credit burn rows dropped by guards", {
          competitorId: input.competitorId,
          ...prepared.dropped,
        });
      }
      if (creditBurns.length > 0) previousBurns = await getPreviousCreditBurns(input.competitorId);
    }

    // Keep every plan, including quote-based tiers (price null — "Enterprise",
    // "Contact sales", "Custom"): they're real plans the user wants to see. The
    // pricing_history.price column is nullable; numeric readers (charts, trends,
    // bands) filter null, but the tier list and comparison surface "Custom".
    const rows = plans.map((p) => ({
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
      // P3 — how a metered plan charges. Null on every subscription row.
      rate_structure: p.rate_structure ?? null,
      minimum_amount: p.minimum_amount ?? null,
      percentage_rate: p.percentage_rate ?? null,
      // `recordedAt` set ⟺ the snapshot is a Wayback capture, so the batch is
      // history and every "what do they charge now" read must be able to skip it.
      origin: input.recordedAt ? ("archive" as const) : ("live" as const),
      recorded_at: recordedAt,
    }));
    await insertPricingHistory(rows);
    // Same batch timestamp as the pricing rows — one capture, two tables.
    // Empty on backfill, on a matrix-less page, and when the collapse guard
    // blocked the extraction (then nothing is written, so the prior matrix
    // stays the baseline).
    if (entitlements) await insertPlanEntitlements(entitlements.rows);
    // Same batch timestamp again: three tables, one capture.
    if (rateStructures) {
      await insertPriceTiers(rateStructures.tierRows);
      await insertPricePoints(rateStructures.pointRows);
    }
    // Same batch timestamp again. An empty result inserts nothing rather than an
    // empty batch: the prior mapping stays the baseline, so one scrape that
    // failed to read the table can't erase what the page still publishes.
    await insertCreditBurnRates(
      creditBurns.map((b) => ({
        competitor_id: input.competitorId,
        action: b.action,
        credits: b.credits,
        recorded_at: recordedAt,
      })),
    );

    // Pricing Intelligence P1 — the deterministic batch→batch diff becomes the
    // pricing signal (or hands the deferred change back to the lexical path).
    // Live runs only: a backfill batch is backdated history, never a live move.
    // Runs AFTER the insert and never throws (see routePricingSignal) — a retry
    // of this job past this point would duplicate the batch.
    let routed: Awaited<ReturnType<typeof routePricingSignal>> | null = null;
    if (!input.recordedAt) {
      routed = await routePricingSignal({
        competitorId: input.competitorId,
        snapshot: {
          id: snapshot.id,
          monitorId: snapshot.monitorId,
          resolvedUrl: snapshot.resolvedUrl,
        },
        previous,
        current: rows,
        deferredChangeId: input.changeId ?? null,
        lexicalWorth: input.lexicalWorth,
        // P2 — packaging moves ride the same signal (never critical).
        entitlementChanges: entitlements?.changes ?? [],
        // P3 — a boundary that slid is a price rise nobody printed.
        tierChanges:
          previousTiers && rateStructures
            ? diffPriceTiers(previousTiers, rateStructures.tierRows, {
                currency: plans[0]?.currency ?? null,
              })
            : [],
        // P5 — a rise in what an action burns is a price rise nobody printed.
        creditBurnChanges: previousBurns ? diffCreditBurns(previousBurns, creditBurns) : [],
      });
    }

    logger.log("Completed extract-pricing", {
      competitorId: input.competitorId,
      plansInserted: plans.length,
      entitlements: entitlements
        ? { rows: entitlements.rows.length, resolution: entitlements.resolution, skipped: entitlements.skipped }
        : null,
      rateStructures: rateStructures
        ? { tiers: rateStructures.tierRows.length, points: rateStructures.pointRows.length }
        : null,
      creditBurns: creditBurns.length,
      pricingSignal: routed?.emitted ?? "backfill",
    });
    return { ok: true, plansInserted: plans.length };
}
