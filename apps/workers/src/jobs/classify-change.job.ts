import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  changes,
  signals,
  monitors,
  competitors,
  selfProductChanges,
} from "@outrival/db";
import { classifyChange, type Classification } from "@outrival/ai";
import { groqQueue } from "../lib/queues";
import { determineSelfChangeSeverity, notifySelfChange } from "../lib/self-change";

const InputSchema = z.object({
  changeId: z.string(),
});

export const classifyChangeJob = task({
  id: "classify-change",
  queue: groqQueue,
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting classify-change", { changeId: input.changeId });

    const existing = await db.query.signals.findFirst({
      where: eq(signals.changeId, input.changeId),
    });
    if (existing) {
      logger.log("Signal already exists for change, skipping", {
        changeId: input.changeId,
        signalId: existing.id,
      });
      return { skipped: true, signalId: existing.id };
    }

    const change = await db.query.changes.findFirst({
      where: eq(changes.id, input.changeId),
    });
    if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);
    if (!change.diffText) {
      throw new AbortTaskRunError(`Change ${input.changeId} has no diffText`);
    }

    const classification = await classifyChange(change.diffText);
    if (!classification) {
      logger.error("Classification failed", { changeId: input.changeId });
      throw new AbortTaskRunError("Classification returned null");
    }

    logger.log("Classification result", {
      changeId: input.changeId,
      category: classification.category,
      severity: classification.severity,
      is_significant: classification.is_significant,
    });

    if (!classification.is_significant) {
      logger.log("Change not significant, no signal generated", {
        changeId: input.changeId,
        reason: classification.reason,
      });
      return { significant: false, classification };
    }

    await tasks.trigger("generate-signal", {
      changeId: input.changeId,
      classification,
    });

    return { significant: true, classification };
  },
});

export type { Classification };
