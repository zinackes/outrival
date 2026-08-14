import { logger } from "../lib/job-logger";
import {
  NonRetriable as AbortTaskRunError,
  sendAlert,
  evaluateStandingQueries,
} from "@outrival/queue";
import { z } from "zod";
import { and, asc, desc, eq, gte, lte, ne, or, isNull } from "drizzle-orm";
import {
  db,
  type SelfProfile,
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
  abstainFromUnverified,
  deterministicInsight,
  withTruncationReport,
} from "@outrival/ai";
import type { StructuredChange } from "@outrival/scrapers/homepage-diff";
import {
  PLAN_LIMITS,
  PRICING_STATUSES,
  PRICING_STATUS_LABELS,
  formatDiffForPrompt,
  renderCelebrationEmail,
} from "@outrival/shared";
import { insertSignalFeed, loggedAi } from "../lib/analytics";
import { captureWorkerEvent, shutdownPostHog } from "../lib/posthog";
import { sendEmail, ALERT_FROM } from "../lib/resend";
import { decideDispatch } from "../lib/notification-dispatcher";
import { applySeverityGuard } from "../lib/severity-guard";
import { truncatedReplyError } from "../lib/classify-errors";
import { checkFaithfulness, isBlocked, blockedReviewEntry } from "../lib/faithfulness-gate";
import { interceptEmission, recordEmission } from "../lib/emission-verification";

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
    // Véracité P2 — see GenerateSignalPayload: the ab_test_suspected emitter is the
    // conclusion of a verification, so it cannot be subject to one.
    skipVerification: z.boolean().optional(),
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
      await sendAlert.enqueue({ signalId }, { singletonKey: signalId });
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

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/generate-signal.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out calls change.
export async function runGenerateSignal(payload: z.input<typeof InputSchema>) {
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

    // Load the org once: its productProfile is the legacy/fallback "my product"
    // context, and the same row is reused for the alert-gating check below.
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, competitor.orgId),
    });

    // patch-28 — deterministically tag the products (SKUs) this signal affects:
    // every non-archived product of the org whose competitor set includes this
    // competitor (via product_competitors). A competitor linked to two products
    // tags its signals into both feeds. Empty when the org has no product yet.
    // Resolved BEFORE the insight because it also decides WHOSE product the
    // insight is written from — see myProduct below.
    const associatedProducts = await db
      .select({
        productId: productCompetitors.productId,
        selfCompetitorId: products.selfCompetitorId,
      })
      .from(productCompetitors)
      .innerJoin(products, eq(products.id, productCompetitors.productId))
      .where(
        and(
          eq(productCompetitors.competitorId, competitor.id),
          eq(products.orgId, competitor.orgId),
          ne(products.status, "archived"),
        ),
      )
      // Anchor priority when a competitor is tracked for several SKUs: the primary,
      // then display order. A competitor followed for ONE product needs no tie-break
      // — the single link is the answer, which is why the old isSpecific ordering
      // (dropped 2026-07-29) bought nothing: every link was written shared anyway.
      // To have a non-primary SKU speak for a competitor, unlink it from the primary.
      .orderBy(desc(products.isPrimary), asc(products.position), asc(products.createdAt));
    const productIds = associatedProducts.map((p) => p.productId);

    // Whose product the insight speaks for. `organizations.productProfile` is
    // org-level — on a multi-SKU org it is the PRIMARY product's profile, so a
    // competitor tracked for another SKU used to get "our <primary product> does
    // not compete on <what the competitor actually does>". Source it from the
    // product this competitor is actually tracked for (its self-competitor's
    // selfProfile, the per-product source of truth), and for a self-change from
    // the product itself. Multiple products → the primary among them (first row,
    // ordered above). No product row (legacy org) → the org profile, unchanged.
    const anchorSelfId =
      competitor.type === "self"
        ? competitor.id
        : (associatedProducts[0]?.selfCompetitorId ?? null);
    const anchorSelf = anchorSelfId
      ? await db.query.competitors.findFirst({
          where: eq(competitors.id, anchorSelfId),
          columns: { selfProfile: true },
        })
      : null;
    const sp = (anchorSelf?.selfProfile ?? null) as SelfProfile | null;
    const myProduct = toMyProductContext({
      category: sp?.category?.value ?? org?.productProfile?.category ?? "",
      audience: sp?.audience?.value ?? org?.productProfile?.audience ?? "",
      valueProp: sp?.valueProp?.value ?? org?.productProfile?.valueProp ?? "",
    });

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

    // Double capture before a high-stakes emission (Véracité Intelligence v2 P2).
    //
    // Placed HERE on purpose: after the severity guard, so the perimeter reads the
    // severity that will actually be written, and before the insight call, so a
    // deferred signal costs nothing. On confirmation this job is re-enqueued with the
    // same payload and generates its insight then — the AI call is moved, never
    // doubled, and the classification is never revisited.
    //
    // Out of the perimeter (medium/low, aggregated-data signals, synthetic anchors,
    // partial captures) this is a single indexed lookup and the run continues exactly
    // as it did before P2.
    if (!input.skipVerification) {
      const verification = await interceptEmission({
        change: {
          id: change.id,
          monitorId: change.monitorId,
          snapshotAfterId: change.snapshotAfterId,
          diffText: change.diffText,
        },
        monitor: { id: monitor.id, sourceType: monitor.sourceType, config: monitor.config },
        competitorId: competitor.id,
        competitorUrl: competitor.url,
        severity,
        humanChangeBefore,
        humanChangeAfter,
        payload: {
          classification: input.classification,
          pricingTransition: input.pricingTransition,
        },
      });
      if (verification.deferred) {
        logger.log("generate-signal deferred", {
          changeId: input.changeId,
          reason: verification.reason,
        });
        return { deferred: true, reason: verification.reason };
      }
    }

    // Ops quality logging (patch-02): success / parse_failed (null) / error
    // (thrown). Both insight paths use the 70b model.
    const attribution = { orgId: competitor.orgId, competitorId: competitor.id };
    const { value: insight, truncated } = await withTruncationReport(() =>
      loggedAi(
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
      ),
    );
    if (!insight) {
      // A reply cut off at max_tokens reproduces exactly — same prompt, same budget,
      // same cut — so retrying it buys the identical failure three times. Straight to
      // the dead-letter with the payload intact: the change is untouched, no signal
      // row exists, and replaying the job once the budget is fixed recreates it.
      if (truncated) {
        logger.error("Insight reply truncated at maxTokens — dead-lettering", {
          changeId: input.changeId,
        });
        throw truncatedReplyError("Insight", input.changeId);
      }
      // Parse miss (malformed/empty JSON), not a provider error — transient on the
      // free reasoning providers, so RETRIABLE: aborting here dropped a change
      // already judged significant. Plain throw → pg-boss re-runs (fresh LLM call);
      // the run is idempotent up to this point (signal insert happens below and is
      // protected by the signals_change_id_uq unique index).
      logger.error("Insight returned null (parse failed) — retrying", {
        changeId: input.changeId,
      });
      throw new Error("Insight returned null (parse failed)");
    }

    // Abstention (Véracité Intelligence v2 P3). The deterministic post-hoc check ran
    // inside the SAME call that produced the insight — no extra token — and if a
    // figure or a quotation in the prose is absent from the diff the model was shown,
    // that FIELD is withheld here. What survives is everything that was never in
    // doubt: the severity, the category, the human before/after the classifier lifted
    // out of the diff, and the fact block the API builds from the sibling extractors.
    //
    // Placed BEFORE the faithfulness gate on purpose — the gate must judge what will
    // actually be published, not a sentence we have already decided to drop — and
    // after the P2 interception, which reasons about severity and never about prose,
    // so the two never meet.
    const grounding = insight._quality.postHoc;
    const published = abstainFromUnverified({
      prose: insight,
      postHoc: grounding,
      fallbackInsight: deterministicInsight({
        competitorName: competitor.name,
        humanChangeBefore,
        humanChangeAfter,
      }),
    });
    if (published.withheld.length > 0) {
      logger.warn("Insight fields withheld — figures unsupported by the source", {
        changeId: input.changeId,
        withheld: published.withheld,
        unverified: grounding?.unverified.map((t) => t.text) ?? [],
      });
    }

    // Strategic narrative (patch-16): only for significant STRUCTURED homepage
    // changes, gated by HOMEPAGE_NARRATIVE_MIN_SEVERITY to control AI cost. Best
    // effort — a narration failure must never block the signal (unlike the insight
    // above, the narrative is an optional enhancement).
    let narrative: string | null = null;
    if (change.diffType === "structured" && change.structuredDiff && shouldNarrate(severity)) {
      try {
        const narrated = await loggedAi(
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
        // Same abstention rule as the insight, with a simpler shape: the narrative is
        // ONE optional paragraph, so an unsupported figure anywhere in it withholds
        // the whole thing. Dropping it is not a loss of evidence — the deterministic
        // before/after stays on the row and the panel renders it — and there is no
        // second call, which is what the re-roll that used to live in narrateChange
        // was.
        if (narrated && narrated._quality.postHoc?.status === "unverified") {
          logger.warn("Narrative withheld — figures unsupported by the change list", {
            changeId: input.changeId,
            unverified: narrated._quality.postHoc.unverified.map((t) => t.text),
          });
        } else {
          narrative = narrated?.narrative ?? null;
        }
      } catch {
        logger.warn("Narrative generation failed (non-fatal)", { changeId: input.changeId });
      }
    }

    // Claim-level faithfulness gate — critical/high only. Those are the insights
    // that leave the product as an immediate email/Slack page; medium/low are digest
    // material and the chain costs two FAST calls per signal. The signal row is
    // still written whatever the verdict: idempotency by changeId is load-bearing,
    // and a reviewer has to be able to read what was stopped. What a blocked verdict
    // withholds is the OUTWARD publication — the alert and the celebration email.
    //
    // Verified against the FULL diff, not the 8000-char slice the generator saw: a
    // wider source can only ever make a claim easier to support, so it removes false
    // blocks without letting an invented one through.
    //
    // LABELLED, like every other consumer. An unlabelled diff makes the check blind
    // to the one hallucination a diff invites: an insight built on a line the
    // competitor DELETED quotes text that really does occur in the source, so it
    // scored "verbatim" and published at ratio 1. The sides have to be nameable for
    // the extractor to cite the right one and for the judge to rule on it.
    const faithfulness =
      severity === "critical" || severity === "high"
        ? await checkFaithfulness({
            // Out of the enablement scope decided by plan 017: the wiring stays,
            // but "signal_insight" is not in FAITHFULNESS_GATE_TASKS until the
            // false-block rate has been observed on the two recoverable surfaces
            // (docs/faithfulness-rollout.md §4). A withheld critical alert is the
            // one block nobody can recover by noticing it later.
            task: "signal_insight",
            // What will actually be published, after any abstention: a withheld
            // sentence has no claims to judge, and judging it would let the gate
            // block a signal over text nobody will ever read.
            output: {
              insight: published.insight,
              so_what: published.soWhat,
              recommended_action: published.recommendedAction,
            },
            sourceText: formatDiffForPrompt(diffText),
            outputKind: "competitive intelligence signal insight",
            context: { changeId: input.changeId, competitorId: competitor.id, severity },
            attribution,
          })
        : null;
    const faithfulnessBlocked = isBlocked(faithfulness);

    // Véracité P4 — the surfaces the corroboration sub-score was counted over, kept
    // as IDS so the panel can link them instead of restating a 0-3 score the reader
    // cannot check. Same competitor, same 14-day window, same limit as the block the
    // classifier was shown (classify-change) — the ids are the one field that block
    // deliberately never carried, because prose from a neighbouring signal is what
    // contaminated prod signal fdd882b1.
    //
    // Anchored on the change's own detection instant rather than on now, so the row
    // means the same thing when it is read a month later, and so a signal deferred 30
    // minutes by the P2 double capture resolves the same neighbours as one that was
    // not. Skipped entirely on the synthesized paths, which score no materiality.
    const corroborationSources = input.classification?.materiality
      ? (
          await db
            .select({
              signalId: signals.id,
              sourceType: monitors.sourceType,
              at: signals.createdAt,
            })
            .from(signals)
            .innerJoin(changes, eq(changes.id, signals.changeId))
            .innerJoin(monitors, eq(monitors.id, changes.monitorId))
            .where(
              and(
                eq(signals.competitorId, competitor.id),
                ne(signals.changeId, input.changeId),
                lte(signals.createdAt, change.detectedAt),
                gte(signals.createdAt, new Date(change.detectedAt.getTime() - 14 * 86400_000)),
              ),
            )
            .orderBy(desc(signals.createdAt))
            .limit(5)
        ).map((s) => ({
          signalId: s.signalId,
          sourceType: s.sourceType,
          at: s.at.toISOString(),
        }))
      : [];

    const [newSignal] = await db
      .insert(signals)
      .values({
        changeId: input.changeId,
        orgId: competitor.orgId,
        competitorId: competitor.id,
        severity,
        category,
        insight: published.insight,
        soWhat: published.soWhat,
        recommendedAction: published.recommendedAction,
        // What the deterministic check made of the prose, and what it withheld
        // (Véracité P3). Data only — the badge that reads it is P4.
        groundingStatus: grounding?.status ?? null,
        groundingUnverified:
          grounding?.status === "unverified" && grounding.unverified.length > 0
            ? grounding.unverified
            : null,
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
          ? {
              ...toMaterialityScores(input.classification.materiality),
              ...(corroborationSources.length > 0 ? { corroborationSources } : {}),
            }
          : null,
        faithfulness,
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

    // Close the verification loop (P2): which signal it produced, and that it did.
    // No-op for the changes that were never verified.
    await recordEmission(input.changeId, newSignal.id);

    // Anti-hallucination (patch-24): persist the grounding + self-check envelope for
    // this signal so the UI can surface a ConfidenceDot / flagged warning and the ops
    // review queue + metrics can see it. Best-effort — never blocks the signal.
    const qualityCheck = {
      aiTask: input.pricingTransition ? "detect_pricing_strategy" : "generate_signal",
      targetType: "signal",
      targetId: newSignal.id,
      orgId: competitor.orgId,
      quality: insight._quality,
    };
    await insertAiQualityCheck(
      faithfulnessBlocked && faithfulness
        ? blockedReviewEntry({ ...qualityCheck, report: faithfulness })
        : { ...qualityCheck, faithfulness },
    );

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
    if (faithfulnessBlocked) {
      // The insight carries at least one claim the source doesn't support: it stays
      // in-app (visible, reviewable) but never pages anyone. Same stamping shape as
      // the dispatcher's own decisions, so the feed and the ops metrics read it the
      // way they read any other filtered signal.
      await db
        .update(signals)
        .set({
          dispatchedChannel: "in_app_only",
          filteredReason: "faithfulness_blocked",
          filteredAt: new Date(),
        })
        .where(eq(signals.id, newSignal.id));
      logger.warn("Signal alert withheld by the faithfulness gate", {
        signalId: newSignal.id,
        reason: faithfulness?.reason ?? null,
      });
    } else {
      await dispatchSignal({
        signalId: newSignal.id,
        severity,
        category,
        relevanceScore: newSignal.relevanceScore,
        competitor,
        org,
        isBackfill,
      });
    }

    // Standing queries: this fresh signal may shift the answer to a watched Ask
    // question — re-evaluate ONLY the queries whose watched entities it touches
    // (targeted trigger, no cron). Never for backfill: reconstructed history isn't
    // a live move worth re-alerting on. Fire-and-forget, never blocks the signal.
    if (!isBackfill) {
      try {
        await evaluateStandingQueries.enqueue(
          {
            orgId: competitor.orgId,
            competitorId: competitor.id,
            category,
            severity,
            signalId: newSignal.id,
          },
          { singletonKey: `sq-${newSignal.id}` },
        );
      } catch (err) {
        logger.warn("standing-query trigger failed (non-fatal)", { error: String(err) });
      }
    }

    // First-change celebration (Lever 5) — "Your monitoring just paid off". The single
    // most important lifecycle email, so it's strict: fires ONCE per org, on the first
    // LIVE change only. NEVER for a backfill/archive signal (celebrating reconstructed
    // history is hollow — the monitoring didn't catch anything live). Best-effort.
    // A blocked insight never leaves the product, and this email quotes it verbatim.
    if (!isBackfill && !faithfulnessBlocked && org?.digestEmail) {
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
            insight: published.insight,
            soWhat: published.soWhat,
            signalUrl: `${webUrl}/dashboard/signals`,
          });
          await sendEmail({
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
}
