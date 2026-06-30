import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { eq, inArray, sql } from "drizzle-orm";
import { db, organizations, aiVisibilityPrompts, aiVisibilityResults } from "@outrival/db";
import { PLAN_LIMITS, type Plan } from "@outrival/shared";

// AI Visibility scheduler — phase 2 (docs/ai-visibility.md). Weekly, independent of
// scrape-monitor. Enqueues only orgs that are (a) on a plan with features.aiVisibility,
// (b) have at least one ACTIVE prompt (the opt-in signal — until the phase-4 enable UI
// seeds prompts, this set is empty, so nothing auto-runs and no cost is incurred), and
// (c) are due (no results within AI_VISIBILITY_INTERVAL_DAYS). Cadence lives on the
// last recorded_at in ai_visibility_results, not on a monitor row.
export const scheduleAiVisibilityJob = schedules.task({
  id: "schedule-ai-visibility",
  cron: "0 7 * * 1", // Mondays 07:00 UTC
  maxDuration: 120,

  async run() {
    if (process.env.AI_VISIBILITY_ENABLED === "false") {
      logger.log("ai-visibility disabled by kill-switch, nothing scheduled");
      return { enqueued: 0 };
    }
    const intervalDays = Number(process.env.AI_VISIBILITY_INTERVAL_DAYS ?? 7);
    const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

    // Orgs that have opted in (≥1 active prompt).
    const promptOrgs = await db
      .selectDistinct({ orgId: aiVisibilityPrompts.orgId })
      .from(aiVisibilityPrompts)
      .where(eq(aiVisibilityPrompts.isActive, true));
    const promptOrgIds = promptOrgs.map((r) => r.orgId);
    if (promptOrgIds.length === 0) {
      logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "no_opted_in_orgs" });
      return { enqueued: 0 };
    }

    // Keep only plans whose features.aiVisibility is true.
    const orgs = await db.query.organizations.findMany({
      where: inArray(organizations.id, promptOrgIds),
      columns: { id: true, plan: true },
    });
    const eligible = orgs.filter((o) => PLAN_LIMITS[o.plan as Plan]?.features.aiVisibility);
    if (eligible.length === 0) {
      logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "no_eligible_plan" });
      return { enqueued: 0 };
    }

    // Drop the ones that already ran within the interval.
    const eligibleIds = eligible.map((o) => o.id);
    const lastRuns = await db
      .select({ orgId: aiVisibilityResults.orgId, last: sql<string>`max(${aiVisibilityResults.recordedAt})` })
      .from(aiVisibilityResults)
      .where(inArray(aiVisibilityResults.orgId, eligibleIds))
      .groupBy(aiVisibilityResults.orgId);
    const lastByOrg = new Map(lastRuns.map((r) => [r.orgId, new Date(r.last)]));
    const due = eligible.filter((o) => {
      const last = lastByOrg.get(o.id);
      return !last || last < cutoff;
    });

    if (due.length === 0) {
      logger.log("Completed schedule-ai-visibility", { enqueued: 0, reason: "none_due" });
      return { enqueued: 0 };
    }

    await tasks.batchTrigger(
      "scrape-ai-visibility",
      due.map((o) => ({ payload: { orgId: o.id } })),
    );
    logger.log("Completed schedule-ai-visibility", { enqueued: due.length });
    return { enqueued: due.length };
  },
});
