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
import {
  classifyChange,
  classifyStructuredChanges,
  AI_CONFIG,
  type Classification,
  type PerChangeAssessment,
} from "@outrival/ai";
import type { StructuredChange } from "@outrival/scrapers/homepage-diff";
import { groqQueue } from "../lib/queues";
import { logAiRun } from "../lib/analytics";
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

    // Resolve monitor + competitor up front: their source type and name ground
    // the classifier (a homepage tweak vs a pricing move), and they're reused for
    // the self-competitor branch below.
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, change.monitorId),
    });
    const competitor = monitor
      ? await db.query.competitors.findFirst({ where: eq(competitors.id, monitor.competitorId) })
      : null;

    // Ops quality logging (patch-02): success / parse_failed (null) / error
    // (thrown). The classify task itself stays DB-free — the job logs it.
    // Homepage structured changes (patch-16) take the structured classifier (70b,
    // per-change significance); everything else keeps the lexical 8b classifier.
    let classification: Classification | null;
    let perChange: PerChangeAssessment[] | null = null;
    if (change.diffType === "structured" && change.structuredDiff) {
      const structured = change.structuredDiff as StructuredChange[];
      const { provider, model } = AI_CONFIG.classification;
      let res;
      try {
        res = await classifyStructuredChanges(structured, {
          sourceType: monitor?.sourceType,
          competitorName: competitor?.name,
        });
      } catch (err) {
        await logAiRun("classify_structured", provider, model, "error");
        throw err;
      }
      await logAiRun("classify_structured", provider, model, res ? "success" : "parse_failed");
      classification = res?.classification ?? null;
      perChange = res?.perChangeAssessment ?? null;
    } else {
      const { provider, model } = AI_CONFIG.classificationFast;
      try {
        classification = await classifyChange(change.diffText, {
          sourceType: monitor?.sourceType,
          competitorName: competitor?.name,
        });
      } catch (err) {
        await logAiRun("classify", provider, model, "error");
        throw err;
      }
      await logAiRun("classify", provider, model, classification ? "success" : "parse_failed");
    }
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

    // Persist the one-line reason on the change so the UI's change cards
    // (Activity orphans + Content tab) show what moved — even for non-significant
    // changes that never become a signal. For structured homepage changes, also
    // overwrite structuredDiff with the per-change significance so the "Why this
    // insight?" panel (patch-16) can list the individual changes.
    await db
      .update(changes)
      .set({
        summary: classification.reason,
        ...(perChange ? { structuredDiff: perChange } : {}),
      })
      .where(eq(changes.id, input.changeId));

    if (!classification.is_significant) {
      logger.log("Change not significant, no signal generated", {
        changeId: input.changeId,
        reason: classification.reason,
      });
      return { significant: false, classification };
    }

    // Self-competitor (patch-12): the user's own product never produces a classic
    // signal (no signal_feed, no alert). Record the change in self_product_changes
    // for the user to accept/modify/ignore on the "My product" page, and stop here.
    // (monitor + competitor were resolved up front for the classifier context.)
    if (competitor?.type === "self") {
      const dupe = await db.query.selfProductChanges.findFirst({
        where: eq(selfProductChanges.changeId, input.changeId),
      });
      if (dupe) {
        logger.log("Self change already recorded for change, skipping", {
          changeId: input.changeId,
        });
        return { self: true, skipped: true };
      }

      const severity = determineSelfChangeSeverity(classification);
      const rawDiff = (change.rawDiff ?? {}) as { added?: string[]; removed?: string[] };
      await db.insert(selfProductChanges).values({
        orgId: competitor.orgId,
        selfCompetitorId: competitor.id,
        changeId: input.changeId,
        fieldPath: classification.category,
        previousValue: rawDiff.removed?.slice(0, 50) ?? null,
        newValue: rawDiff.added?.slice(0, 50) ?? null,
        summary: classification.reason,
        severity,
        status: "pending",
      });
      await notifySelfChange(competitor.orgId, severity);

      logger.log("Self product change recorded (no signal)", {
        changeId: input.changeId,
        severity,
      });
      return { self: true, severity };
    }

    await tasks.trigger("generate-signal", {
      changeId: input.changeId,
      classification,
    });

    return { significant: true, classification };
  },
});

export type { Classification };
