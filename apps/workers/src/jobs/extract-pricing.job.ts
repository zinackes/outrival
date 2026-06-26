import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots, monitors } from "@outrival/db";
import {
  extractPricing,
  summarizeSource,
  AI_CONFIG,
  PricingSchema,
  type PricingExtraction,
} from "@outrival/ai";
import { getFromR2, PRICING_STATUSES } from "@outrival/shared";
import { pricingFromStructured } from "@outrival/scrapers/structured-data";
import { pricingRatiosPlausible } from "@outrival/scrapers/pricing";
import { htmlToText } from "../lib/html-to-text";
import { insertPricingHistory, getPreviousPricing, loggedAi } from "../lib/analytics";
import { stagedExtract } from "../lib/staged-extract";

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  // patch-11 taxonomy, tagged onto each pricing_history row. Optional so a manual
  // re-trigger without scrape-monitor still works (falls back to unknown/FR).
  status: z.enum(PRICING_STATUSES).optional().default("unknown"),
  promotional: z.boolean().optional().default(false),
  observedRegion: z.string().optional().default("FR"),
});

export const extractPricingJob = task({
  id: "extract-pricing",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting extract-pricing", input);

    const snapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, input.snapshotId),
    });
    if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);

    const html = await getFromR2(`${snapshot.r2Key}.html`);
    const text = htmlToText(html);

    // TEMP DEBUG (pricing-empty investigation): surface where prices sit in the
    // extracted text so we can tell truncation/windowing apart from a
    // false-positive "public" status (stray currency tokens, no real plans).
    const priceRe = /[€$£¥]\s?\d[\d.,]*|\d[\d.,]*\s?[€$£¥]/g;
    const priceHits = [...text.matchAll(priceRe)].slice(0, 12).map((m) => ({
      idx: m.index ?? -1,
      token: m[0].trim(),
      around: text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60),
    }));
    const debug = {
      resolvedUrl: snapshot.resolvedUrl,
      textLen: text.length,
      head: text.slice(0, 400),
      priceHitCount: priceHits.length,
      priceHits,
    };

    // Staged extraction (patch-30): structured-first (schema.org Offer) → cached
    // selector parser → AI self-heal → direct AI extraction (the floor). Logs its
    // resolution to extraction_runs; ai_runs is logged via the wrapped aiFallback.
    const result = await stagedExtract<PricingExtraction>({
      kind: "pricing",
      sourceType: "pricing",
      competitorId: input.competitorId,
      html,
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
    const extracted = result.data;
    if (!extracted) {
      logger.warn("Pricing extraction returned null", debug);
      return { ok: false, reason: "parse_failed", debug };
    }
    logger.log("Pricing plans extracted", {
      count: extracted.plans.length,
      resolution: result.resolution,
      debug,
    });
    if (extracted.plans.length === 0) {
      return { ok: true, plansInserted: 0, debug };
    }

    // Read the prior batch before inserting the fresh one, so the summary can
    // describe what moved (price changes, new/dropped plans) since last scrape.
    const previous = await getPreviousPricing(input.competitorId);

    const recordedAt = new Date();
    // Quote-based tiers (price null) carry no point for the numeric price
    // history — keep them in the extraction/summary but skip the pricing_history row.
    await insertPricingHistory(
      extracted.plans.flatMap((p) =>
        p.price === null
          ? []
          : [
              {
                competitor_id: input.competitorId,
                plan_name: p.plan_name,
                price: p.price,
                currency: p.currency,
                billing_period: p.billing_period,
                status: input.status,
                promotional: input.promotional ? 1 : 0,
                observed_region: input.observedRegion,
                recorded_at: recordedAt,
              },
            ],
      ),
    );

    const summary = await loggedAi("source_summary", AI_CONFIG.classification, () =>
      summarizeSource({
        kind: "pricing",
        current: extracted.plans,
        previous,
      }),
    );
    if (summary) {
      await db
        .update(monitors)
        .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
        .where(eq(monitors.id, snapshot.monitorId));
    }

    logger.log("Completed extract-pricing", {
      competitorId: input.competitorId,
      plansInserted: extracted.plans.length,
    });
    return { ok: true, plansInserted: extracted.plans.length };
  },
});
