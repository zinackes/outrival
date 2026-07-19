import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, eq, ne, or, isNull } from "drizzle-orm";
import {
  db,
  changes,
  snapshots,
  monitors,
  competitors,
  products,
  productCompetitors,
  signals,
  organizations,
  onboardingSessions,
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
  toMyProductContext,
  toMaterialityScores,
} from "@outrival/ai";
import type { StructuredChange } from "@outrival/scrapers/homepage-diff";
import {
  PLAN_LIMITS,
  PRICING_STATUSES,
  PRICING_STATUS_LABELS,
  renderCelebrationEmail,
} from "@outrival/shared";
import { insertSignalFeed, loggedAi } from "../lib/analytics";
import { captureWorkerEvent, shutdownPostHog } from "../lib/posthog";
import { getResend, ALERT_FROM } from "../lib/resend";
import { groqQueue } from "../lib/queues";
import { decideDispatch } from "../lib/notification-dispatcher";
import { applySeverityGuard } from "../lib/severity-guard";

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

// Notification moderation tail (patch-26): decide how a committed signal is
// delivered, stamp the decision on the row, and trigger the immediate alert when
// warranted. Extracted so BOTH the normal path and the retry re-dispatch path
// (a signal committed but left undispatched by a post-commit throw) run the exact
// same logic. Safe to re-run: decideDispatch is pure and send-alert is
// idempotency-keyed. Backfill signals bypass the dispatcher (in-app only).
async function dispatchSignal(args: {
  signalId: string;
  severity: typeof signals.$inferSelect.severity;
  category: typeof signals.$inferSelect.category;
  relevanceScore: number | null;
  competitor: { id: string; orgId: string; alertsMuted: boolean | null };
  org: { alertsEnabled: boolean | null; plan: keyof typeof PLAN_LIMITS } | null | undefined;
  isBackfill: boolean;
}): Promise<void> {
  const { signalId, severity, category, relevanceScore, competitor, org, isBackfill } = args;
  const decision = isBackfill
    ? ({ send: false, channel: "in_app_only", filteredReason: "backfill" } as const)
    : await decideDispatch(competitor.orgId, {
        signalId,
        severity,
        relevanceScore,
        competitorId: competitor.id,
        category,
      });
  await db
    .update(signals)
    .set({
      dispatchedChannel: decision.channel,
      filteredReason: decision.filteredReason ?? null,
      filteredAt: decision.filteredReason ? new Date() : null,
    })
    .where(eq(signals.id, signalId));

  if (decision.send && decision.channel === "email_immediate" && !competitor.alertsMuted) {
    // Plan entitlement still applies (moderation never overrides gating): only
    // realtime-alert plans get an immediate email/Slack/webhook. A user-muted
    // competitor (kebab → Mute alerts) keeps tracking signals but skips the alert.
    if (org?.alertsEnabled && PLAN_LIMITS[org.plan].features.realtimeAlerts) {
      await tasks.trigger("send-alert", { signalId }, { idempotencyKey: signalId });
      logger.log("Alert triggered", { signalId });
    }
  } else {
    logger.log("Signal deferred by moderation", {
      signalId,
      channel: decision.channel,
      reason: decision.filteredReason ?? null,
    });
  }
}

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
      if (existing.dispatchedChannel !== null) {
        logger.log("Signal already dispatched, skipping", { signalId: existing.id });
        return { skipped: true, signalId: existing.id };
      }
      // The signal row was committed but a post-commit throw (e.g. a transient Neon
      // error in decideDispatch or the dispatchedChannel update) left it never
      // dispatched — dispatchedChannel is still null. A plain retry would hit the
      // early-return above and skip it forever, so send-alert would never fire.
      // Re-dispatch idempotently: decideDispatch is pure and send-alert is
      // idempotency-keyed, so re-running is a no-op if it did partially run.
      logger.log("Signal exists but was never dispatched — re-dispatching", {
        signalId: existing.id,
      });
      const change = await db.query.changes.findFirst({
        where: eq(changes.id, input.changeId),
      });
      if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);
      let isBackfill = false;
      if (change.snapshotBeforeId) {
        const before = await db.query.snapshots.findFirst({
          where: eq(snapshots.id, change.snapshotBeforeId),
          columns: { origin: true },
        });
        isBackfill = before?.origin === "archive";
      }
      const competitor = await db.query.competitors.findFirst({
        where: eq(competitors.id, existing.competitorId),
      });
      if (!competitor) {
        throw new AbortTaskRunError(`Competitor ${existing.competitorId} not found`);
      }
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, competitor.orgId),
      });
      await dispatchSignal({
        signalId: existing.id,
        severity: existing.severity,
        category: existing.category,
        relevanceScore: existing.relevanceScore,
        competitor,
        org,
        isBackfill,
      });
      return { redispatched: true, signalId: existing.id };
    }

    const change = await db.query.changes.findFirst({
      where: eq(changes.id, input.changeId),
    });
    if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);
    if (!change.diffText) throw new AbortTaskRunError("Change has no diffText");
    // Captured so the narrowing above survives into the loggedAi closure.
    const diffText = change.diffText;

    // L2 archive backfill: a change whose "before" snapshot is a Wayback capture is
    // a real historical move surfaced at day 0. It must NEVER email/Slack (the user
    // didn't ask to be paged for the past) — it stays in-app only, stamped
    // filtered_reason='backfill', bypassing the dispatcher entirely (so it also
    // doesn't consume the daily email cap). The badge is derived from that reason.
    let isBackfill = false;
    if (change.snapshotBeforeId) {
      const before = await db.query.snapshots.findFirst({
        where: eq(snapshots.id, change.snapshotBeforeId),
        columns: { origin: true },
      });
      isBackfill = before?.origin === "archive";
    }

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, change.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${change.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

    // Load the org once: its productProfile makes the insight/narrative user-aware
    // (P0), and the same row is reused for the alert-gating check below (no re-fetch).
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, competitor.orgId),
    });
    const myProduct = toMyProductContext(org?.productProfile);

    // A pricing repositioning replaces the generic classification: it sets the
    // category to "pricing", takes its severity from the transition, and gets a
    // transition-aware insight prompt.
    let severity = input.pricingTransition
      ? input.pricingTransition.severity
      : input.classification!.severity;
    const category = input.pricingTransition ? "pricing" : input.classification!.category;

    // Deterministic guard (plan-027): "critical" bypasses every notification
    // filter and pages the customer immediately, but the model is never told
    // that stake — demote to "high" when the category/source/diff don't back
    // up that urgency. Applied here, once, so every downstream consumer (the
    // signal insert, the dispatcher, the alert) sees the guarded value.
    const guarded = applySeverityGuard({
      severity,
      category,
      sourceType: monitor.sourceType,
      diffText: change.diffText ?? "",
    });
    if (guarded.demoted) {
      logger.warn("Critical demoted by deterministic guard", {
        changeId: input.changeId,
        reason: guarded.reason,
      });
    }
    severity = guarded.severity;

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
    const attribution = { orgId: competitor.orgId, competitorId: competitor.id };
    const insight = await loggedAi(
      "insight",
      AI_CONFIG.insights,
      () =>
        input.pricingTransition
          ? generateRepositioningInsight({
              competitorName: competitor.name,
              competitorCategory: competitor.category,
              previous: input.pricingTransition.previous,
              current: input.pricingTransition.current,
              type: input.pricingTransition.type,
              diffText,
            })
          : generateInsight(
              diffText,
              competitor.name,
              competitor.category,
              input.classification!,
              myProduct,
              // Lexical diffs (diffType "text") are a raw blob → the most
              // hallucination-prone path: require verbatim grounding. Structured
              // homepage changes are already anchored, so they keep the cheap path.
              change.diffType !== "structured",
            ),
      attribution,
    );
    if (!insight) {
      // Parse miss (malformed/empty JSON), not a provider error — transient on the
      // free reasoning providers, so RETRIABLE: aborting here dropped a change
      // already judged significant. Plain throw → Trigger re-runs (fresh LLM call);
      // the run is idempotent up to this point (signal insert happens below and is
      // protected by the signals_change_id_uq unique index).
      logger.error("Insight returned null (parse failed) — retrying", {
        changeId: input.changeId,
      });
      throw new Error("Insight returned null (parse failed)");
    }

    // Strategic narrative (patch-16): only for significant STRUCTURED homepage
    // changes, gated by HOMEPAGE_NARRATIVE_MIN_SEVERITY to control AI cost. Best
    // effort — a narration failure must never block the signal (unlike the insight
    // above, the narrative is an optional enhancement).
    let narrative: string | null = null;
    if (change.diffType === "structured" && change.structuredDiff && shouldNarrate(severity)) {
      try {
        narrative = await loggedAi(
          "narrate_change",
          AI_CONFIG.insights,
          () =>
            narrateChange({
              changes: change.structuredDiff as StructuredChange[],
              competitor: { name: competitor.name, category: competitor.category ?? "unknown" },
              myProduct,
            }),
          attribution,
        );
      } catch {
        logger.warn("Narrative generation failed (non-fatal)", { changeId: input.changeId });
      }
    }

    // patch-28 — deterministically tag the products (SKUs) this signal affects:
    // every non-archived product of the org whose competitor set includes this
    // competitor (via product_competitors). A competitor shared by two products
    // tags its signals into both feeds. Empty when the org has no product yet.
    const associatedProducts = await db
      .select({ productId: productCompetitors.productId })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .where(
        and(
          eq(productCompetitors.competitorId, competitor.id),
          eq(products.orgId, competitor.orgId),
          ne(products.status, "archived"),
        ),
      );
    const productIds = associatedProducts.map((p) => p.productId);

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
        productIds,
        // Carry the change's persisted relevance (patch-17/26) onto the signal so
        // the per-org threshold layer and the weekly recalc can reason about it.
        // Null for non-homepage / lexical changes → layer 1 simply skips them.
        relevanceScore: change.relevanceScore,
        // The materiality sub-scores the severity above was computed from. Null on
        // the synthesized paths (pricing transitions, Hacker News, wellknown,
        // comparison pages) — those force a severity without scoring materiality.
        materiality: input.classification?.materiality
          ? toMaterialityScores(input.classification.materiality)
          : null,
      })
      .onConflictDoNothing({ target: signals.changeId })
      .returning();

    // A concurrent run can pass the dedupe check above and reach the insert at the
    // same time; the unique index (signals_change_id_uq) lets exactly one win and
    // onConflictDoNothing makes the loser a no-op. Treat the empty return as the
    // same "already exists" skip, not a failure.
    if (!newSignal) {
      logger.log("Signal already created concurrently, skipping", { changeId: input.changeId });
      return { skipped: true };
    }

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

    // Post-onboarding activation (Lever 3): the org's first-ever signal is the
    // true "first value" moment. Stamp it into the latest onboarding session's
    // timings (the funnel's first_real_signal milestone — FIRST_SIGNAL_RECEIVED
    // on the web is analysis-ready, not a real signal). Best-effort: never
    // blocks the signal.
    let isOrgFirstSignal = false;
    try {
      const prior = await db.query.signals.findFirst({
        where: and(eq(signals.orgId, competitor.orgId), ne(signals.id, newSignal.id)),
        columns: { id: true },
      });
      isOrgFirstSignal = !prior;
      if (isOrgFirstSignal) {
        const session = await db.query.onboardingSessions.findFirst({
          where: eq(onboardingSessions.orgId, competitor.orgId),
          orderBy: (t, { desc }) => desc(t.startedAt),
        });
        if (session && session.timings["first_real_signal"] == null) {
          await db
            .update(onboardingSessions)
            .set({ timings: { ...session.timings, first_real_signal: Date.now() } })
            .where(eq(onboardingSessions.id, session.id));
        }
      }
    } catch (err) {
      logger.warn("first_real_signal stamp failed (non-fatal)", { error: String(err) });
    }

    // Notification moderation (patch-26): the dispatcher decides how this signal is
    // delivered — an immediate email, a deferred digest, or dropped. Critical
    // bypasses every filter. The decision is stamped on the signal so the feed,
    // the digest jobs, and the ops metrics can read it. Backfill signals skip the
    // dispatcher outright (in-app only, see above). Shared with the retry
    // re-dispatch path via dispatchSignal.
    await dispatchSignal({
      signalId: newSignal.id,
      severity,
      category,
      relevanceScore: newSignal.relevanceScore,
      competitor,
      org,
      isBackfill,
    });

    // Standing queries: this fresh signal may shift the answer to a watched Ask
    // question — re-evaluate ONLY the queries whose watched entities it touches
    // (targeted trigger, no cron). Never for backfill: reconstructed history isn't
    // a live move worth re-alerting on. Fire-and-forget, never blocks the signal.
    if (!isBackfill) {
      try {
        await tasks.trigger(
          "evaluate-standing-queries",
          {
            orgId: competitor.orgId,
            competitorId: competitor.id,
            category,
            severity,
            signalId: newSignal.id,
          },
          { idempotencyKey: `sq-${newSignal.id}` },
        );
      } catch (err) {
        logger.warn("standing-query trigger failed (non-fatal)", { error: String(err) });
      }
    }

    // First-change celebration (Lever 5) — "Your monitoring just paid off". The single
    // most important lifecycle email, so it's strict: fires ONCE per org, on the first
    // LIVE change only. NEVER for a backfill/archive signal (celebrating reconstructed
    // history is hollow — the monitoring didn't catch anything live). Best-effort.
    if (!isBackfill && org?.digestEmail) {
      try {
        const priorLive = await db.query.signals.findFirst({
          where: and(
            eq(signals.orgId, competitor.orgId),
            ne(signals.id, newSignal.id),
            // A live signal = anything not stamped 'backfill' (null reason = sent live;
            // quiet_hours/cap = live but held). IS DISTINCT FROM, so NULLs count.
            or(isNull(signals.filteredReason), ne(signals.filteredReason, "backfill")),
          ),
          columns: { id: true },
        });
        if (!priorLive) {
          const webUrl = process.env.WEB_URL ?? "https://outrival.app";
          const email = renderCelebrationEmail({
            competitorName: competitor.name,
            category,
            insight: insight.insight,
            soWhat: insight.so_what,
            signalUrl: `${webUrl}/dashboard/signals`,
          });
          await getResend().emails.send({
            from: ALERT_FROM,
            to: org.digestEmail,
            subject: email.subject,
            html: email.html,
          });
          logger.log("First-change celebration sent", { orgId: competitor.orgId });
        }
      } catch (err) {
        logger.warn("Celebration email failed (non-fatal)", { error: String(err) });
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
      if (isOrgFirstSignal) {
        await captureWorkerEvent(orgOwner.id, "first_real_signal", {
          severity,
          category,
          orgId: competitor.orgId,
        });
      }
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
