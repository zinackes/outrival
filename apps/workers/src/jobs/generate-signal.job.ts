import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  changes,
  monitors,
  competitors,
  signals,
  organizations,
  users,
} from "@outrival/db";
import { generateInsight, ClassificationSchema } from "@outrival/ai";
import { insertSignalFeed } from "../lib/clickhouse";
import { captureWorkerEvent, shutdownPostHog } from "../lib/posthog";

const InputSchema = z.object({
  changeId: z.string(),
  classification: ClassificationSchema,
});

export const generateSignalJob = task({
  id: "generate-signal",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting generate-signal", { changeId: input.changeId });

    const existing = await db.query.signals.findFirst({
      where: eq(signals.changeId, input.changeId),
    });
    if (existing) {
      logger.log("Signal already exists, skipping", { signalId: existing.id });
      return { skipped: true, signalId: existing.id };
    }

    const change = await db.query.changes.findFirst({
      where: eq(changes.id, input.changeId),
    });
    if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);
    if (!change.diffText) throw new AbortTaskRunError("Change has no diffText");

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, change.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${change.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

    const insight = await generateInsight(
      change.diffText,
      competitor.name,
      competitor.category,
      input.classification,
    );
    if (!insight) {
      logger.error("Insight generation failed", { changeId: input.changeId });
      throw new AbortTaskRunError("Insight returned null");
    }

    const [newSignal] = await db
      .insert(signals)
      .values({
        changeId: input.changeId,
        orgId: competitor.orgId,
        competitorId: competitor.id,
        severity: input.classification.severity,
        category: input.classification.category,
        insight: insight.insight,
        soWhat: insight.so_what,
        recommendedAction: insight.recommended_action,
      })
      .returning();

    if (!newSignal) throw new Error("Failed to insert signal");

    await insertSignalFeed({
      org_id: competitor.orgId,
      competitor_id: competitor.id,
      category: input.classification.category,
      severity: input.classification.severity,
      recorded_at: new Date(),
    });

    const isHigh =
      input.classification.severity === "high" ||
      input.classification.severity === "critical";

    if (isHigh) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, competitor.orgId),
      });
      if (org?.alertsEnabled) {
        await tasks.trigger("send-alert", { signalId: newSignal.id });
        logger.log("Alert triggered", { signalId: newSignal.id });
      }
    }

    const orgOwner = await db.query.users.findFirst({
      where: eq(users.orgId, competitor.orgId),
      columns: { id: true },
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
    if (orgOwner) {
      await captureWorkerEvent(orgOwner.id, "signal_generated", {
        severity: input.classification.severity,
        category: input.classification.category,
        competitorId: competitor.id,
        orgId: competitor.orgId,
      });
    }
    await shutdownPostHog();

    logger.log("Completed generate-signal", {
      signalId: newSignal.id,
      severity: input.classification.severity,
      category: input.classification.category,
    });

    return { signalId: newSignal.id };
  },
});
