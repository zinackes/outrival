import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots } from "@outrival/db";
import { extractPricing } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { insertPricingHistory } from "../lib/clickhouse";

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
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

    const extracted = await extractPricing(text);
    if (!extracted) {
      logger.warn("Pricing extraction returned null");
      return { ok: false, reason: "parse_failed" };
    }
    logger.log("Pricing plans extracted", { count: extracted.plans.length });
    if (extracted.plans.length === 0) {
      return { ok: true, plansInserted: 0 };
    }

    const recordedAt = new Date();
    await insertPricingHistory(
      extracted.plans.map((p) => ({
        competitor_id: input.competitorId,
        plan_name: p.plan_name,
        price: p.price,
        currency: p.currency,
        billing_period: p.billing_period,
        recorded_at: recordedAt,
      })),
    );

    logger.log("Completed extract-pricing", {
      competitorId: input.competitorId,
      plansInserted: extracted.plans.length,
    });
    return { ok: true, plansInserted: extracted.plans.length };
  },
});
