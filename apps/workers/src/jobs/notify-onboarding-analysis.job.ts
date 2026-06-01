import { task, logger, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, count, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db, competitors, notifications, organizations } from "@outrival/db";

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
    let analyzed = 0;
    while (true) {
      const [row] = await db
        .select({ value: count() })
        .from(competitors)
        .where(and(inArray(competitors.id, competitorIds), isNotNull(competitors.aiSummary)));
      analyzed = row?.value ?? 0;
      if (analyzed >= total || Date.now() >= deadline) break;
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

    logger.log("Completed notify-onboarding-analysis", { orgId, analyzed, total });
    return { notified: true, analyzed, total };
  },
});
