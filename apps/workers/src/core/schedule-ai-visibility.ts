import { logger } from "../lib/job-logger";
import { scrapeAiVisibility } from "@outrival/queue";
import { sql } from "drizzle-orm";
import { db } from "@outrival/db";
import { PLAN_LIMITS, type Plan } from "@outrival/shared";
import { engineDailyRemaining } from "../lib/ai-visibility/budget";

// AI Visibility scheduler — a DAILY DRIP, not a weekly fan-out
// (docs/ai-visibility-engine-capacity.md).
//
// It used to ask "which orgs are due?" and enqueue all of them at once. That is the
// one shape a per-day request cap cannot serve: measured on prod 2026-08-01, six runs
// picked up inside a six-second window answered 21 of their 110 prompts, while the
// same orgs running alone answer 10 to 14 each. The free tier was never too small
// (20 requests a day is 140 a week, against 110 for a full sweep) — it was spent in
// one burst every Monday.
//
// So the question is inverted: which PRODUCTS have gone longest without a check, and
// how many of them does today's budget actually cover? Enqueue exactly that many.
// Ranking is by a product's OLDEST prompt, which is also what makes a truncated run
// self-healing: a product that only got through two of its ten prompts is the oldest
// thing on the list tomorrow, instead of being marked fresh for a week by the two
// rows it did write.
//
// The unit is a PRODUCT, not an org and not a prompt: share-of-voice is aggregated
// over a product's prompt set, so half a set is not half an answer, it is a different
// denominator. Enqueue a product only when the whole set fits in what is left.

interface DueProduct {
  orgId: string;
  productId: string;
  prompts: number;
  oldestCheck: Date;
}

export async function runScheduleAiVisibility() {
  if (process.env.AI_VISIBILITY_ENABLED === "false") {
    logger.log("ai-visibility disabled by kill-switch, nothing scheduled");
    return { enqueued: 0 };
  }
  const intervalDays = Number(process.env.AI_VISIBILITY_INTERVAL_DAYS ?? 7);
  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

  // What the free tier still owes us today, minus the slice held for the onboarding
  // teaser. Sizing the work against the budget is the whole point: an enqueue we
  // cannot pay for is a truncated run, and a truncated run used to cost a week.
  const budget = await engineDailyRemaining("gemini");
  if (budget <= 0) {
    logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "no_budget_left" });
    return { enqueued: 0 };
  }

  // One row per product carrying its active prompt count and the last check of its
  // LEAST recently checked prompt (epoch when a prompt has never been answered, so a
  // new product sorts to the front).
  const rows = (await db.execute(sql`
    SELECT p.product_id AS product_id,
           p.org_id AS org_id,
           count(*)::int AS prompts,
           min(coalesce(lr.last_at, to_timestamp(0))) AS oldest_check
    FROM ai_visibility_prompts p
    JOIN products pr ON pr.id = p.product_id AND pr.status <> 'archived'
    LEFT JOIN LATERAL (
      SELECT max(r.recorded_at) AS last_at
      FROM ai_visibility_results r
      WHERE r.prompt_id = p.id
    ) lr ON true
    WHERE p.is_active AND p.product_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY oldest_check ASC
  `)) as unknown as Array<{
    product_id: string;
    org_id: string;
    prompts: number;
    oldest_check: string | Date;
  }>;

  if (rows.length === 0) {
    logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "no_opted_in_products" });
    return { enqueued: 0 };
  }

  // Keep only orgs whose plan carries the capability. Reading the plans here rather
  // than in SQL keeps PLAN_LIMITS the single source of truth for gating.
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const orgs = await db.query.organizations.findMany({
    where: (o, { inArray }) => inArray(o.id, orgIds),
    columns: { id: true, plan: true },
  });
  const eligibleOrgs = new Set(
    orgs.filter((o) => PLAN_LIMITS[o.plan as Plan]?.features.aiVisibility).map((o) => o.id),
  );

  const due: DueProduct[] = rows
    .filter((r) => eligibleOrgs.has(r.org_id))
    .map((r) => ({
      orgId: r.org_id,
      productId: r.product_id,
      prompts: Number(r.prompts) || 0,
      oldestCheck: r.oldest_check instanceof Date ? r.oldest_check : new Date(r.oldest_check),
    }))
    // Spare budget is not a reason to re-check something fresh: that would spend the
    // allowance re-asking a question whose answer we already have, and diff two runs
    // a day apart as if a week had passed.
    .filter((p) => p.prompts > 0 && p.oldestCheck < cutoff);

  if (due.length === 0) {
    logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "none_due", budget });
    return { enqueued: 0 };
  }

  // Fill the day: oldest first, whole products only.
  const picked: DueProduct[] = [];
  let spent = 0;
  for (const product of due) {
    if (spent + product.prompts > budget) continue;
    picked.push(product);
    spent += product.prompts;
  }

  if (picked.length === 0) {
    // Every due product needs more prompts than the whole day's budget. Enqueuing one
    // anyway would guarantee a truncated run, and it would still be the oldest
    // tomorrow, so it would truncate again forever. Say so instead of looking healthy.
    logger.warn("ai-visibility: no product fits the daily budget", {
      budget,
      smallestDue: Math.min(...due.map((p) => p.prompts)),
      dueProducts: due.length,
    });
    return { enqueued: 0 };
  }

  await scrapeAiVisibility.enqueueMany(
    picked.map((p) => ({ data: { orgId: p.orgId, productId: p.productId } })),
  );
  logger.log("Completed schedule-ai-visibility", {
    enqueued: picked.length,
    promptsScheduled: spent,
    budget,
    stillDue: due.length - picked.length,
  });
  return { enqueued: picked.length };
}
