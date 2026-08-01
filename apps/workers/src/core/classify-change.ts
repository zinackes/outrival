import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  changes,
  signals,
  monitors,
  competitors,
  selfProductChanges,
} from "@outrival/db";
import { retriableClassifyError } from "../lib/classify-errors";
import {
  classifyChange,
  classifyStructuredChanges,
  isSubstantiveChange,
  gateAppliesTo,
  suppressesAsCosmetic,
  formatCorroborationSurface,
  AI_CONFIG,
  type Classification,
  type PerChangeAssessment,
} from "@outrival/ai";
import type { StructuredChange } from "@outrival/scrapers/homepage-diff";
import { loggedAi } from "../lib/analytics";
import { determineSelfChangeSeverity, notifySelfChange } from "../lib/self-change";

const InputSchema = z.object({
  changeId: z.string(),
});

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/classify-change.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out call change.
export async function runClassifyChange(payload: z.input<typeof InputSchema>) {
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
    // Captured so the narrowing above survives into the loggedAi closure.
    const diffText = change.diffText;

    // Resolve monitor + competitor up front: their source type and name ground
    // the classifier (a homepage tweak vs a pricing move), and they're reused for
    // the self-competitor branch below.
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, change.monitorId),
    });
    const competitor = monitor
      ? await db.query.competitors.findFirst({ where: eq(competitors.id, monitor.competitorId) })
      : null;

    const attribution = { orgId: competitor?.orgId, competitorId: competitor?.id };
    const isStructured = change.diffType === "structured" && !!change.structuredDiff;

    // Semantic gate — ahead of classification, on the generic content path only.
    // The structured homepage path is exempt: relevance scoring + volatile-line
    // learning already drop cosmetic churn before a change row is even written.
    // List-shaped sources (sitemap, subdomains, youtube…) are exempt in
    // gateAppliesTo — a new entry there is new by construction. The specialized
    // branches (Hacker News, wellknown, comparison pages, pricing transitions)
    // never reach this job at all: they trigger generate-signal directly.
    if (!isStructured && gateAppliesTo(monitor?.sourceType)) {
      const gate = await loggedAi(
        "cosmetic_gate",
        AI_CONFIG.classificationFast,
        () =>
          isSubstantiveChange(diffText, {
            sourceType: monitor?.sourceType,
            competitorName: competitor?.name,
          }),
        attribution,
      );
      // FAIL OPEN: a null (parse miss / provider down) must never suppress a real
      // change — only an explicit "substantive: false" does. The predicate is pure
      // and unit-tested (cosmetic-gate.test.ts).
      if (suppressesAsCosmetic(gate, { isStructured, sourceType: monitor?.sourceType })) {
        await db
          .update(changes)
          .set({ summary: gate.reason, suppressionReason: "cosmetic" })
          .where(eq(changes.id, input.changeId));
        logger.log("Change suppressed as cosmetic — no classification, no signal", {
          changeId: input.changeId,
          sourceType: monitor?.sourceType,
          reason: gate.reason,
        });
        return { suppressed: "cosmetic" as const, reason: gate.reason };
      }
    }

    // Recent moves for this competitor = the other independent surfaces the
    // corroboration axis scores against. Without them the model cannot tell a
    // pricing change it already saw on the pricing page this week from a fresh
    // one, so it would score every change as a single uncorroborated surface.
    //
    // Sent as LABELS, never as the earlier signals' prose. When these lines
    // carried the insight sentence, a change the model could not read (a 50 KB
    // single-line JSON blob of App Store reviews) came back classified with a
    // NEIGHBOURING signal's story, verbatim down to "social-set packages" — prod
    // signal fdd882b1, whose "what changed" announced a free trial it had no
    // evidence for. The source type is joined in because "independent SURFACE" is
    // what the axis actually counts, and it was the one field these lines never
    // carried.
    const now = Date.now();
    const recentSignals = competitor
      ? (
          await db
            .select({
              category: signals.category,
              severity: signals.severity,
              createdAt: signals.createdAt,
              sourceType: monitors.sourceType,
            })
            .from(signals)
            .innerJoin(changes, eq(changes.id, signals.changeId))
            .innerJoin(monitors, eq(monitors.id, changes.monitorId))
            .where(
              and(
                eq(signals.competitorId, competitor.id),
                gte(signals.createdAt, new Date(now - 14 * 86400_000)),
              ),
            )
            .orderBy(desc(signals.createdAt))
            .limit(5)
        ).map((s) =>
          formatCorroborationSurface({
            category: s.category,
            severity: s.severity,
            sourceType: s.sourceType,
            ageDays: Math.max(0, Math.floor((now - s.createdAt.getTime()) / 86400_000)),
          }),
        )
      : [];

    // Ops quality logging (patch-02): success / parse_failed (null) / error
    // (thrown). The classify task itself stays DB-free — the job logs it.
    // Homepage structured changes (patch-16) take the structured classifier (70b,
    // per-change significance); everything else keeps the lexical fast classifier.
    let classification: Classification | null;
    let perChange: PerChangeAssessment[] | null = null;
    if (isStructured) {
      const structured = change.structuredDiff as StructuredChange[];
      const res = await loggedAi(
        "classify_structured",
        AI_CONFIG.classification,
        () =>
          classifyStructuredChanges(structured, {
            sourceType: monitor?.sourceType,
            competitorName: competitor?.name,
            recentSignals,
          }),
        attribution,
      );
      classification = res?.classification ?? null;
      perChange = res?.perChangeAssessment ?? null;
    } else {
      classification = await loggedAi(
        "classify",
        AI_CONFIG.classificationFast,
        () =>
          classifyChange(diffText, {
            sourceType: monitor?.sourceType,
            competitorName: competitor?.name,
            // Custom-page monitors carry a page-type hint in config — grounds the
            // classifier ("this page is the competitor's {hint} page").
            hint: (monitor?.config as { hint?: string } | null)?.hint,
            recentSignals,
          }),
        attribution,
      );
    }
    if (!classification) {
      // A null here is a PARSE miss (malformed/empty JSON), not a thrown provider
      // error — and on the free reasoning providers the grounding/JSON envelope is
      // malformed transiently. So this is RETRIABLE: aborting used to drop the
      // signal permanently (the change stayed orphaned, no later scrape recreated
      // it). Throw a plain error so Trigger re-runs (the null result is never
      // cached → a fresh LLM call); after maxAttempts it dead-letters as a real
      // failure instead of a silent abort. The re-run is idempotent — nothing is
      // persisted before this point (the existing-signal guard covers a race).
      logger.error("Classification returned null (parse failed) — retrying", {
        changeId: input.changeId,
      });
      throw retriableClassifyError(input.changeId);
    }

    logger.log("Classification result", {
      changeId: input.changeId,
      category: classification.category,
      severity: classification.severity,
      is_significant: classification.is_significant,
      // The sub-scores the severity was derived from — without them a surprising
      // band in the logs is unexplainable after the fact.
      materiality: classification.materiality,
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

    await generateSignal.enqueue({
      changeId: input.changeId,
      classification,
    });

    return { significant: true, classification };
}
