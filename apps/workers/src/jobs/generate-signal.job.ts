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
  insertAiQualityCheck,
} from "@outrival/db";
import {
  generateInsight,
  generateRepositioningInsight,
  narrateChange,
  shouldNarrate,
  ClassificationSchema,
  AI_CONFIG,
} from "@outrival/ai";
import type { StructuredChange } from "@outrival/scrapers/homepage-diff";
import { PLAN_LIMITS, PRICING_STATUSES, PRICING_STATUS_LABELS } from "@outrival/shared";
import { insertSignalFeed, logAiRun } from "../lib/clickhouse";
import { captureWorkerEvent, shutdownPostHog } from "../lib/posthog";
import { groqQueue } from "../lib/queues";

// A pricing status transition (patch-11) carries its own severity and replaces
// the generic diff classification for that change.
const PricingTransitionSchema = z.object({
  type: z.enum(["pricing_gated", "pricing_public", "pricing_usage_based"]),
  severity: z.enum(["high", "medium"]),
  previous: z.enum(PRICING_STATUSES),
  current: z.enum(PRICING_STATUSES),
});

const InputSchema = z
  .object({
    changeId: z.string(),
    classification: ClassificationSchema.optional(),
    pricingTransition: PricingTransitionSchema.optional(),
  })
  .refine((v) => v.classification || v.pricingTransition, {
    message: "generate-signal needs a classification or a pricingTransition",
  });

export const generateSignalJob = task({
  id: "generate-signal",
  queue: groqQueue,
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

    // A pricing repositioning replaces the generic classification: it sets the
    // category to "pricing", takes its severity from the transition, and gets a
    // transition-aware insight prompt.
    const severity = input.pricingTransition
      ? input.pricingTransition.severity
      : input.classification!.severity;
    const category = input.pricingTransition ? "pricing" : input.classification!.category;

    // Human-readable before/after for the "Why this insight?" panel (patch-14).
    // A pricing transition has no price text, so we label its status change
    // ("Public pricing" → "Gated — contact sales"); the generic path uses the
    // before/after the classifier extracted from the diff (e.g. "$99/mo" → "$79/mo").
    // Both stay null when unavailable → the UI falls back gracefully.
    const humanChangeBefore = input.pricingTransition
      ? PRICING_STATUS_LABELS[input.pricingTransition.previous]
      : (input.classification!.humanChangeBefore ?? null);
    const humanChangeAfter = input.pricingTransition
      ? PRICING_STATUS_LABELS[input.pricingTransition.current]
      : (input.classification!.humanChangeAfter ?? null);

    // Ops quality logging (patch-02): success / parse_failed (null) / error
    // (thrown). Both insight paths use the 70b model.
    const { provider, model } = AI_CONFIG.insights;
    let insight;
    try {
      insight = input.pricingTransition
        ? await generateRepositioningInsight({
            competitorName: competitor.name,
            competitorCategory: competitor.category,
            previous: input.pricingTransition.previous,
            current: input.pricingTransition.current,
            type: input.pricingTransition.type,
            diffText: change.diffText,
          })
        : await generateInsight(
            change.diffText,
            competitor.name,
            competitor.category,
            input.classification!,
          );
    } catch (err) {
      await logAiRun("insight", provider, model, "error");
      throw err;
    }
    await logAiRun("insight", provider, model, insight ? "success" : "parse_failed");
    if (!insight) {
      logger.error("Insight generation failed", { changeId: input.changeId });
      throw new AbortTaskRunError("Insight returned null");
    }

    // Strategic narrative (patch-16): only for significant STRUCTURED homepage
    // changes, gated by HOMEPAGE_NARRATIVE_MIN_SEVERITY to control AI cost. Best
    // effort — a narration failure must never block the signal (unlike the insight
    // above, the narrative is an optional enhancement).
    let narrative: string | null = null;
    if (change.diffType === "structured" && change.structuredDiff && shouldNarrate(severity)) {
      const narrateModel = AI_CONFIG.insights;
      try {
        narrative = await narrateChange({
          changes: change.structuredDiff as StructuredChange[],
          competitor: { name: competitor.name, category: competitor.category ?? "unknown" },
        });
        await logAiRun(
          "narrate_change",
          narrateModel.provider,
          narrateModel.model,
          narrative ? "success" : "parse_failed",
        );
      } catch {
        await logAiRun("narrate_change", narrateModel.provider, narrateModel.model, "error");
        logger.warn("Narrative generation failed (non-fatal)", { changeId: input.changeId });
      }
    }

    const [newSignal] = await db
      .insert(signals)
      .values({
        changeId: input.changeId,
        orgId: competitor.orgId,
        competitorId: competitor.id,
        severity,
        category,
        insight: insight.insight,
        soWhat: insight.so_what,
        recommendedAction: insight.recommended_action,
        humanChangeBefore,
        humanChangeAfter,
        narrative,
        // Carry the change's persisted relevance (patch-17/26) onto the signal so
        // the per-org threshold layer and the weekly recalc can reason about it.
        // Null for non-homepage / lexical changes → layer 1 simply skips them.
        relevanceScore: change.relevanceScore,
      })
      .returning();

    if (!newSignal) throw new Error("Failed to insert signal");

    // Anti-hallucination (patch-24): persist the grounding + self-check envelope for
    // this signal so the UI can surface a ConfidenceDot / flagged warning and the ops
    // review queue + metrics can see it. Best-effort — never blocks the signal.
    await insertAiQualityCheck({
      aiTask: input.pricingTransition ? "detect_pricing_strategy" : "generate_signal",
      targetType: "signal",
      targetId: newSignal.id,
      orgId: competitor.orgId,
      quality: insight._quality,
    });

    await insertSignalFeed({
      org_id: competitor.orgId,
      competitor_id: competitor.id,
      category,
      severity,
      recorded_at: new Date(),
    });

    const isHigh = severity === "high" || severity === "critical";

    if (isHigh) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, competitor.orgId),
      });
      if (org?.alertsEnabled && PLAN_LIMITS[org.plan].features.realtimeAlerts) {
        await tasks.trigger(
          "send-alert",
          { signalId: newSignal.id },
          { idempotencyKey: newSignal.id },
        );
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
        severity,
        category,
        competitorId: competitor.id,
        orgId: competitor.orgId,
      });
    }
    await shutdownPostHog();

    logger.log("Completed generate-signal", {
      signalId: newSignal.id,
      severity,
      category,
    });

    return { signalId: newSignal.id };
  },
});
