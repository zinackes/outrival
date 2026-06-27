import { task, logger, tasks, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  notifications,
  organizations,
  onboardingSessions,
} from "@outrival/db";

const InputSchema = z.object({
  orgId: z.string(),
  // The non-self competitors created at onboarding /complete. A competitor counts
  // as "analyzed" once it has an aiSummary — the same proxy the onboarding "done"
  // screen polls (first homepage scrape → refresh-competitor-summary).
  competitorIds: z.array(z.string()).min(1),
});

const POLL_INTERVAL_SECONDS = 15;
// Give up waiting after this and notify anyway, with softer copy. A permanently
// failing scrape (proxy block, dead URL) would otherwise mean the user never
// gets pinged. Waits >5s checkpoint the run, so this costs ~no compute.
const MAX_WAIT_MS = 8 * 60 * 1000;

export const notifyOnboardingAnalysisJob = task({
  id: "notify-onboarding-analysis",
  maxDuration: 600,

  async run(payload: z.input<typeof InputSchema>) {
    const { orgId, competitorIds } = InputSchema.parse(payload);
    const total = competitorIds.length;
    logger.log("Starting notify-onboarding-analysis", { orgId, total });

    const deadline = Date.now() + MAX_WAIT_MS;
    // Competitors already nudged this run — each stuck summary is re-triggered at
    // most once, so a permanently-failing one isn't hammered on every tick.
    const nudged = new Set<string>();
    let analyzed = 0;
    let tick = 0;
    while (true) {
      const ready = await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(and(inArray(competitors.id, competitorIds), isNotNull(competitors.aiSummary)));
      analyzed = ready.length;
      if (analyzed >= total || Date.now() >= deadline) break;

      // Self-heal the onboarding burst gap: even with the bounded summary queue, a
      // competitor's post-scrape refresh-competitor-summary can still fail (AI
      // outage, transient). Nothing else retries it until the NEXT scheduled scrape
      // — hours/days away — so the competitor sits "analyzing" the whole time. Once
      // it has a homepage snapshot (scrape succeeded) but still no summary,
      // re-trigger it here. Skipped on the first tick to let the scrape's own
      // post-capture trigger land first; bounded to one nudge per competitor.
      if (tick >= 1) {
        const readyIds = new Set(ready.map((r) => r.id));
        const missing = competitorIds.filter((id) => !readyIds.has(id) && !nudged.has(id));
        if (missing.length > 0) {
          const captured = await db
            .selectDistinct({ competitorId: monitors.competitorId })
            .from(monitors)
            .innerJoin(snapshots, eq(snapshots.monitorId, monitors.id))
            .where(
              and(inArray(monitors.competitorId, missing), eq(monitors.sourceType, "homepage")),
            );
          for (const { competitorId } of captured) {
            nudged.add(competitorId);
            await tasks.trigger("refresh-competitor-summary", { competitorId });
          }
          if (captured.length > 0) {
            logger.log("Re-triggered stuck competitor summaries", {
              orgId,
              count: captured.length,
            });
          }
        }
      }
      tick += 1;
      await wait.for({ seconds: POLL_INTERVAL_SECONDS });
    }

    // Idempotency guard: only the first watcher to flip analysisNotifiedAt sends
    // the notification. Protects against a double /complete (re-onboarding) and
    // against a retry of this job restarting the loop.
    const claimed = await db
      .update(organizations)
      .set({ analysisNotifiedAt: new Date() })
      .where(and(eq(organizations.id, orgId), isNull(organizations.analysisNotifiedAt)))
      .returning({ id: organizations.id });
    if (claimed.length === 0) {
      logger.log("Already notified, skipping", { orgId });
      return { skipped: true, analyzed, total };
    }

    const complete = analyzed >= total;
    await db.insert(notifications).values({
      orgId,
      type: "onboarding_complete",
      title: complete ? "Your competitors are ready" : "Your dashboard is ready",
      body: complete
        ? `We finished the first analysis of your ${total} competitor${total > 1 ? "s" : ""}. Head to your dashboard to explore the insights.`
        : `We analyzed ${analyzed} of ${total} competitor${total > 1 ? "s" : ""} so far. The rest will appear in your dashboard as monitoring continues.`,
      linkUrl: "/dashboard",
    });

    // Patch-25 backstop: close the onboarding session for metrics even if the
    // user left the tab before the client streaming hook could stamp it.
    try {
      const session = await db.query.onboardingSessions.findFirst({
        where: and(
          eq(onboardingSessions.orgId, orgId),
          eq(onboardingSessions.stage, "analysis_in_progress"),
        ),
        orderBy: desc(onboardingSessions.lastActivityAt),
      });
      if (session) {
        await db
          .update(onboardingSessions)
          .set({
            stage: "completed",
            completedAt: new Date(),
            lastActivityAt: new Date(),
            timings: { ...(session.timings ?? {}), analysis_completed: Date.now() },
          })
          .where(eq(onboardingSessions.id, session.id));
      }
    } catch (e) {
      logger.error("Failed to close onboarding session", { orgId, error: String(e) });
    }

    logger.log("Completed notify-onboarding-analysis", { orgId, analyzed, total });
    return { notified: true, analyzed, total };
  },
});
